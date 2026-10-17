// The 3D view of a consequence (README, "3D view"): "Display in 3D" under the "If nobody had
// noticed" drawings. Everything is loaded first (view3d/preload.ts) and the scene is built and drawn
// unseen; only then does the game's own map fly down onto the house. Under a blur the 3D view takes
// over from the very same picture, seen straight from above, and the camera comes down to the rooms.
// "Back to the map" goes the same way back. While it is open the rest of the game waits (inert).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { motionReduced } from "../a11y/settings";
import { formatWhen, loadLive, type LiveFile } from "../game/live";
import type { Card, GameData, Monument } from "../game/types";
import { useI18n, type MessageKey } from "../i18n";
import type { House, HouseRoom } from "../view3d/house";
import { damageAfter, EFFECTS, effectOf, MAP_ZOOM, metresPerPixel, type Effect } from "../view3d/math";
import { preload3d, type Focus3d, type Loaded } from "../view3d/preload";
import type { MapApi } from "./GameMap";
import { Icon } from "./Icon";
import { sensorPinFace } from "./sensorPin";

/** The blur between the map and the 3D view (styles.css, ".view3d"). */
const SWAP_MS = 700;
const FLY_IN_MS = 3600;
const FLY_OUT_MS = 1500;
const MAX_YEARS = 50;

/** building: made and drawn, unseen (the map then flies down). ready: waiting for the map.
 *  swapping: the blur. flying: the camera comes down. open: the player looks around.
 *  closing, leaving: the same way back. */
type Phase = "building" | "ready" | "swapping" | "flying" | "open" | "closing" | "leaving";

const wait = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

/** The picture sign on each "See it happen" button (the words are the button's name). */
const FX_SIGN: Record<Effect, string> = {
  rain: "🌧️", acidrain: "🌧️", flood: "🌊", storm: "⛈️", wind: "💨", heat: "🌡️", sun: "☀️", frost: "❄️",
  quake: "🏚️", walls: "🧱", slide: "⛰️", creep: "↘️", sink: "⤵️", cellar: "", damp: "💧", fire: "🔥", wildfire: "🔥", smog: "🏭", plants: "🌿", visitors: "👥",
};
const LEVEL_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, extreme: 3, catastrophic: 4 };

interface Props {
  mon: Monument;
  /** The scene (data/view3d/<scene>.json) and what it is opened for: the day's danger, or none. */
  scene: string;
  focus: Focus3d;
  /** The game's sensors: what the pins on ARGUS's sensors say. */
  cards: Card[];
  loaded: Loaded;
  mapApi: MutableRefObject<MapApi | null>;
  /** The map has flown down onto the house: the 3D view may take over. */
  arrived: boolean;
  /** The scene is built and drawn: the map may fly down. */
  onReady: () => void;
  /** Back on the map (or 3D could not be drawn after all): the game leaves the view. */
  onClosed: () => void;
}

/** The note under the years: what the day's danger does if nobody notices, or what ARGUS changes. */
function noteKey(kind: Focus3d["kind"], watched: boolean): MessageKey {
  if (kind === "mosaic") return watched ? "view3d.noteWatched" : "view3d.noteNobody";
  return watched ? "view3d.noteWatchedAny" : (`view3d.noteNobody_${kind ?? "none"}` as MessageKey);
}

