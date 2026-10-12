// The mission is played on the map: the map fills the screen and a compact dock below it holds
// everything else (coins, Done, the three dangers, the sensor tray and an info line). The site
// guide floats over the map. Sensors are added by tapping a tile (placed at the cross, also the
// keyboard path) or by dragging a tile onto the map (placed where it is dropped).
import { Fragment, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { ScreenProps } from "../App";
import type { MapApi } from "../components/GameMap";
import { Icon, iconSvg } from "../components/Icon";
import { LevelBars } from "../components/LevelBadge";
import { STEPS } from "../components/Progress";
import {
  budgetFor,
  canAdd,
  cardById,
  coinsLeft,
  missionScenarios,
  newPlacementId,
  placeNear,
  totalSensors,
  withChange,
} from "../game/logic";
import type { Card, LatLng, Placement, Scenario } from "../game/types";
import { useI18n } from "../i18n";

interface Props extends ScreenProps {
  setPlacements: (update: (prev: Placement[]) => Placement[]) => void;
  mapApi: MutableRefObject<MapApi | null>;
  /** The player came back from the score to improve the network: "Done" returns there. */
  improving: boolean;
  onImproved: () => void;
}

interface Drag {
  card: Card;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
}

type Info = { kind: "card"; card: Card } | { kind: "danger"; danger: Scenario } | null;

// Wide: the dock is a column beside the map, so the instruments are sorted under their group
// names and the network is listed below them.
const WIDE = "(min-width: 60rem)";
// A phone on its side: the map is beside the dock, not above it (styles.css, "small screens").
const SIDE = "(max-width: 59.99rem) and (orientation: landscape) and (max-height: 32rem)";

/** Whether a media query matches now, kept up to date as the window changes. */
function useMedia(query: string): boolean {
  const read = () => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    let list: MediaQueryList;
    try {
      list = window.matchMedia(query);
    } catch {
      return;
    }
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function Mission({ data, mon, session, go, announce, setPlacements, mapApi, improving, onImproved }: Props) {
  const { t, tn, pick } = useI18n();
  const cards = useMemo(() => cardById(data), [data]);
  const threats = missionScenarios(mon, session.level, session.mission);
  const picks = session.picks;
  const budget = budgetFor(mon, session.level);
  const left = coinsLeft(budget, picks, cards);
  const sensors = totalSensors(picks);
  const wide = useMedia(WIDE);
  const side = useMedia(SIDE);
  const [hint, setHint] = useState("");
  const [info, setInfo] = useState<Info>(null);
  // Wide screens: a danger opens in place, on a click, and stays open while tiles are hovered, so
  // nothing in the column moves under the pointer. Narrow screens read it in the info line.
  const [openDanger, setOpenDanger] = useState<string | null>(null);
  // Closed at first: the numbered markers are on the map; the list opens on request.
  const [placesOpen, setPlacesOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const stopWatching = useRef<() => void>(() => {});
  const suppressClick = useRef(false);
  const ordered = useMemo(
    () => data.cards.groups.flatMap((g) => data.cards.cards.filter((c) => c.group === g.id)),
    [data],
  );

  // Never leave a drag ghost behind if the screen changes mid-drag.
  useEffect(() => () => endDrag(), []);

  // The site guide floats inside the map (so it can never be taller than the map).
  const [mapSection, setMapSection] = useState<HTMLElement | null>(null);
  useEffect(() => setMapSection(document.querySelector<HTMLElement>(".board-map")), []);

  const place = (card: Card, droppedAt?: LatLng) => {
    const name = pick(card.name);
    if (!canAdd(card, budget, picks, cards)) {
      announce(t("mission.notEnough", { name }));
      return;
    }
    // New pins go where the cross is, or where the tile was dropped; satellite images get no pin.
    const base = droppedAt ?? mapApi.current?.center() ?? mon.map!.center;
    const at = card.on_map ? placeNear(base, session.placements) : null;
    setPlacements((ps) => [...ps, { id: newPlacementId(), card: card.id, lat: at?.[0] ?? null, lng: at?.[1] ?? null }]);
    const next = withChange(picks, card.id, 1);
    setHint("");
    setInfo({ kind: "card", card });
    const changed = t("mission.changed", { name, n: next[card.id] ?? 0, left: coinsLeft(budget, next, cards) });
    announce(card.on_map ? `${changed} ${t(droppedAt ? "mission.dropped" : "mission.placed")}` : changed);
  };

  const removeOne = (card: Card) => {
    if (!picks[card.id]) return;
    setPlacements((ps) => {
      const last = ps.map((p) => p.card).lastIndexOf(card.id);
      return last < 0 ? ps : [...ps.slice(0, last), ...ps.slice(last + 1)];
    });
    const next = withChange(picks, card.id, -1);
    announce(t("mission.changed", { name: pick(card.name), n: next[card.id] ?? 0, left: coinsLeft(budget, next, cards) }));
  };

  const done = () => {
    if (sensors === 0) {
      setHint(t("mission.needOne"));
      announce(t("mission.needOne"));
      return;
    }
    if (improving) onImproved();
    else go("reveal");
  };

  // ---------------------------------------------------------------- drag a tile onto the map
  function endDrag() {
    stopWatching.current();
    stopWatching.current = () => {};
    drag.current?.ghost?.remove();
    drag.current = null;
    document.body.classList.remove("is-dragging-sensor");
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, card: Card) => {
    if (e.button !== 0 || !card.on_map) return; // satellite images cover the whole area: tap only
    endDrag();
    drag.current = { card, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, ghost: null };
    // A press can end off the tile, where the tile hears nothing: the window always does. It hears
    // it after the tile's own handlers, so a press that ends on the tile is already settled.
    const release = () => endDrag();
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    stopWatching.current = () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // A mouse that moves with no button held is not dragging, whatever was missed before.
    if (e.pointerType === "mouse" && !(e.buttons & 1)) {
      endDrag();
      return;
    }
    if (!d.active) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      // Mouse: any direction. Touch: towards the map, across the way the tray scrolls. Upright that
      // is upwards (sideways scrolls the tray); with the phone on its side it is to the left.
      const towardsMap = side ? dx < -10 && Math.abs(dx) > Math.abs(dy) : dy < -10 && Math.abs(dy) > Math.abs(dx);
      const starts = e.pointerType === "mouse" ? Math.hypot(dx, dy) > 6 : towardsMap;
      if (!starts) return;
      if (!canAdd(d.card, budget, picks, cards)) {
        announce(t("mission.notEnough", { name: pick(d.card.name) }));
        drag.current = null;
        return;
      }
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = `<span class="pin pin-you">${iconSvg(d.card.id, 16)}</span>`;
      document.body.append(ghost);
      d.ghost = ghost;
      document.body.classList.add("is-dragging-sensor");
      setInfo({ kind: "card", card: d.card });
    }
    if (d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
      d.ghost.classList.toggle("is-over-map", !!mapApi.current?.latLngAt(e.clientX, e.clientY));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const wasDrag = d.active;
    endDrag();
    if (!wasDrag) return; // a tap: the click handler places the sensor at the cross
    // The click that ends a drag must not also place a sensor; a drag that brings no click must
    // not swallow the next one.
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const at = mapApi.current?.latLngAt(e.clientX, e.clientY);
    if (at) place(d.card, at);
    else announce(t("mission.dropMissed"));
  };

  const onTileClick = (card: Card) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    place(card);
  };

  const jumpTo = (groupId: string) => {
    trayRef.current
      ?.querySelector<HTMLElement>(`[data-group="${groupId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" });
  };

  const showPlace = (lat: number, lon: number, name: string) => {
    mapApi.current?.focus([lat, lon]);
    announce(t("map.movedTo", { name }));
    if (!wide) setPlacesOpen(false); // give the map back on phones
  };

  // One sensor tile; `first` marks the first of its group, which the group buttons jump to.
  const tile = (card: Card, first: boolean) => {
    const n = picks[card.id] ?? 0;
    const name = pick(card.name);
    const affordable = canAdd(card, budget, picks, cards);
    return (
      <div key={card.id} className="tile-wrap" data-group={first ? card.group : undefined}>
        <button
          type="button"
          className={`tile${n > 0 ? " is-picked" : ""}`}
          aria-label={t("mission.add", { name })}
          aria-describedby={`tell-${card.id}`}
          aria-disabled={!affordable}
          onClick={() => onTileClick(card)}
          onPointerDown={(e) => onPointerDown(e, card)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endDrag}
          // Only the tile's own loss counts: a finger is first held by the icon or name it
          // touched, and that hold passing to the tile is how a drag begins, not how it ends.
          onLostPointerCapture={(e) => e.target === e.currentTarget && endDrag()}
          onFocus={() => setInfo({ kind: "card", card })}
          onMouseEnter={() => setInfo({ kind: "card", card })}
        >
          <Icon name={card.id} size={24} />
          <span className="tile-name">{name}</span>
          {/* The price as coins to count: the tile's description says the number. */}
          <span className="tile-cost" aria-hidden="true">
            {Array.from({ length: card.cost }, (_, k) => (
              <i key={k} />
            ))}
          </span>
          {n > 0 && (
            <span className="tile-count" aria-hidden="true">
              {n}
            </span>
          )}
        </button>
        {n > 0 && (
          <button type="button" className="tile-minus" aria-label={t("mission.remove", { name })} onClick={() => removeOne(card)}>
            <Icon name="minus" size={14} />
          </button>
        )}
        <span id={`tell-${card.id}`} hidden>
          {pick(card.tells)} {t("mission.costLabel")} {tn("unit.coins", card.cost)}. {t("mission.inNetwork", { n })}
        </span>
      </div>
    );
  };

  const step = STEPS.indexOf("mission") + 1;
  let infoLine;
  if (hint) {
    infoLine = <strong className="tray-alert">{hint}</strong>;
  } else if (info?.kind === "card") {
    infoLine = (
      <>
        <strong>{pick(info.card.name)}</strong> {pick(info.card.tells)}{" "}
        <span className="tray-info-cost">{tn("unit.coins", info.card.cost)}</span>
      </>
    );
  } else if (info?.kind === "danger" && !wide) {
    infoLine = (
      <>
        <strong>{pick(info.danger.plain.title)}:</strong> {pick(info.danger.plain.text)}
      </>
    );
  } else {
    infoLine = t(improving ? "mission.improveHint" : "mission.trayHint");
  }

  return (
    <div className="screen mission mission-play">
      {mon.places?.length > 0 && mapSection && createPortal(
        <div className="places-float">
          <button
            type="button"
            className="btn places-toggle"
            aria-expanded={placesOpen}
            aria-controls="places-panel"
            onClick={() => setPlacesOpen((open) => !open)}
          >
            <Icon name="pin" size={18} />
            {t("mission.places")}
            <span className="places-count" aria-hidden="true">
              {mon.places.length}
            </span>
          </button>
          <div id="places-panel" className="places-panel" hidden={!placesOpen}>
            <h2>{t("mission.guideTitle")}</h2>
            <ol className="place-rows">
              {mon.places.map((placeItem) => (
                <li key={placeItem.id}>
                  <button
                    type="button"
                    className="place-row"
                    aria-label={`${t("mission.showOnMap")}: ${pick(placeItem.name)}`}
                    onClick={() => showPlace(placeItem.lat, placeItem.lon, pick(placeItem.name))}
                  >
                    <span className="place-num" aria-hidden="true">
                      {placeItem.n}
                    </span>
                    <span className="place-row-text">
                      <span data-needs-review={placeItem.needs_review}>{pick(placeItem.name)}</span>
                      <small data-needs-review={placeItem.needs_review}>{pick(placeItem.note)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <h3>{t("mission.whereTitle")}</h3>
            <ul className="where-list">
              {data.site_guide.where.map((tip) => (
                <li key={tip.id} data-needs-review={data.site_guide.needs_review}>
                  <span className="where-icons" aria-hidden="true">
                    {tip.cards.map((card) => (
                      <Icon key={card} name={card} size={16} />
                    ))}
                  </span>
                  <span>{pick(tip.text)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        mapSection,
      )}

      <div className="dock">
        <div className="dock-head">
          <div className="dock-title">
            <p className="dock-step">{t("steps.current", { n: step, total: STEPS.length })}</p>
            <h1 tabIndex={-1}>{t("mission.heading")}</h1>
          </div>
          <div className="dock-coins">
            <p className="coins-text">
              <Icon name="coin" size={18} />
              {t("mission.coinsLeft", { left, budget: budget })}
            </p>
            <span className="budget-meter" aria-hidden="true">
              <span style={{ width: `${Math.max(0, (left / budget) * 100)}%` }} />
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary dock-done"
            aria-label={t(improving ? "mission.doneImprove" : "mission.done")}
            aria-disabled={sensors === 0}
            onClick={done}
          >
            {t("mission.doneShort")}
            <Icon name="arrow" size={18} />
          </button>
        </div>

        <div className="dock-row">
          <span className="dock-label">{t("mission.dangersLabel")}</span>
          <ul className="chip-row">
            {threats.map((s) => {
              const textId = `danger-${s.scenario_key}`;
              const open = wide && openDanger === s.scenario_key;
              return (
                <li key={s.scenario_key}>
                  <button
                    type="button"
                    className="danger-chip"
                    {...(wide
                      ? { "aria-expanded": open, "aria-controls": textId }
                      : {
                          "aria-pressed": info?.kind === "danger" && info.danger.scenario_key === s.scenario_key,
                          "aria-describedby": textId,
                        })}
                    onClick={() => {
                      setHint("");
                      if (wide) setOpenDanger(open ? null : s.scenario_key);
                      else setInfo({ kind: "danger", danger: s });
                    }}
                  >
                    <LevelBars id={s.level} />
                    {wide && <Icon name="chevron" size={16} />}
                    <span data-needs-review={s.plain.needs_review}>{pick(s.plain.title)}</span>
                  </button>
                  <p id={textId} className="danger-text" hidden={!open} data-needs-review={s.plain.needs_review}>
                    {pick(s.plain.text)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="tray-info" aria-hidden="true">
          <span>{infoLine}</span>
        </p>

        <div className="dock-row">
          <span className="dock-label">{t("mission.sensors")}</span>
          <ul className="chip-row group-chips">
            {data.cards.groups.map((g) => (
              <li key={g.id}>
                <button type="button" className="group-chip" onClick={() => jumpTo(g.id)}>
                  {pick(g.name)}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="tray" ref={trayRef} role="group" aria-label={t("mission.sensors")}>
          {data.cards.groups.map((group) => (
            <Fragment key={group.id}>
              {wide && <h2 className="dock-label tray-group">{pick(group.name)}</h2>}
              {/* One set of tiles per group. On wide screens a set is laid out in full rows; on
                  small ones it has no box of its own and the tiles run on in the tray. */}
              <div className="tray-set">
                {ordered.filter((card) => card.group === group.id).map((card, i) => tile(card, i === 0))}
              </div>
            </Fragment>
          ))}
        </div>

        {/* What has been bought so far and what it cost, like the list in a field book. */}
        {wide && (
          <section className="ledger" aria-labelledby="ledger-title">
            <h2 id="ledger-title" className="dock-label">
              {t("mission.networkTitle")}
            </h2>
            {sensors === 0 ? (
              <p className="ledger-empty">{t("mission.networkEmpty")}</p>
            ) : (
              <ul>
                {ordered
                  .filter((card) => picks[card.id])
                  .map((card) => (
                    <li key={card.id}>
                      <Icon name={card.id} size={16} />
                      <span className="ledger-name">{pick(card.name)}</span>
                      <span className="ledger-n">×{picks[card.id]}</span>
                      <span className="ledger-cost">{card.cost * (picks[card.id] ?? 0)}</span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="ledger-total">
              <span>{t("mission.networkTotal")}</span>
              <span className="ledger-sum">
                <Icon name="coin" size={14} />
                {budget - left} / {budget}
              </span>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
