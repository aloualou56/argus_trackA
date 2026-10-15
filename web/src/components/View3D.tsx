// The 3D view of a consequence (README, "3D view"): "Display in 3D" under the "If nobody had
// noticed" drawings. Everything is loaded first (view3d/preload.ts) and the scene is built and drawn
// unseen; only then does the game's own map fly down onto the house. Under a blur the 3D view takes
// over from the very same picture, seen straight from above, and the camera comes down to the rooms.
// "Back to the map" goes the same way back. While it is open the rest of the game waits (inert).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { motionReduced } from "../a11y/settings";
import { formatWhen, loadLive, type LiveFile } from "../game/live";
import type { GameData, Monument } from "../game/types";
import { useI18n, type MessageKey } from "../i18n";
import type { House, HouseRoom } from "../view3d/house";
import { damageAfter, MAP_ZOOM, metresPerPixel } from "../view3d/math";
import { preload3d, type Loaded } from "../view3d/preload";
import type { MapApi } from "./GameMap";
import { Icon } from "./Icon";

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

interface Props {
  mon: Monument;
  loaded: Loaded;
  mapApi: MutableRefObject<MapApi | null>;
  /** The map has flown down onto the house: the 3D view may take over. */
  arrived: boolean;
  /** The scene is built and drawn: the map may fly down. */
  onReady: () => void;
  /** Back on the map (or 3D could not be drawn after all): the game leaves the view. */
  onClosed: () => void;
}

export function View3D({ mon, loaded, mapApi, arrived, onReady, onClosed }: Props) {
  const { t, pick, number, locale } = useI18n();
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
  const [live, setLive] = useState<LiveFile | null>(null);
  const shown = phase === "swapping" || phase === "flying" || phase === "open" || phase === "closing";

  // Built and drawn once, unseen, at the picture the map will show when it has flown down.
  useEffect(() => {
    alive.current = true;
    const stage = stageRef.current!;
    const roomLabel = (r: HouseRoom) => {
      const key = `view3d.room${r.room}` as MessageKey;
      const name = t(key);
      return t("view3d.room", { n: r.room, name: name === key ? r.name : name });
    };
    let house: House;
    try {
      house = loaded.house.createHouse(stage, loaded.assets, { roomLabel, canvasLabel: t("view3d.canvas") });
    } catch {
      onClosed(); // no 3D on this device after all: the map stays as it was
      return;
    }
    houseRef.current = house;
    const fit = () => house.resize(stage.clientWidth, stage.clientHeight);
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(stage);
    house.setDamage(damageAfter(0, false));
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
    houseRef.current?.setDamage(damageAfter(years, watched));
  }, [years, watched]);

  // Once open, the rooms are framed between the title and the panel (which grows with the dangers).
  useEffect(() => {
    const [house, stage, top, dock] = [houseRef.current, stageRef.current, topRef.current, dockRef.current];
    if (phase !== "open" || !house || !stage || !top || !dock) return;
    const measure = () => {
      const box = stage.getBoundingClientRect();
      house.setInsets(top.getBoundingClientRect().bottom - box.top, box.bottom - dock.getBoundingClientRect().top);
    };
    measure();
    const resize = new ResizeObserver(measure);
    for (const el of [stage, top, dock]) resize.observe(el);
    return () => resize.disconnect();
  }, [phase]);

  const close = async () => {
    const house = houseRef.current;
    if (!house || (phase !== "open" && phase !== "flying")) return;
    const still = motionReduced();
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
  const yearsText =
    years === 0 ? t("view3d.today") : years === 1 ? t("view3d.oneYear") : t("view3d.yearsN", { n: number(years, 0) });
  const panel = phase === "open";

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
            {t("view3d.title")}
          </h2>
          <p>{t("view3d.sub")}</p>
        </div>
        <button type="button" className="btn btn-secondary view3d-close" onClick={() => void close()}>
          <Icon name="cross" size={18} />
          {t("view3d.close")}
        </button>
      </div>
      <div className="view3d-dock" ref={dockRef}>
        {panel && (
          <div className="view3d-panel">
            <label className="view3d-years" htmlFor="view3d-years">
              <span>{t("view3d.years")}</span>
              <strong>{yearsText}</strong>
            </label>
            <input
              id="view3d-years"
              type="range"
              min={0}
              max={MAX_YEARS}
              step={1}
              value={years}
              aria-valuetext={yearsText}
              onChange={(e) => setYears(Number(e.target.value))}
            />
            <div className="view3d-modes">
              <button type="button" aria-pressed={!watched} onClick={() => setWatched(false)}>
                {t("view3d.nobody")}
              </button>
              <button type="button" aria-pressed={watched} onClick={() => setWatched(true)}>
                {t("view3d.watched")}
              </button>
            </div>
            <p className="view3d-note" aria-live="polite">
              {t(watched ? "view3d.noteWatched" : "view3d.noteNobody")}
            </p>
            <details className="view3d-dangers">
              <summary>{t("view3d.dangers")}</summary>
              <p className="small">
                {checkedAt ? t("view3d.checked", { when: formatWhen(new Date(checkedAt), new Date(), locale) }) : t("view3d.noCheck")}
              </p>
              <ul tabIndex={0} aria-label={t("view3d.dangers")}>
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
        <p className="view3d-credits">{t("view3d.credits")}</p>
      </div>
    </div>
  );
}

/** "Display in 3D" under the drawings. The view starts loading as soon as the button comes into
 *  sight (or is pointed at), so a tap finds it ready; if it is not yet, the button says so and the
 *  view opens when it is. */
export function Open3dButton({ scene, data, onOpen }: { scene: string; data: GameData; onOpen: (scene: string, loaded: Loaded) => void }) {
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
        onOpen(scene, loaded);
      },
      () => setState("failed"),
    );
  };
  return (
    <div className="consequence-3d">
      <button
        ref={ref}
        type="button"
        id="view3d-open"
        className="btn btn-secondary"
        aria-describedby="view3d-open-note"
        aria-disabled={state === "waiting" || undefined}
        onClick={open}
        onPointerEnter={warm}
        onFocus={warm}
      >
        <Icon name="cube" />
        {t("consequence.view3d")}
      </button>
      <p className="small" id="view3d-open-note" role="status">
        {t(state === "waiting" ? "consequence.view3dWait" : state === "failed" ? "consequence.view3dFailed" : "consequence.view3dNote")}
      </p>
    </div>
  );
}