export function View3D({ mon, scene, focus, cards, loaded, mapApi, arrived, onReady, onClosed }: Props) {
  const { t, pick, number, locale, list } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const houseRef = useRef<House | null>(null);
  const alive = useRef(true);
  const [phase, setPhase] = useState<Phase>("building");
  const [years, setYears] = useState(0);
  const [watched, setWatched] = useState(false);
  // "▶ Watch the years go by": the slider moves by itself from now to 50 years (a year at a time).
  const [playing, setPlaying] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [live, setLive] = useState<LiveFile | null>(null);
  // "See it happen": one of the weather and the dangers here, played out (view3d/weather.ts), or none
  const [effect, setEffect] = useState<Effect | null>(null);
  // The panel under the picture can be folded away (the model is then all there is to see), and the note on an
  // effect is two lines until asked for the rest.
  const [folded, setFolded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // "See it happen" has many effects (up to thirteen): one button opens them all as a grid of large tiles.
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickTriggerRef = useRef<HTMLButtonElement>(null);
  const shown = phase === "swapping" || phase === "flying" || phase === "open" || phase === "closing";
  // The place's name and the monument's ("House of the Masks · Delos"), or the monument's alone.
  const placeId = mon.scenes_3d?.find((s) => s.scene === scene)?.place;
  const place = placeId ? mon.places?.find((p) => p.id === placeId) : undefined;
  const title = place ? `${pick(place.name)} · ${pick(mon.display_name)}` : pick(mon.display_name);
  const argusModel = !!(loaded.assets.model && loaded.assets.grid);

  // Built and drawn once, unseen, at the picture the map will show when it has flown down.
  useEffect(() => {
    alive.current = true;
    const stage = stageRef.current!;
    const roomLabel = (r: HouseRoom) => {
      const key = `view3d.room${r.room}` as MessageKey;
      const name = t(key);
      return t("view3d.room", { n: r.room, name: name === key ? r.name : name });
    };
    const { origin, metres_per_degree: [kx, ky] } = loaded.assets.data;
    const xy: [number, number] | null = focus.at ? [(focus.at[1] - origin.lon) * kx, (focus.at[0] - origin.lat) * ky] : null;
    let house: House;
    try {
      house = loaded.house.createHouse(stage, loaded.assets, {
        roomLabel,
        canvasLabel: t("view3d.canvasPlace", { place: title }),
        focus: { serial: focus.serial, xy, kind: focus.kind },
        damageLabel: (what) => t(`view3d.kid_${what}` as MessageKey),
        magnifierLabel: (n) => t("view3d.magnifier", { n: number(n, 0) }),
        sensorPin: (sensors) => sensorPinFace(sensors, cards, { t, pick }),
        still: motionReduced(),
      });
    } catch {
      onClosed(); // no 3D on this device after all: the map stays as it was
      return;
    }
    houseRef.current = house;
    const fit = () => house.resize(stage.clientWidth, stage.clientHeight);
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(stage);
    house.setDamage(damageAfter(0, false, focus.kind));
    house.matchMap({ center: loaded.assets.centre, metresPerPixel: metresPerPixel(loaded.assets.centre[0], MAP_ZOOM) });
    house.renderOnce();
    setPhase("ready");
    onReady();
    loadLive().then((file) => alive.current && setLive(file));
    return () => {
      alive.current = false;
      resize.disconnect();
      house.dispose();
      houseRef.current = null;
      mapApi.current?.blur(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // The map is there: the same picture in 3D under a blur, then down to the rooms.
  useEffect(() => {
    const house = houseRef.current;
    if (!arrived || phase !== "ready" || !house) return;
    const still = motionReduced();
    const view = mapApi.current?.view();
    if (view) house.matchMap({ center: view.center, metresPerPixel: metresPerPixel(view.center[0], view.zoom) });
    house.start();
    mapApi.current?.blur(true);
    setPhase("swapping");
    void (async () => {
      await wait(still ? 0 : SWAP_MS);
      if (!alive.current) return;
      setPhase("flying");
      await house.flyIn(still ? 0 : FLY_IN_MS);
      if (alive.current) setPhase("open");
    })();
  }, [arrived, phase, mapApi]);

  // Unseen, nothing in it can be reached; once it shows, the focus moves to its title.
  useLayoutEffect(() => {
    if (rootRef.current) rootRef.current.inert = !shown;
    if (phase === "swapping") headingRef.current?.focus({ preventScroll: true });
  }, [phase, shown]);

  useEffect(() => {
    houseRef.current?.setDamage(damageAfter(years, watched, focus.kind));
  }, [years, watched, focus.kind]);

  useEffect(() => {
    houseRef.current?.setHighlight(highlight);
  }, [highlight, phase]);

  useEffect(() => {
    if (phase === "open") houseRef.current?.setWeather(effect);
    setNoteOpen(false);
  }, [effect, phase]);

  // The grid of effects: focus goes to the one playing (or the first); a press outside it, or Escape, closes it.
  useEffect(() => {
    if (!picking) return;
    const tiles = pickerRef.current?.querySelectorAll<HTMLButtonElement>(".view3d-fx-grid button");
    const on = pickerRef.current?.querySelector<HTMLButtonElement>('.view3d-fx-grid button[aria-pressed="true"]');
    (on ?? tiles?.[0])?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (pickerRef.current?.contains(target) || pickTriggerRef.current?.contains(target)) return;
      setPicking(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [picking]);


  useEffect(() => {
    if (!playing) return;
    if (years >= MAX_YEARS) {
      setPlaying(false);
      return;
    }
    const step = window.setTimeout(() => setYears((y) => Math.min(MAX_YEARS, y + 1)), motionReduced() ? 40 : 160);
    return () => window.clearTimeout(step);
  }, [playing, years]);

  // Once open, the rooms are framed between the title and the panel (which grows with the dangers),
  // and a sensor's card stays between them: the panel's top is where its fold button stands above it.
  useEffect(() => {
    const [house, stage, top, dock] = [houseRef.current, stageRef.current, topRef.current, dockRef.current];
    if (phase !== "open" || !house || !stage || !top || !dock) return;
    const fold = () => dock.querySelector<HTMLElement>(".view3d-fold");
    const measure = () => {
      const box = stage.getBoundingClientRect();
      const fromTop = Math.min(dock.getBoundingClientRect().top, fold()?.getBoundingClientRect().top ?? Infinity);
      house.setInsets(top.getBoundingClientRect().bottom - box.top, box.bottom - fromTop);
    };
    measure();
    const resize = new ResizeObserver(measure);
    for (const el of [stage, top, dock, fold()]) if (el) resize.observe(el);
    return () => resize.disconnect();
  }, [phase]);

  const close = async () => {
    const house = houseRef.current;
    if (!house || (phase !== "open" && phase !== "flying")) return;
    const still = motionReduced();
    house.setWeather(null); // the weather stops before the camera goes back up
    setEffect(null);
    setPhase("closing");
    await house.flyOut(still ? 0 : FLY_OUT_MS);
    if (!alive.current) return;
    mapApi.current?.blur(false);
    setPhase("leaving");
    await wait(still ? 0 : SWAP_MS);
    if (alive.current) onClosed();
  };

  // What ARGUS watches at this house: last night's check from the Pi, or the copy in the data.
  const risk = live?.sites[mon.pilot_key]?.risk;
  const checks = new Map((risk?.scenarios ?? []).map((c) => [c.key, c]));
  const titles = new Map(mon.scenarios.map((s) => [s.scenario_key, s.plain.title]));
  const checkedAt = risk?.evaluated_at ?? loaded.assets.data.risk_checked_at;
  const pct = (p: number) => (p * 100 < 1 ? "<1" : number(p * 100, p < 0.1 ? 1 : 0));
  const dangers = loaded.assets.data.dangers.map((d) => {
    const check = risk ? checks.get(d.key) : undefined;
    const title = titles.get(d.key);
    return {
      key: d.key,
      level: d.level,
      title: title ? pick(title).split(" · ")[0] : d.key, // the house's name is the view's title
      probability: risk ? (check?.probability ?? null) : d.probability,
      watch: (risk ? check?.thresholds?.watch : null) ?? d.watch,
    };
  });
  // "See it happen": each effect that shows one or more of ARGUS's dangers here, the gravest first, with
  // the dangers it stands for (said under the buttons).
  const fx = new Map<Effect, { rank: number; titles: string[] }>();
  for (const d of dangers) {
    const e = effectOf(d.key, d.level);
    if (!e || (phase === "open" && houseRef.current && !houseRef.current.canWeather(e))) continue;
    const entry = fx.get(e) ?? { rank: -1, titles: [] };
    entry.rank = Math.max(entry.rank, LEVEL_RANK[d.level] ?? 0);
    if (!entry.titles.includes(d.title)) entry.titles.push(d.title);
    fx.set(e, entry);
  }
  const fxList = [...fx.entries()].sort((a, b) => b[1].rank - a[1].rank || EFFECTS.indexOf(a[0]) - EFFECTS.indexOf(b[0]));
  // How big the damage drawn is, and what that size rests on (math.ts, RATES).
  const d = damageAfter(years, watched, focus.kind);
  const one = (n: number) => number(n, n < 10 ? 1 : 0);
  const sizeLine =
    focus.kind === "mosaic" || focus.kind === "fresco"
      ? t("view3d.sizeDamp", { h: one(d.damp) })
      : focus.kind === "crack"
        ? t("view3d.sizeCrack", { mm: one(d.crackMm), m: one(d.crackM) })
        : focus.kind === "lean"
          ? t("view3d.sizeLean", { deg: number(d.lean, 2) })
          : focus.kind === "stone"
            ? t("view3d.sizeStone", { mm: number(d.surfaceMm, 1) })
            : focus.kind === "floor"
              ? t("view3d.sizeFloor", { m: one(d.wear) })
              : t("view3d.sizePlants", { p: number(d.plants * 100, 0) });
  // The same size in a few characters, next to the years.
  const shortSize =
    focus.kind === "mosaic" || focus.kind === "fresco"
      ? `💧 ${one(d.damp)} m`
      : focus.kind === "crack"
        ? `⚡ +${one(d.crackMm)} mm`
        : focus.kind === "lean"
          ? `↗ +${number(d.lean, 1)}°`
          : focus.kind === "stone"
            ? `−${number(d.surfaceMm, 1)} mm`
            : focus.kind === "floor"
              ? `👣 ${one(d.wear)} m`
              : `🌱 ${number(d.plants * 100, 0)}%`;
  const yearsText =
    years === 0 ? t("view3d.today") : years === 1 ? t("view3d.oneYear") : t("view3d.yearsN", { n: number(years, 0) });
  const panel = phase === "open";
  /** The next (or previous) effect in the list, round. */
  const stepEffect = (by: number) => {
    if (!fxList.length) return;
    const at = effect ? fxList.findIndex(([e]) => e === effect) : by > 0 ? -1 : 0;
    setEffect(fxList[(at + by + fxList.length) % fxList.length][0]);
  };

  return (
    <div
      ref={rootRef}
      className={`view3d${shown ? " is-shown" : ""}${phase === "open" ? " is-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="view3d-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          void close();
        }
      }}
    >
      <div className="view3d-stage" ref={stageRef} />
      <div className="view3d-top" ref={topRef}>
        <div className="view3d-head">
          <h2 id="view3d-title" ref={headingRef} tabIndex={-1}>
            {title}
          </h2>
          <p>{t(argusModel ? "view3d.subArgus" : "view3d.sub")}</p>
        </div>
        <button type="button" className="btn btn-secondary view3d-close" onClick={() => void close()}>
          <Icon name="cross" size={18} />
          <span className="view3d-close-text">{t("view3d.close")}</span>
        </button>
      </div>
      <div className="view3d-dock" ref={dockRef}>
        {panel && (
          <button
            type="button"
            className="view3d-fold"
            aria-expanded={!folded}
            aria-controls="view3d-panel"
            onClick={() => {
              setFolded(!folded);
              setPicking(false);
            }}
          >
            <span aria-hidden="true">{folded ? "▴" : "▾"}</span> {t(folded ? "view3d.show" : "view3d.hide")}
          </button>
        )}
        {panel && (
          <div className="view3d-panel" id="view3d-panel" hidden={folded}>
            {/* One row for time: play, the slider, how many years and how big the damage is then. */}
            <div className="view3d-time">
              <button
                type="button"
                className="view3d-play"
                aria-pressed={playing}
                aria-label={t(playing ? "view3d.pause" : "view3d.play")}
                title={t(playing ? "view3d.pause" : "view3d.play")}
                onClick={() => {
                  if (!playing && years >= MAX_YEARS) setYears(0);
                  setPlaying(!playing);
                }}
              >
                <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
              </button>
              <input
                id="view3d-years"
                type="range"
                min={0}
                max={MAX_YEARS}
                step={1}
                value={years}
                aria-label={t("view3d.years")}
                aria-valuetext={yearsText}
                onChange={(e) => {
                  setPlaying(false);
                  setYears(Number(e.target.value));
                }}
              />
              <strong className="view3d-years" aria-live="polite">
                {yearsText}
                {years > 0 && <span className="view3d-short"> · {shortSize}</span>}
              </strong>
            </div>
            {/* One row for what is shown: nobody or ARGUS watching, and the red sign. */}
            <div className="view3d-modes">
              <button type="button" aria-pressed={!watched} onClick={() => setWatched(false)}>
                {t("view3d.nobody")}
              </button>
              <button type="button" aria-pressed={watched} onClick={() => setWatched(true)}>
                {t("view3d.watched")}
              </button>
              <button
                type="button"
                className="view3d-sign"
                aria-pressed={highlight}
                aria-label={t("view3d.highlight")}
                title={t("view3d.legend")}
                onClick={() => setHighlight(!highlight)}
              >
                {t("view3d.highlightShort")}
              </button>
            </div>
            {/* "See it happen": the weather and the dangers here, one at a time (pressed again: stops). */}
            {fxList.length > 0 && (
              <div className="view3d-fx-row" role="group" aria-label={t("view3d.fxTitle")}>
                {effect && (
                  <button type="button" className="view3d-fx-step" aria-label={t("view3d.fxPrev")} onClick={() => stepEffect(-1)}>
                    <span aria-hidden="true">‹</span>
                  </button>
                )}
                <button
                  ref={pickTriggerRef}
                  type="button"
                  className={`view3d-fx-main${effect ? " is-on" : ""}`}
                  aria-haspopup="true"
                  aria-expanded={picking}
                  aria-controls="view3d-fx-picker"
                  onClick={() => setPicking(!picking)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && picking) {
                      e.preventDefault();
                      e.stopPropagation();
                      setPicking(false);
                    }
                  }}
                >
                  <span className="view3d-fx-main-text">
                    {effect ? (
                      <>
                        {FX_SIGN[effect] && <span aria-hidden="true">{FX_SIGN[effect]} </span>}
                        {t(`view3d.fx_${effect}` as MessageKey)}
                      </>
                    ) : (
                      t("view3d.fxTitle")
                    )}
                  </span>
                  <span aria-hidden="true">{picking ? "▴" : "▾"}</span>
                </button>
                {effect && (
                  <button type="button" className="view3d-fx-step" aria-label={t("view3d.fxNext")} onClick={() => stepEffect(1)}>
                    <span aria-hidden="true">›</span>
                  </button>
                )}
                {effect && (
                  <button type="button" className="view3d-fx-stop" onClick={() => setEffect(null)}>
                    <Icon name="cross" size={16} />
                    <span>{t("view3d.fxStop")}</span>
                  </button>
                )}
              </div>
            )}
            {effect && fx.get(effect) && (
              <div className="view3d-fx-note-box">
                <p className={`view3d-note view3d-fx-note${noteOpen ? "" : " is-clamped"}`} aria-live="polite">
                  {t(`view3d.fxNote_${effect}` as MessageKey)} {t("view3d.fxDangers", { list: list(fx.get(effect)!.titles) })}
                </p>
                <button type="button" className="view3d-more-btn" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>
                  {t(noteOpen ? "view3d.noteLess" : "view3d.noteMore")}
                </button>
              </div>
            )}
            {/* The rest, for whoever asks: what the picture shows, how big and on what grounds, the dangers. */}
            <details className="view3d-dangers">
              <summary>{t("view3d.more")}</summary>
              <p className="view3d-note">{t(noteKey(focus.kind, watched))}</p>
              {years > 0 && <p className="view3d-note">{sizeLine}</p>}
              <p className="view3d-note view3d-legend">{t("view3d.legend")}</p>
              {loaded.assets.data.sensors3d.length > 0 && <p className="view3d-note">{t("view3d.sensorsNote")}</p>}
              <h3 className="view3d-dangers-title">{t(loaded.assets.data.rooms.length ? "view3d.dangers" : "view3d.dangersHere")}</h3>
              <p className="small">
                {checkedAt ? t("view3d.checked", { when: formatWhen(new Date(checkedAt), new Date(), locale) }) : t("view3d.noCheck")}
              </p>
              <ul tabIndex={0} aria-label={t(loaded.assets.data.rooms.length ? "view3d.dangers" : "view3d.dangersHere")}>
                {dangers.map((d) => (
                  <li key={d.key}>
                    <span className="view3d-level">{t(`level.${d.level}` as MessageKey)}</span> {d.title}{" "}
                    <span className="small">
                      {d.probability !== null && d.watch !== null
                        ? t("view3d.chance", { p: pct(d.probability), w: pct(d.watch) })
                        : t("view3d.notNightly")}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        {panel && picking && !folded && (
          <div
            ref={pickerRef}
            id="view3d-fx-picker"
            className="view3d-fx-picker"
            role="group"
            aria-label={t("view3d.fxPicker")}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setPicking(false);
                pickTriggerRef.current?.focus();
                return;
              }
              // arrows move between the tiles
              const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".view3d-fx-grid button")];
              const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
              const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? tiles.length - 1 : null;
              if (to === null || at < 0) return;
              e.preventDefault();
              tiles[(to + tiles.length) % tiles.length].focus();
            }}
          >
            <p className="view3d-fx-picker-title">{t("view3d.fxPicker")}</p>
            <div className="view3d-fx-grid">
              {fxList.map(([e]) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={effect === e}
                  onClick={() => {
                    setEffect(effect === e ? null : e);
                    setPicking(false);
                    pickTriggerRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <span className="view3d-fx-sign" aria-hidden="true">
                    {FX_SIGN[e]}
                  </span>
                  <span>{t(`view3d.fx_${e}` as MessageKey)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* The sources in one line; all of them when asked. */}
        <details className="view3d-credits">
          <summary>{t("view3d.sources")}</summary>
          <p>{t(!argusModel ? "view3d.credits" : loaded.assets.data.cut_above_m != null ? "view3d.creditsArgus" : "view3d.creditsModel")}</p>
        </details>
      </div>
    </div>
  );
}

/** "Display in 3D" under the drawings (or a place's name, `label`, for the other scenes of the
 *  monument). The view starts loading as soon as the button comes into sight (or is pointed at), so a
 *  tap finds it ready; if it is not yet, the button says so and the view opens when it is. */
export function Open3dButton({
  scene,
  data,
  focus,
  onOpen,
  label,
  id = "view3d-open",
}: {
  scene: string;
  data: GameData;
  focus: Focus3d;
  onOpen: (scene: string, loaded: Loaded, focus: Focus3d, from: string) => void;
  label?: string;
  id?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle");
  const warm = useCallback(() => {
    preload3d(scene, data).catch(() => {}); // a failure is shown when the player asks for the view
  }, [scene, data]);
  useEffect(() => {
    const button = ref.current;
    if (!button || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      warm();
      seen.disconnect();
    });
    seen.observe(button);
    return () => seen.disconnect();
  }, [warm]);
  const open = () => {
    if (state === "waiting") return;
    setState("waiting");
    preload3d(scene, data).then(
      (loaded) => {
        setState("idle");
        onOpen(scene, loaded, focus, id);
      },
      () => setState("failed"),
    );
  };
  const note = state === "waiting" ? "consequence.view3dWait" : state === "failed" ? "consequence.view3dFailed" : label ? null : "consequence.view3dNote";
  return (
    <div className={label ? "consequence-3d is-place" : "consequence-3d"}>
      <button
        ref={ref}
        type="button"
        id={id}
        className="btn btn-secondary"
        aria-describedby={`${id}-note`}
        aria-disabled={state === "waiting" || undefined}
        onClick={open}
        onPointerEnter={warm}
        onFocus={warm}
      >
        <Icon name="cube" />
        {label ?? t("consequence.view3d")}
      </button>
      <p className="small" id={`${id}-note`} role="status">
        {note && t(note)}
      </p>
    </div>
  );
}
