// The game board: one Leaflet map that stays mounted across screens. Screens change what is
// drawn (mode), never the map itself. Sensor positions come from ARGUS (installed-devices
// coordinates); base-map tiles are only a backdrop, so the game still works if they fail.
//
// Accessibility: the map is optional for playing (every action also exists in the panel).
// The container is keyboard focusable (arrow keys pan, +/- zoom), pins are buttons with
// labels, and nothing animates when the user prefers reduced motion.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { clusterPoints, countPicks, detects, formatCoords, nativeZoom, ruleFor } from "../game/logic";
import type { Alarm, Basemap, GameData, LatLng, MapPoint, Monument, Placement } from "../game/types";
import { useI18n } from "../i18n";
import { Icon, iconSvg } from "./Icon";
import { motionReduced } from "../a11y/settings";

// "history": the whole story of a site; chapters move the map to the place they are about.
export type MapMode = "overview" | "story" | "history" | "mission" | "reveal" | "event" | "score" | "report" | "replay";

export interface MapApi {
  /** Centre of the current view: where the crosshair is. */
  center(): LatLng;
  /** Move the view (and so the crosshair) to a place. */
  focus(at: LatLng): void;
  /** Map position under a screen point (for drag and drop), or null when the point is off the map. */
  latLngAt(clientX: number, clientY: number): LatLng | null;
  /** Where the view is and how close: the 3D view starts from the very same picture. */
  view(): { center: LatLng; zoom: number };
  /** Blurs the map (the hand-over to and from the 3D view, styles.css). */
  blur(on: boolean): void;
}

interface Props {
  data: GameData;
  mode: MapMode;
  pilot: string | null;
  placements: Placement[];
  alarm: Alarm | null;
  apiRef: MutableRefObject<MapApi | null>;
  onSelectSite: (pilot: string) => void;
  onMovePlacement: (id: string, at: LatLng) => void;
  onRemovePlacement: (id: string) => void;
  /** "report" mode: the spot of the observation report, if marked. */
  reportPin?: LatLng | null;
  /** "report" mode: called when the visitor taps the map or drags the pin; absent while a finished card is shown. */
  onReportPin?: (at: LatLng) => void;
  /** "replay" mode (the real alarm playing after "Done"): the player skips the rest of it. */
  onReplaySkip?: () => void;
  /** The 3D view (View3D.tsx): the map flies down onto this spot, then calls onArrived3d once its
   *  tiles are in. Null: the screen's own view (and back to it after the 3D view). */
  view3d?: { center: LatLng; zoom: number } | null;
  onArrived3d?: () => void;
  /** Drawn over the map (the 3D view); the map and its controls cannot be used meanwhile. */
  overlay?: ReactNode;
  /** "replay" mode: the picture is complete, and the button goes on to the answer. */
  replayOver?: boolean;
}

// Placement reticle, drawn like a surveyor's mark: four arms and a small ring leave the centre
// open; the point is the exact spot a new sensor goes. Ink on a white casing, so it reads on dark
// satellite imagery and on the light plan alike, and is never taken for a (blue) sensor. The arms
// are longer than a pin, so they still show around a sensor that sits on the spot.
const RETICLE_SHAPES = '<path d="M32 2v19M32 43v19M2 32h19M43 32h19"/><circle cx="32" cy="32" r="6.5"/>';
const RETICLE = `<svg width="64" height="64" viewBox="0 0 64 64" focusable="false">
  <g class="reticle-casing">${RETICLE_SHAPES}</g>
  <g class="reticle-ink">${RETICLE_SHAPES}</g>
  <circle class="reticle-dot" cx="32" cy="32" r="2"/>
</svg>`;

const BASEMAP_KEY = "guardian.basemap";

type Backdrop = GeoJSON.FeatureCollection<GeoJSON.Geometry, { kind: string; name?: string }>;
const backdropCache = new Map<string, Promise<Backdrop>>();

