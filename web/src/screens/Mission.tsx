import { useMemo, useState, type MutableRefObject } from "react";
import type { ScreenProps } from "../App";
import type { MapApi } from "../components/GameMap";
import { Icon } from "../components/Icon";
import { LevelBadge } from "../components/LevelBadge";
import {
  canAdd,
  cardById,
  coinsLeft,
  missionScenarios,
  newPlacementId,
  placeNear,
  totalSensors,
  withChange,
} from "../game/logic";
import type { Card, Placement } from "../game/types";
import { useI18n } from "../i18n";

interface Props extends ScreenProps {
  setPlacements: (update: (prev: Placement[]) => Placement[]) => void;
  mapApi: MutableRefObject<MapApi | null>;
}

export function Mission({ data, mon, session, go, announce, setPlacements, mapApi }: Props) {
  const { t, tn, pick } = useI18n();
  const cards = useMemo(() => cardById(data), [data]);
  const threats = missionScenarios(mon, session.level);
  const picks = session.picks;
  const left = coinsLeft(mon.budget, picks, cards);
  const sensors = totalSensors(picks);
  const [hint, setHint] = useState("");

  const change = (card: Card, delta: 1 | -1) => {
    const name = pick(card.name);
    if (delta > 0 && !canAdd(card, mon.budget, picks, cards)) {
      announce(t("mission.notEnough", { name }));
      return;
    }
    if (delta < 0 && !picks[card.id]) return;
    if (delta > 0) {
      // New pins go where the map's crosshair is; cards like satellite images get no pin.
      const at = card.on_map ? placeNear(mapApi.current?.center() ?? mon.map!.center, session.placements) : null;
      setPlacements((ps) => [...ps, { id: newPlacementId(), card: card.id, lat: at?.[0] ?? null, lng: at?.[1] ?? null }]);
    } else {
      setPlacements((ps) => {
        const last = ps.map((p) => p.card).lastIndexOf(card.id);
        return last < 0 ? ps : [...ps.slice(0, last), ...ps.slice(last + 1)];
      });
    }
    const next = withChange(picks, card.id, delta);
    setHint("");
    const changed = t("mission.changed", { name, n: next[card.id] ?? 0, left: coinsLeft(mon.budget, next, cards) });
    announce(delta > 0 && card.on_map ? `${changed} ${t("mission.placed")}` : changed);
  };

  const done = () => {
    if (sensors === 0) {
      setHint(t("mission.needOne"));
      announce(t("mission.needOne"));
      return;
    }
    go("reveal");
  };

  return (
    <div className="screen mission">
      <h1 tabIndex={-1}>{t("mission.heading")}</h1>

      <section aria-labelledby="threats-title">
        <h2 id="threats-title">{t("mission.threats")}</h2>
        <ol className="threat-list">
          {threats.map((s) => (
            <li key={s.scenario_key} className="threat">
              <h3 data-needs-review={s.plain.needs_review}>{pick(s.plain.title)}</h3>
              <p data-needs-review={s.plain.needs_review}>{pick(s.plain.text)}</p>
              <LevelBadge id={s.level} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sensors-title">
        <h2 id="sensors-title">{t("mission.sensors")}</h2>
        <p className="hint map-hint">
          <Icon name="plus" size={18} />
          {t("mission.placeHint")}
        </p>
        {data.cards.groups.map((group) => (
          <div key={group.id} className="card-group">
            <h3>{pick(group.name)}</h3>
            <ul className="sensor-list">
              {data.cards.cards
                .filter((c) => c.group === group.id)
                .map((card) => {
                  const n = picks[card.id] ?? 0;
                  const name = pick(card.name);
                  const affordable = canAdd(card, mon.budget, picks, cards);
                  return (
                    <li key={card.id} className={n > 0 ? "sensor-card is-picked" : "sensor-card"}>
                      <span className="sensor-icon">
                        <Icon name={card.id} size={32} />
                      </span>
                      <div className="sensor-text">
                        <h4 id={`card-${card.id}`}>{name}</h4>
                        <p data-needs-review={card.needs_review}>{pick(card.tells)}</p>
                      </div>
                      <p className="sensor-cost">
                        <Icon name="coin" size={18} />
                        <span className="sr-only">{t("mission.costLabel")} </span>
                        {tn("unit.coins", card.cost)}
                      </p>
                      <div className="stepper" role="group" aria-labelledby={`card-${card.id}`}>
                        <button
                          type="button"
                          className="step-btn"
                          aria-label={t("mission.remove", { name })}
                          aria-disabled={n === 0}
                          onClick={() => change(card, -1)}
                        >
                          <Icon name="minus" />
                        </button>
                        <span className="step-count">
                          <span className="sr-only">{t("mission.inNetwork", { n })}</span>
                          <span aria-hidden="true">{n}</span>
                        </span>
                        <button
                          type="button"
                          className="step-btn"
                          aria-label={t("mission.add", { name })}
                          aria-disabled={!affordable}
                          onClick={() => change(card, 1)}
                        >
                          <Icon name="plus" />
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </section>

      <div className="budget-bar">
        <div className="budget">
          <p className="budget-text">
            <Icon name="coin" size={20} />
            {t("mission.coinsLeft", { left, budget: mon.budget })}
          </p>
          <span className="budget-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(0, (left / mon.budget) * 100)}%` }} />
          </span>
          {hint && <p className="budget-hint">{hint}</p>}
        </div>
        <button type="button" className="btn btn-primary" aria-disabled={sensors === 0} onClick={done}>
          {t("mission.done")}
        </button>
      </div>
    </div>
  );
}
