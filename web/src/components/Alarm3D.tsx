// The day's alarm in 3D (README, "The alarm in 3D"): while the alarm plays (App.tsx), once the map has
// shown it, the game's own map flies down onto the place and, under a blur, ARGUS's model of it takes
// over from the very same picture: the camera comes down in a spiral to the sensor that raised it, red
// waves spreading from it and a beam of light over it, then circles it slowly until the player goes on.
// Nothing in it to read or press: the alarm's own banner and button stay over it.
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { motionReduced } from "../a11y/settings";
import { useI18n } from "../i18n";
import type { House } from "../view3d/house";
import { MAP_ZOOM, metresPerPixel } from "../view3d/math";
import type { Focus3d, Loaded } from "../view3d/preload";
import type { MapApi } from "./GameMap";

const SWAP_MS = 700; // the blur between the map and the 3D view (styles.css, ".view3d")
const DOWN_MS = 4200;
const SPIN = Math.PI * 0.75; // a little over a third of a turn on the way down

interface Props {
  loaded: Loaded;
  focus: Focus3d;
  mapApi: MutableRefObject<MapApi | null>;
  /** The map has flown down onto the place: the 3D view may take over. */
  arrived: boolean;
  /** The scene is built and drawn, unseen: the map may fly down. */
  onReady: () => void;
  /** The camera is down at the alarm. */
  onDown: () => void;
  /** No 3D on this device after all: the alarm stays on the map. */
  onFailed: () => void;
}

export function Alarm3D({ loaded, focus, mapApi, arrived, onReady, onDown, onFailed }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const houseRef = useRef<House | null>(null);
  const alive = useRef(true);
  const [phase, setPhase] = useState<"building" | "ready" | "shown">("building");

  // Built and drawn once, unseen, at the picture the map will show when it has flown down.
  useEffect(() => {
    alive.current = true;
    const stage = stageRef.current!;
    const { origin, metres_per_degree: [kx, ky] } = loaded.assets.data;
    const xy: [number, number] | null = focus.at ? [(focus.at[1] - origin.lon) * kx, (focus.at[0] - origin.lat) * ky] : null;
    let house: House;
    try {
      house = loaded.house.createHouse(stage, loaded.assets, {
        roomLabel: (r) => t("view3d.room", { n: r.room, name: r.name }),
        canvasLabel: t("event.heading"),
        focus: { serial: focus.serial, xy, kind: focus.kind },
        still: motionReduced(),
        alarm: true,
      });
    } catch {
      onFailed();
      return;
    }
    houseRef.current = house;
    const fit = () => house.resize(stage.clientWidth, stage.clientHeight);
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(stage);
    house.setHighlight(false); // today: the alarm, not yet any damage
    house.matchMap({ center: loaded.assets.centre, metresPerPixel: metresPerPixel(loaded.assets.centre[0], MAP_ZOOM) });
    house.renderOnce();
    setPhase("ready");
    onReady();
    return () => {
      alive.current = false;
      resize.disconnect();
      house.dispose();
      houseRef.current = null;
      mapApi.current?.blur(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // The map is there: the same picture in 3D under a blur, then down to the alarm.
  useEffect(() => {
    const house = houseRef.current;
    if (!arrived || phase !== "ready" || !house) return;
    const still = motionReduced();
    const view = mapApi.current?.view();
    if (view) house.matchMap({ center: view.center, metresPerPixel: metresPerPixel(view.center[0], view.zoom) });
    house.setAlarm(true);
    house.start();
    mapApi.current?.blur(true);
    setPhase("shown");
    void (async () => {
      await new Promise((done) => window.setTimeout(done, still ? 0 : SWAP_MS));
      if (!alive.current) return;
      await house.flyIn(still ? 0 : DOWN_MS, still ? 0 : SPIN);
      if (!alive.current) return;
      house.orbit(true);
      onDown();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, phase]);

  // A picture only, out of the keyboard's and the screen reader's way: what it shows the alarm's banner
  // says in words (and the replay announced it). The camera can still be turned by touch or mouse.
  useLayoutEffect(() => {
    rootRef.current?.querySelector("canvas")?.setAttribute("tabindex", "-1");
  }, [phase]);
  return (
    <div ref={rootRef} className={`view3d view3d-alarm${phase === "shown" ? " is-shown" : ""}`} aria-hidden="true">
      <div className="view3d-stage" ref={stageRef} />
    </div>
  );
}