/** Drawn-plan outlines (OpenStreetMap / Natural Earth) shipped with the game; fetched once. */
function loadBackdrop(path: string): Promise<Backdrop> {
  if (!backdropCache.has(path)) {
    const request = fetch(`${import.meta.env.BASE_URL}${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json() as Promise<Backdrop>;
    });
    request.catch(() => backdropCache.delete(path));
    backdropCache.set(path, request);
  }
  return backdropCache.get(path)!;
}
// Imagery stops at zoom 19; one step of over-zoom keeps sensors a few metres apart readable.
const MONUMENT_MAX_ZOOM = 20;
const PIN = 30;
const MAP_MAX_ZOOM = 21;
// One world only: the map cannot leave these bounds, tiles do not repeat sideways, and it cannot
// zoom out further than the world filling the map (see fitWorld).
const WORLD = L.latLngBounds([-85.0511, -180], [85.0511, 180]);

function savedBasemap(data: GameData): string {
  try {
    const saved = window.localStorage.getItem(BASEMAP_KEY);
    if (saved && data.basemaps.layers.some((l) => l.id === saved)) return saved;
  } catch {
    // storage blocked: use the default
  }
  return data.basemaps.default;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function attributionHtml(layer: Basemap): string {
  const text = escapeHtml(layer.attribution);
  return layer.attribution_url ? `<a href="${escapeHtml(layer.attribution_url)}" target="_blank" rel="noopener">${text}</a>` : text;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Give a Leaflet marker an accessible name once it is on the map. */
function label(marker: L.Marker, text: string): L.Marker {
  const node = marker.getElement();
  if (node) {
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", text);
    node.removeAttribute("title");
  }
  return marker;
}

export function GameMap(props: Props) {
  const { data, mode, pilot, placements, alarm } = props;
  const reportPin = props.reportPin ?? null;
  const reportEditable = !!props.onReportPin;
  const { t, pick, lang, date } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{ sites: L.LayerGroup; places: L.LayerGroup; argus: L.LayerGroup; player: L.LayerGroup; alarm: L.LayerGroup } | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const zoomRef = useRef<L.Control.Zoom | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [basemap, setBasemap] = useState(() => savedBasemap(data));
  const [tilesFailed, setTilesFailed] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  const [noticeClosed, setNoticeClosed] = useState(false);
  const [moving, setMoving] = useState(false);
  const reticleRef = useRef<L.Marker | null>(null);
  const declutterRef = useRef<() => void>(() => {});
  // Pins that would sit on top of each other when the map is zoomed out (the monuments on the
  // overview, the sensors on the alarm, reveal and score screens) are drawn a few pixels apart, so
  // each can still be tapped (WCAG 2.5.8, target size). Their true place is kept and used again at
  // every zoom; the alarm's own sensor never moves, as its ring is drawn there. While placing
  // sensors, a pin moved by the player is saved where it was dropped, not where it was drawn.
  const spreadRef = useRef<{ marker: L.Marker; at: L.LatLng; size: number; fixed: boolean }[]>([]);
  const pinned = placements.filter((p) => p.lat !== null).length;
  const planLayer = data.basemaps.layers.find((l) => l.type === "vector");
  const activeLayer = data.basemaps.layers.find((l) => l.id === basemap) ?? data.basemaps.layers[0];
  const isPlan = activeLayer.type === "vector";
  const backdropRef = useRef<L.LayerGroup | null>(null);
  const cards = useMemo(() => new Map(data.cards.cards.map((c) => [c.id, c])), [data]);
  const mon = data.monuments.find((m) => m.pilot_key === pilot) ?? null;
  // Real imagery runs out at different zooms per site (Delos: 18); never ask deeper than that.
  const imageryZoom = nativeZoom(activeLayer, mode === "overview" ? null : mon);
  const playable = mon && mon.playable ? (mon as Monument) : null;
  const cardName = (id: string | null, fallback = "") => (id ? pick(cards.get(id)?.name) : fallback);

  // ---------------------------------------------------------------- create once
  useEffect(() => {
    const map = L.map(containerRef.current!, {
      zoomControl: false,
      maxZoom: MAP_MAX_ZOOM,
      maxBounds: WORLD,
      maxBoundsViscosity: 1,
      zoomSnap: 0.5,
      keyboard: true,
      zoomAnimation: !motionReduced(),
      fadeAnimation: !motionReduced(),
      markerZoomAnimation: !motionReduced(),
    }).setView([45, 10], 4);
    // The credits name the map data and pictures (required). The library's own badge is optional.
    map.attributionControl.setPrefix(false);
    map.createPane("backdrop").style.zIndex = "250"; // above tiles, below sensors
    // The site guide (numbers and names of places) is a note on the sheet: it lies under the
    // reticle, so the spot being chosen is never hidden by a name.
    const placesPane = map.createPane("places");
    placesPane.style.zIndex = "540";
    placesPane.style.pointerEvents = "none";
    const reticlePane = map.createPane("reticle"); // above the plan and the site guide, below the pins
    reticlePane.style.zIndex = "550";
    reticlePane.style.pointerEvents = "none";
    backdropRef.current = L.layerGroup().addTo(map);
    layersRef.current = {
      sites: L.layerGroup().addTo(map),
      places: L.layerGroup().addTo(map),
      alarm: L.layerGroup().addTo(map),
      argus: L.layerGroup().addTo(map),
      player: L.layerGroup().addTo(map),
    };
    // In the mission, a tap moves the crosshair there; the panel's "+" then places a sensor.
    map.on("movestart", () => setMoving(true));
    map.on("moveend", () => setMoving(false));
    map.on("move", () => reticleRef.current?.setLatLng(map.getCenter()));
    map.on("zoomend moveend resize", () => declutterRef.current());
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (latest.current.mode === "mission") map.panTo(e.latlng, { animate: !motionReduced() });
      // In the observation report, a tap marks the spot.
      if (latest.current.mode === "report") latest.current.onReportPin?.([e.latlng.lat, e.latlng.lng]);
    });
    props.apiRef.current = {
      center: () => {
        const c = map.getCenter();
        return [c.lat, c.lng];
      },
      focus: (at) => map.flyTo(at, Math.max(map.getZoom(), 18), { animate: !motionReduced(), duration: 1.2 }),
      latLngAt: (clientX, clientY) => {
        const box = map.getContainer().getBoundingClientRect();
        if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null;
        const at = map.containerPointToLatLng([clientX - box.left, clientY - box.top]);
        return [at.lat, at.lng];
      },
      view: () => {
        const c = map.getCenter();
        return { center: [c.lat, c.lng], zoom: map.getZoom() };
      },
      blur: (on) => map.getContainer().classList.toggle("is-blurred", on),
    };
    // Map furniture, as on a printed sheet: a true scale bar, and the position of the centre of the
    // view (in the mission, that is the spot under the cross). Decorative for screen readers: the
    // readout changes with every movement.
    L.control.scale({ position: "bottomright", metric: true, imperial: false, maxWidth: 110 }).addTo(map);
    const coords = L.DomUtil.create("div", "map-coords");
    coords.setAttribute("aria-hidden", "true");
    const coordsControl = new L.Control({ position: "bottomright" });
    coordsControl.onAdd = () => coords;
    coordsControl.addTo(map);
    const showCoords = () => {
      const centre = map.getCenter();
      coords.textContent = formatCoords([centre.lat, centre.lng]);
    };
    map.on("move", showCoords);
    showCoords();
    // The furthest zoom out is the one where a single world still fills the map, however wide it is.
    const fitWorld = () => map.setMinZoom(map.getBoundsZoom(WORLD, true));
    fitWorld();
    const resize = new ResizeObserver(() => {
      map.invalidateSize();
      fitWorld();
    });
    resize.observe(containerRef.current!);
    mapRef.current = map;
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      props.apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- base map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = activeLayer;
    tilesRef.current?.remove();
    tilesRef.current = null;
    setTilesFailed(false);
    // At most two levels of stretching past the real imagery (4x); beyond that it is only blur.
    map.setMaxZoom(Math.min(MAP_MAX_ZOOM, (layer.type === "vector" ? MAP_MAX_ZOOM : imageryZoom ?? MAP_MAX_ZOOM) + 2));
    if (layer.type === "vector" || !layer.url) {
      map.attributionControl.addAttribution(attributionHtml(layer));
      return () => {
        map.attributionControl.removeAttribution(attributionHtml(layer));
      };
    }
    if (!navigator.onLine && planLayer) {
      setFellBack(true);
      setBasemap(planLayer.id);
      return;
    }
    let loaded = 0;
    const tiles = L.tileLayer(layer.url, {
      maxNativeZoom: imageryZoom,
      maxZoom: MAP_MAX_ZOOM,
      noWrap: true,
      bounds: WORLD,
      attribution: attributionHtml(layer),
    })
      .on("tileload", () => {
        loaded += 1;
        setTilesFailed(false);
      })
      .on("tileerror", () => {
        if (loaded > 0) return;
        // No picture has loaded at all (offline, or outside images are blocked): use the plan.
        if (planLayer) {
          setFellBack(true);
          setBasemap(planLayer.id);
        } else {
          setTilesFailed(true);
        }
      })
      .addTo(map);
    tiles.bringToBack();
    tilesRef.current = tiles;
    try {
      if (!fellBack) window.localStorage.setItem(BASEMAP_KEY, basemap);
    } catch {
      // not remembered, still works
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, data, imageryZoom]);

  // ---------------------------------------------------------------- placement reticle (mission only)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode !== "mission") return;
    const reticle = L.marker(map.getCenter(), {
      pane: "reticle",
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: "", html: `<div class="crosshair">${RETICLE}</div>`, iconSize: [64, 64], iconAnchor: [32, 32] }),
    }).addTo(map);
    reticleRef.current = reticle;
    return () => {
      reticle.remove();
      reticleRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    reticleRef.current?.getElement()?.querySelector(".crosshair")?.classList.toggle("is-moving", moving);
  }, [moving]);

  // Replay the small "drop" each time a pin is added.
  const lastPinned = useRef(pinned);
  useEffect(() => {
    const node = reticleRef.current?.getElement()?.querySelector<HTMLElement>(".crosshair");
    if (node && pinned > lastPinned.current) {
      node.classList.remove("just-placed");
      void node.offsetWidth; // restart the animation
      node.classList.add("just-placed");
    }
    lastPinned.current = pinned;
  }, [pinned]);

  // ---------------------------------------------------------------- drawn plan (vector backdrop)
  useEffect(() => {
    const group = backdropRef.current;
    if (!group) return;
    group.clearLayers();
    if (!isPlan) return;
    let cancelled = false;
    const paths = [data.basemaps.world, mode !== "overview" ? mon?.backdrop : null].filter((p): p is string => !!p);
    Promise.all(paths.map(loadBackdrop))
      .then((collections) => {
        if (cancelled) return;
        for (const collection of collections) {
          L.geoJSON(collection, {
            pane: "backdrop",
            interactive: false,
            style: (feature) => ({ className: `bd bd-${feature?.properties.kind ?? "other"}` }),
            onEachFeature: (feature, layer) => {
              // Name the monument while the story is told; later its label would hide sensors.
              if (mode === "story" && !mon?.playable && feature.properties.kind === "heritage" && feature.properties.name) {
                layer.bindTooltip(el("span", "", feature.properties.name), {
                  permanent: true,
                  direction: "center",
                  className: "plan-label",
                });
              }
            },
          }).addTo(group);
        }
      })
      .catch(() => !cancelled && setTilesFailed(true));
    return () => {
      cancelled = true;
    };
  }, [isPlan, mode, mon, data]);

  // ---------------------------------------------------------------- translated controls and labels
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    zoomRef.current?.remove();
    zoomRef.current = L.control
      .zoom({ position: "topleft", zoomInTitle: t("map.zoomIn"), zoomOutTitle: t("map.zoomOut") })
      .addTo(map);
    const node = containerRef.current!;
    node.setAttribute("role", "application");
    node.setAttribute("aria-roledescription", t("map.roledescription"));
    node.setAttribute(
      "aria-label",
      mode === "overview" || !mon ? t("map.overviewLabel") : t("map.label", { name: mon.display_name ? pick(mon.display_name) : mon.name }),
    );
    node.setAttribute("aria-describedby", "map-help");
  }, [t, pick, mode, mon]);

  // ---------------------------------------------------------------- the real alarm playing (after "Done")
  const replayRule = mode === "replay" && alarm && playable ? ruleFor(data, playable, alarm) : null;
  const replayLine =
    alarm && replayRule
      ? t(alarm.type === "DL" ? "event.whatAi" : "event.what", { date: date(alarm.timestamp), measures: pick(replayRule.measures) })
      : "";
  const skipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === "replay") skipRef.current?.focus({ preventScroll: true });
  }, [mode]);

  // ---------------------------------------------------------------- camera: only when the screen changes
  const viewKey = `${mode}|${pilot}|${alarm?.id ?? ""}|${props.view3d ? "3d" : ""}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // On small screens the map changes size from one screen to the next: measure it now, or the
    // view below is framed for the size it had on the previous screen. (Wide screens keep the
    // map's size, and are left exactly as they were.)
    if (!window.matchMedia("(min-width: 60rem)").matches) map.invalidateSize({ pan: false });
    // "Display in 3D": down onto the house. The 3D view takes over once the picture there is whole
    // (its last tiles in, or after 1.5 s at most), so the blur never hides a half-drawn map.
    const to3d = latest.current.view3d;
    if (to3d) {
      let done = false;
      let timer = 0;
      const arrived = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        latest.current.onArrived3d?.();
      };
      const settle = () => {
        window.clearTimeout(timer);
        const tiles = tilesRef.current;
        if (!tiles?.isLoading()) return arrived();
        tiles.once("load", arrived);
        timer = window.setTimeout(arrived, 1500);
      };
      const still = motionReduced();
      map.once("moveend", settle);
      timer = window.setTimeout(settle, still ? 500 : 4000); // should moveend never come
      map.flyTo(to3d.center, to3d.zoom, { animate: !still, duration: 1.8 });
      return () => {
        done = true;
        window.clearTimeout(timer);
        map.off("moveend", settle);
        tilesRef.current?.off("load", arrived);
      };
    }
    // Extra room top-left keeps markers and their labels clear of the zoom buttons and switch.
    // On a short map the margins shrink, or they would leave almost no room and push the view far out.
    const quarter = map.getSize().y / 4;
    const options = {
      animate: !motionReduced(),
      duration: 1.6,
      paddingTopLeft: L.point(70, Math.min(90, quarter)),
      paddingBottomRight: L.point(48, Math.min(84, quarter)), // clear of the legend and attribution
      maxZoom: MONUMENT_MAX_ZOOM,
    };
    // While the alarm plays its banner covers the top of the map and "Skip" the bottom: the alarm and
    // the player's sensors are framed between them, never under them.
    if (mode === "replay" && containerRef.current?.parentElement) {
      const box = containerRef.current.getBoundingClientRect();
      const banner = containerRef.current.parentElement.querySelector(".replay-banner")?.getBoundingClientRect();
      const skip = containerRef.current.parentElement.querySelector(".replay-skip")?.getBoundingClientRect();
      if (banner) options.paddingTopLeft = L.point(70, banner.bottom - box.top + 24);
      if (skip) options.paddingBottomRight = L.point(48, box.bottom - skip.top + 24);
    }
    // A short map strip (the alarm, the score on a phone) has its legend at the top (styles.css):
    // the view starts below it, so it never covers the alarm or its label.
    const legend = containerRef.current?.parentElement?.querySelector(".map-legend")?.getBoundingClientRect();
    if (mode !== "replay" && legend?.height && containerRef.current) {
      const box = containerRef.current.getBoundingClientRect();
      if (legend.top - box.top < box.height / 3) {
        options.paddingTopLeft = L.point(70, Math.max(options.paddingTopLeft.y, legend.bottom - box.top + 12));
      }
    }
    if (mode === "overview" || !mon?.map) {
      const centres = data.monuments.filter((m) => m.map).map((m) => m.map!.center);
      map.flyToBounds(L.latLngBounds(centres).pad(0.2), { ...options, maxZoom: 6 });
      return;
    }
    const bounds = L.latLngBounds(mon.map.bounds);
    if (mode === "reveal" || mode === "score") {
      placements.forEach((p) => p.lat !== null && p.lng !== null && bounds.extend([p.lat, p.lng]));
    }
    if ((mode === "event" || mode === "replay") && alarm) {
      const at = alarm.instruments.find((i) => i.lat !== null && i.lon !== null);
      if (at) {
        const focus = L.latLngBounds([[at.lat!, at.lon!]]);
        placements.forEach((p) => p.lat !== null && p.lng !== null && focus.extend([p.lat, p.lng]));
        map.flyToBounds(focus, options);
        return;
      }
    }
    map.flyToBounds(bounds, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // ---------------------------------------------------------------- what is drawn
  useEffect(() => {
    const layers = layersRef.current;
    const map = mapRef.current;
    if (!layers || !map) return;
    Object.values(layers).forEach((g) => g.clearLayers());
    spreadRef.current = [];

    if (mode === "overview") {
      for (const m of data.monuments) {
        if (!m.map) continue;
        const name = m.display_name ? pick(m.display_name) : m.name;
        const place = m.place ? pick(m.place) : m.country;
        const selected = m.pilot_key === pilot;
        const marker = L.marker(m.map.center, {
          keyboard: m.playable,
          interactive: true,
          zIndexOffset: selected ? 1000 : 0,
          icon: L.divIcon({
            className: "",
            html: `<span class="site-pin${m.playable ? "" : " is-soon"}${selected ? " is-selected" : ""}">${iconSvg("shield", 18)}</span>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
        })
          .bindTooltip(el("span", "", m.playable ? name : `${name} · ${t("home.comingSoon")}`), {
            permanent: selected,
            direction: "right",
            offset: [16, 0],
            className: `site-label${m.playable ? "" : " is-soon"}`,
          })
          .on("click", () => m.playable && latest.current.onSelectSite(m.pilot_key))
          .addTo(layers.sites);
        spreadRef.current.push({ marker, at: L.latLng(m.map.center), size: 36, fixed: false });
        if (m.playable) label(marker, `${name}, ${place}`);
      }
      requestAnimationFrame(() => declutterRef.current());
      return;
    }
    if (!playable) return;

    if (mode === "report") {
      drawPlaces(playable, layers.places);
      if (reportPin) drawReportPin(reportPin, layers.player);
      return;
    }
    if (mode === "story" || mode === "history" || mode === "mission") drawPlaces(playable, layers.places);
    // The alarm comes before the reveal: only the ARGUS sensor that raised it is shown, and your
    // sensors that would have caught it stand out from the rest.
    const alarmShown = (mode === "event" || mode === "replay") && alarm ? alarm : null;
    const rule = alarmShown ? ruleFor(data, playable, alarmShown) : null;
    const detection = rule ? detects(rule, countPicks(placements)) : null;
    const points = clusterPoints(playable.installed.points);
    if (alarmShown) {
      const alarmIds = new Set(alarmShown.instruments.map((i) => i.instrument_id));
      drawArgus(points.filter((point) => point.instruments.some((i) => alarmIds.has(i.instrument_id))), layers.argus);
      drawAlarm(alarmShown, layers.alarm, !detection?.detected);
    } else if (mode === "reveal" || mode === "score") {
      drawArgus(points, layers.argus);
    }
    drawPlayer(layers.player, map, alarmShown ? new Set(detection?.matched ?? []) : null);
    // Spread these pins now: the camera may have finished moving before they were drawn.
    requestAnimationFrame(() => declutterRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pilot, placements, alarm, lang, data, reportPin, reportEditable]);

  /** Site guide: dashed outlines and numbered markers for the main parts of the site. */
  function drawPlaces(monument: Monument, group: L.LayerGroup) {
    for (const place of monument.places ?? []) {
      if (place.outline) {
        L.polygon(place.outline, { className: "place-outline", interactive: false }).addTo(group);
      }
      L.marker([place.lat, place.lon], {
        pane: "places",
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "", html: `<span class="place-pin">${place.n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      })
        .bindTooltip(el("span", "", pick(place.name)), {
          pane: "places",
          permanent: true,
          direction: "auto", // the side with room, so labels are not cut at the map edge
          offset: [12, 0],
          className: "place-label",
        })
        .addTo(group);
    }
    requestAnimationFrame(() => declutterRef.current());
  }

  /** Hide a place label that would overlap a lower-numbered one or the map's own furniture (the
   * scale, the coordinates, the legend, the buttons); the numbers stay, and the mission panel
   * lists every name. Runs again after each zoom or move. */
  declutterRef.current = () => {
    const node = containerRef.current;
    if (!node) return;
    if (mapRef.current) spreadPins(mapRef.current);
    const furniture = node.parentElement?.querySelectorAll<HTMLElement>(
      ".leaflet-control-scale, .map-coords, .map-legend, .map-switch, .leaflet-control-zoom, .places-toggle, .crosshair-label",
    );
    // (an element that is not shown has an empty box, which nothing overlaps)
    const kept: DOMRect[] = [...(furniture ?? [])].map((f) => f.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    for (const label of node.querySelectorAll<HTMLElement>(".place-label")) {
      label.classList.remove("is-hidden");
      const r = label.getBoundingClientRect();
      const clash = kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2);
      if (clash) label.classList.add("is-hidden");
      else kept.push(r);
    }
  };

  function spreadPins(map: L.Map) {
    const pins = spreadRef.current;
    if (!pins.length) return;
    const at = pins.map((p) => map.latLngToLayerPoint(p.at));
    // A pin with its popup open stays where it is drawn: moving it would move the popup, which pans
    // the map, which would move the pin again.
    const held = pins.map((p) => p.fixed || p.marker.isPopupOpen());
    pins.forEach((p, k) => {
      if (p.marker.isPopupOpen()) at[k] = map.latLngToLayerPoint(p.marker.getLatLng());
    });
    // The map's own controls (zoom, legend, scale, credits, the map picker, "Places") never cover a
    // pin either: a pin under one is moved out from under it.
    const box = map.getContainer().getBoundingClientRect();
    const blocks = [...(map.getContainer().parentElement?.querySelectorAll<HTMLElement>(
      ".leaflet-control-zoom, .leaflet-control-attribution, .leaflet-control-scale, .map-coords, .map-legend, .map-switch, .places-toggle",
    ) ?? [])]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      // (12 px clear: a small target, such as the credits' link, needs no other target within 12 px)
      .map((r) => ({
        min: map.containerPointToLayerPoint([r.left - box.left - 12, r.top - box.top - 12]),
        max: map.containerPointToLayerPoint([r.right - box.left + 12, r.bottom - box.top + 12]),
      }));
    const intoBlock = (c: L.Point, size: number) =>
      blocks.some((b) => c.x + size / 2 > b.min.x && c.x - size / 2 < b.max.x && c.y + size / 2 > b.min.y && c.y - size / 2 < b.max.y);
    for (let round = 0; round < 200; round++) { // (a crowded map near its controls needs many small steps)
      let moved = false;
      for (let i = 0; i < pins.length; i++) {
        for (let j = i + 1; j < pins.length; j++) {
          if (held[i] && held[j]) continue;
          // A pin is a square target: two overlap unless they are apart along one of the axes, so
          // they are pushed apart along the axis that needs the smaller move.
          const room = (pins[i].size + pins[j].size) / 2 + 2;
          const dx = at[j].x - at[i].x;
          const dy = at[j].y - at[i].y;
          const ox = room - Math.abs(dx);
          const oy = room - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          // (two pins on the same spot: the later one goes right, or down, the same at every zoom)
          const [mi, mj] = held[i] ? [0, 1] : held[j] ? [1, 0] : [0.5, 0.5];
          const across: [number, number] = [(dx < 0 ? -1 : 1) * ox, 0];
          const along: [number, number] = [0, (dy < 0 ? -1 : 1) * oy];
          // The shorter way apart, unless it pushes a pin into a control: then the other way.
          const lands = ([qx, qy]: [number, number]) =>
            !intoBlock(at[i].subtract(L.point(qx * mi, qy * mi)), pins[i].size) &&
            !intoBlock(at[j].add(L.point(qx * mj, qy * mj)), pins[j].size);
          const [first, second] = ox <= oy ? [across, along] : [along, across];
          const [px, py] = lands(first) || !lands(second) ? first : second;
          at[i] = at[i].subtract(L.point(px * mi, py * mi));
          at[j] = at[j].add(L.point(px * mj, py * mj));
          moved = true;
        }
      }
      for (let i = 0; i < pins.length; i++) {
        if (held[i]) continue;
        const half = pins[i].size / 2;
        for (const b of blocks) {
          const left = at[i].x + half - b.min.x; // how far to move left to clear it
          const right = b.max.x - (at[i].x - half);
          const up = at[i].y + half - b.min.y;
          const down = b.max.y - (at[i].y - half);
          if (left <= 0 || right <= 0 || up <= 0 || down <= 0) continue;
          const least = Math.min(left, right, up, down);
          at[i] = at[i].add(
            least === right ? L.point(right, 0) : least === left ? L.point(-left, 0) : least === down ? L.point(0, down) : L.point(0, -up),
          );
          moved = true;
        }
      }
      if (!moved) break;
    }
    // Only pins that really move: moving a pin moves its open popup, which pans the map, which
    // spreads the pins again; an unchanged pin left alone ends that loop.
    pins.forEach((p, k) => {
      if (map.latLngToLayerPoint(p.marker.getLatLng()).distanceTo(at[k]) > 0.5) p.marker.setLatLng(map.layerPointToLatLng(at[k]));
    });
  }

  /** A pin's popup opens clear of the phone's floating bars while placing sensors (their heights
      are measured by Mission.tsx); elsewhere there are none and nothing changes. */
  function keepClearOfBars(marker: L.Marker) {
    marker.on("popupopen", (e) => {
      const host = containerRef.current?.parentElement;
      if (!host) return;
      const css = getComputedStyle(host);
      const top = parseFloat(css.getPropertyValue("--top-bar-h")) || 0;
      const bottom = parseFloat(css.getPropertyValue("--strip-h")) || 0;
      if (!top && !bottom) return;
      const popup = (e as L.PopupEvent).popup;
      popup.options.autoPanPaddingTopLeft = L.point(12, top + 12);
      popup.options.autoPanPaddingBottomRight = L.point(12, bottom + 12);
      popup.update(); // pans again, with the bars in mind
    });
  }

  function pointNames(point: MapPoint): string {
    const counts = new Map<string, number>();
    for (const i of point.instruments) {
      const name = cardName(i.card, i.instrument_type);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
  }

  function drawArgus(points: MapPoint[], group: L.LayerGroup) {
    const alarmIds = new Set(alarm?.instruments.map((i) => i.instrument_id) ?? []);
    for (const point of points) {
      const n = point.instruments.length;
      const isAlarm = (mode === "event" || mode === "replay") && point.instruments.some((i) => alarmIds.has(i.instrument_id));
      const inner = n > 1 ? `<span class="pin-num">${n}</span>` : iconSvg(point.instruments[0].card ?? "other", 16);
      const names = pointNames(point);
      const temporary = point.flags.includes("temporary_position");
      const popup = el("div", "map-popup");
      popup.append(el("p", "map-popup-title", "ARGUS"), el("p", "", names));
      if (point.label) popup.append(el("p", "map-popup-meta", point.label));
      if (temporary) popup.append(el("p", "map-popup-meta", t("map.tempPosition")));
      const marker = L.marker([point.lat, point.lon], {
        keyboard: true,
        zIndexOffset: isAlarm ? 500 : 0,
        icon: L.divIcon({
          className: "",
          html: `<span class="pin pin-argus${isAlarm ? " is-alarm" : ""}${mode === "event" && !isAlarm ? " is-dim" : ""}${temporary ? " is-temporary" : ""}">${inner}</span>`,
          iconSize: [PIN, PIN],
          iconAnchor: [PIN / 2, PIN / 2],
        }),
      })
        .bindPopup(popup)
        .addTo(group);
      label(marker, `${t("map.argus", { names })}${temporary ? `. ${t("map.tempPosition")}` : ""}`);
      spreadRef.current.push({ marker, at: L.latLng(point.lat, point.lon), size: PIN, fixed: isAlarm });
    }
  }

  function drawAlarm(a: Alarm, group: L.LayerGroup, missed: boolean) {
    const at = a.instruments.find((i) => i.lat !== null && i.lon !== null);
    if (!at) return;
    L.marker([at.lat!, at.lon!], {
      interactive: false,
      keyboard: false,
      zIndexOffset: -500,
      icon: L.divIcon({
        className: "",
        // Three waves spread from the spot while the alarm plays (replay mode only, styles.css).
        html: `<span class="alarm-ring"><i></i><i></i><i></i></span>${missed ? `<span class="alarm-missed">${iconSvg("cross", 14)}</span>` : ""}`,
        iconSize: [72, 72],
        iconAnchor: [36, 36],
        tooltipAnchor: [30, 0], // Leaflet applies this on whichever side the label goes
      }),
    })
      .bindTooltip(el("span", "", t("map.alarmHere", { name: cardName(at.card, at.instrument_type) })), {
        permanent: true,
        direction: "auto", // right of the ring in the left half of the map, left of it in the right half
        offset: [0, 0],
        className: "alarm-label",
      })
      .addTo(group);
  }

  /** The one pin of an observation report: where the visitor saw it. */
  function drawReportPin(at: LatLng, group: L.LayerGroup) {
    const marker = L.marker(at, {
      draggable: reportEditable,
      keyboard: true,
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: "",
        html: `<span class="pin pin-you pin-report">${iconSvg("observer", 20)}</span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
    })
      .on("dragend", (e) => {
        const to = (e.target as L.Marker).getLatLng();
        latest.current.onReportPin?.([to.lat, to.lng]);
      })
      .addTo(group);
    label(marker, t("report.pin"));
  }

  /** Your sensors; with an alarm shown, `caught` holds the cards that would have caught it. */
  function drawPlayer(group: L.LayerGroup, map: L.Map, caught: Set<string> | null) {
    const editable = mode === "mission";
    for (const p of placements) {
      if (p.lat === null || p.lng === null) continue;
      const name = cardName(p.card);
      const popup = el("div", "map-popup");
      popup.append(el("p", "map-popup-title", t("map.you", { name })));
      if (editable) {
        // Moving a pin without dragging it (WCAG 2.5.7): to the cross, which a tap on the map moves.
        const move = el("button", "btn btn-quiet map-popup-btn", t("map.moveHere")) as HTMLButtonElement;
        move.type = "button";
        move.addEventListener("click", () => {
          map.closePopup();
          const centre = map.getCenter();
          latest.current.onMovePlacement(p.id, [centre.lat, centre.lng]);
        });
        popup.append(move);
        const remove = el("button", "btn btn-quiet map-popup-btn", t("map.remove")) as HTMLButtonElement;
        remove.type = "button";
        remove.addEventListener("click", () => {
          map.closePopup();
          latest.current.onRemovePlacement(p.id);
        });
        popup.append(remove);
      }
      const marker = L.marker([p.lat, p.lng], {
        draggable: editable,
        keyboard: true,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: "",
          html: `<span class="pin pin-you${caught ? (caught.has(p.card) ? " is-catch" : " is-dim") : ""}">${iconSvg(p.card, 16)}</span>`,
          iconSize: [PIN, PIN],
          iconAnchor: [PIN / 2, PIN / 2],
        }),
      })
        .bindPopup(popup)
        .on("popupopen", () => popup.querySelector("button")?.focus())
        .on("dragend", (e) => {
          const at = (e.target as L.Marker).getLatLng();
          latest.current.onMovePlacement(p.id, [at.lat, at.lng]);
        })
        .addTo(group);
      label(marker, t("map.you", { name }));
      if (editable) keepClearOfBars(marker);
      spreadRef.current.push({ marker, at: L.latLng(p.lat, p.lng), size: PIN, fixed: false });
    }
  }

  // Under the 3D view nothing of the map can be reached: not the map, its pins nor its controls.
  const sectionRef = useRef<HTMLElement>(null);
  const covered = !!props.overlay;
  useLayoutEffect(() => {
    for (const child of Array.from(sectionRef.current?.children ?? []) as HTMLElement[]) {
      if (!child.classList.contains("view3d")) child.inert = covered;
    }
  }, [covered]);

  return (
    <section ref={sectionRef} className={`board-map mode-${mode}${isPlan ? " is-plan" : ""}`} aria-label={t("map.region")}>
      <div ref={containerRef} className="map" />
      <p id="map-help" className="sr-only">
        {t("map.instructions")}
      </p>
      {mode === "mission" && (
        <>
          {pinned === 0 && (
            <span className="crosshair-label" aria-hidden="true">
              {t("map.crosshairHint")}
            </span>
          )}
        </>
      )}
      {mode === "replay" && alarm && (
        <div className="replay-banner" aria-hidden="true">
          <p className="replay-kicker">{t("event.heading")}</p>
          <p>{replayLine}</p>
        </div>
      )}
      {mode === "replay" && props.onReplaySkip && (
        <button
          type="button"
          className={`btn replay-skip${props.replayOver ? " btn-primary is-over" : ""}`}
          ref={skipRef}
          onClick={props.onReplaySkip}
        >
          {t(props.replayOver ? "replay.continue" : "replay.skip")}
          {props.replayOver && <Icon name="arrow" size={18} />}
        </button>
      )}
      {mode === "report" && reportEditable && !reportPin && (
        <span className="crosshair-label report-hint" aria-hidden="true">
          {t("report.mapHint")}
        </span>
      )}
      {/* Nothing to switch between when only the drawn plan is offered (local-only mode). */}
      {data.basemaps.layers.length > 1 && (
        <div className="map-switch" role="group" aria-label={t("map.basemap")}>
          {data.basemaps.layers.map((layer) => (
            <button
              key={layer.id}
              type="button"
              aria-pressed={basemap === layer.id}
              onClick={() => {
                setFellBack(false);
                setBasemap(layer.id);
              }}
            >
              {pick(layer.name)}
            </button>
          ))}
        </div>
      )}
      {(mode === "reveal" || mode === "score" || mode === "event") && (
        <div className="map-legend">
          <span>
            <span className="legend-you" aria-hidden="true" /> {t("map.legendYou")}
          </span>
          <span>
            <span className="legend-argus" aria-hidden="true" /> {t("map.legendArgus")}
          </span>
        </div>
      )}
      {(tilesFailed || (fellBack && isPlan)) && !noticeClosed && (
        <div className="map-notice" role="status">
          <p>{tilesFailed ? t("map.tilesFailed") : t("map.planFallback")}</p>
          <button type="button" className="map-notice-close" aria-label={t("map.closeNotice")} onClick={() => setNoticeClosed(true)}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
      {props.overlay}
    </section>
  );
}
