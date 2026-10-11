import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { LevelBars, levelKey } from "../components/LevelBadge";
import type { GameData, LevelId, LevelSummary } from "../game/types";
import { useI18n } from "../i18n";

interface Props {
  data: GameData;
  /** Selected monument; shared with the map so a tap on a pin selects it here too. */
  pilot: string | null;
  setPilot: (pilot: string) => void;
  initialLevel?: LevelId;
  onStart: (pilot: string, level: LevelId) => void;
}

/** Highest available level: it carries the monument's story hook. */
function defaultLevel(levels: LevelSummary[]): LevelId | undefined {
  return [...levels].reverse().find((l) => l.available)?.id;
}

export function Home({ data, pilot, setPilot, initialLevel, onStart }: Props) {
  const { t, pick } = useI18n();
  const mon = data.monuments.find((m) => m.pilot_key === pilot);
  const [level, setLevel] = useState<LevelId | undefined>(initialLevel ?? (mon && defaultLevel(mon.levels)));

  // A new monument (from the list or the map) starts at its highest available level.
  const [levelFor, setLevelFor] = useState(pilot);
  useEffect(() => {
    if (pilot === levelFor) return;
    setLevelFor(pilot);
    setLevel(mon && defaultLevel(mon.levels));
  }, [pilot, levelFor, mon]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mon?.playable && level) onStart(mon.pilot_key, level);
  };

  return (
    <form className="screen home" onSubmit={submit}>
      <h1 tabIndex={-1}>{t("app.title")}</h1>
      <p className="lead">{t("home.intro")}</p>

      <section aria-labelledby="how-title" className="panel">
        <h2 id="how-title">{t("home.how")}</h2>
        <ol className="how-list">
          <li>{t("home.how1")}</li>
          <li>{t("home.how2")}</li>
          <li>{t("home.how3")}</li>
          <li>{t("home.how4")}</li>
        </ol>
      </section>

      <fieldset className="choices">
        <legend>
          <h2>{t("home.monument")}</h2>
        </legend>
        <p className="hint">{t("home.mapHint")}</p>
        {[...data.monuments].sort((a, b) => Number(b.playable) - Number(a.playable)).map((m) => (
          <label key={m.pilot_key} className={`choice${m.playable ? "" : " is-disabled"}`}>
            <input
              type="radio"
              name="monument"
              value={m.pilot_key}
              checked={pilot === m.pilot_key}
              disabled={!m.playable}
              onChange={() => setPilot(m.pilot_key)}
            />
            <span className="choice-body">
              <span className="choice-title">{m.display_name ? pick(m.display_name) : m.name}</span>
              <span className="choice-meta">
                {m.place ? pick(m.place) : m.country}
                {!m.playable && <> · {t("home.comingSoon")}</>}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {mon && (
        <fieldset className="choices">
          <legend>
            <h2>{t("home.level")}</h2>
          </legend>
          <p className="hint">{t("home.levelHelp")}</p>
          {mon.levels.map((l) => (
            <label key={l.id} className={`choice${l.available ? "" : " is-disabled"}`}>
              <input
                type="radio"
                name="level"
                value={l.id}
                checked={level === l.id}
                disabled={!l.available}
                onChange={() => setLevel(l.id)}
              />
              <span className="choice-body">
                <span className="choice-title">
                  <LevelBars id={l.id} />
                  {t(levelKey(l.id))}
                </span>
                <span className="choice-meta">
                  {l.available ? t("home.levelCount", { n: l.scenario_count }) : t("home.levelNone")}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="actions">
        <button type="submit" className="btn btn-primary btn-big" disabled={!mon?.playable || !level}>
          {t("home.start")}
          <Icon name="arrow" />
        </button>
      </div>
    </form>
  );
}
