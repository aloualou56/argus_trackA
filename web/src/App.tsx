import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalCommunityStore } from "./community/store";
import { GameMap, type MapApi } from "./components/GameMap";
import { Icon } from "./components/Icon";
import { Progress, STEPS, stepKey, type Step } from "./components/Progress";
import { loadGameData } from "./game/data";
import { countPicks, featuredAlarm, isPlayable } from "./game/logic";
import type { GameData, LatLng, LevelId, Monument, Picks, Placement } from "./game/types";
import { useI18n } from "./i18n";
import { HistoricalEvent } from "./screens/HistoricalEvent";
import { Home } from "./screens/Home";
import { Mission } from "./screens/Mission";
import { Reveal } from "./screens/Reveal";
import { Score } from "./screens/Score";
import { Story } from "./screens/Story";

type Screen = "home" | Step;

export interface Session {
  pilot: string;
  level: LevelId;
  placements: Placement[];
  /** Derived from placements: how many of each card. */
  picks: Picks;
}

export interface ScreenProps {
  data: GameData;
  mon: Monument;
  session: Session;
  go: (screen: Screen) => void;
  announce: (message: string) => void;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; data: GameData };

const REVIEW_MODE = new URLSearchParams(window.location.search).has("review");

export default function App() {
  const i18n = useI18n();
  const { t, lang, setLang } = i18n;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [screen, setScreen] = useState<Screen>("home");
  const [game, setGame] = useState<{ pilot: string; level: LevelId; placements: Placement[] } | null>(null);
  const [homePilot, setHomePilot] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const community = useMemo(() => new LocalCommunityStore(), []);
  const mapApi = useRef<MapApi | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const firstScreen = useRef(true);

  const fetchData = useCallback(() => {
    setLoad({ state: "loading" });
    loadGameData()
      .then((data) => {
        setHomePilot((p) => p ?? data.monuments.find((m) => m.playable)?.pilot_key ?? null);
        setLoad({ state: "ready", data });
      })
      .catch(() => setLoad({ state: "error" }));
  }, []);
  useEffect(fetchData, [fetchData]);

  // Polite announcements; a trailing no-break space toggles so repeats are read again.
  const announce = useCallback((text: string) => {
    setMessage((prev) => (prev === text ? `${text} ` : text));
  }, []);

  // Move focus to the new screen's heading so keyboard and screen-reader users start there.
  useEffect(() => {
    document.title = screen === "home" ? t("app.title") : `${t(stepKey(screen))} · ${t("app.title")}`;
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [screen, load.state, t]);

  const go = useCallback((next: Screen) => setScreen(next), []);

  const data = load.state === "ready" ? load.data : null;
  const mon = data && game ? data.monuments.find((m) => m.pilot_key === game.pilot) : undefined;
  const playable = mon && isPlayable(mon) ? mon : null;
  const session: Session | null = game && { ...game, picks: countPicks(game.placements) };
  const inGame = screen !== "home" && session && playable;

  const setPlacements = useCallback((update: (prev: Placement[]) => Placement[]) => {
    setGame((g) => (g ? { ...g, placements: update(g.placements) } : g));
  }, []);
  const movePlacement = useCallback(
    (id: string, at: LatLng) => setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, lat: at[0], lng: at[1] } : p))),
    [setPlacements],
  );
  const removePlacement = useCallback(
    (id: string) => setPlacements((ps) => ps.filter((p) => p.id !== id)),
    [setPlacements],
  );

  let body;
  if (load.state === "loading") {
    body = <p className="status">{t("app.loading")}</p>;
  } else if (load.state === "error" || !data) {
    body = (
      <div className="status" role="alert">
        <p>{t("app.loadError")}</p>
        <button type="button" className="btn btn-primary" onClick={fetchData}>
          {t("app.retry")}
        </button>
      </div>
    );
  } else if (!inGame) {
    body = (
      <Home
        data={data}
        pilot={homePilot}
        setPilot={setHomePilot}
        initialLevel={game?.pilot === homePilot ? game.level : undefined}
        onStart={(pilot, level) => {
          setGame({ pilot, level, placements: [] });
          setScreen("story");
        }}
      />
    );
  } else {
    const props: ScreenProps = { data, mon: playable, session, go, announce };
    body = (
      <>
        <Progress current={screen} />
        {screen === "story" && <Story {...props} />}
        {screen === "mission" && <Mission {...props} setPlacements={setPlacements} mapApi={mapApi} />}
        {screen === "reveal" && <Reveal {...props} />}
        {screen === "event" && <HistoricalEvent {...props} />}
        {screen === "score" && (
          <Score
            {...props}
            community={community}
            onReplay={() => {
              setPlacements(() => []);
              setScreen(STEPS[0]);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className={REVIEW_MODE ? "app review" : "app"}>
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={() => setScreen("home")} disabled={screen === "home"}>
            <Icon name="shield" />
            <span>{t("app.title")}</span>
          </button>
          <button type="button" className="btn btn-quiet lang-switch" onClick={() => setLang(lang === "el" ? "en" : "el")}>
            <Icon name="globe" size={20} />
            <span lang={t("lang.otherCode")}>{t("lang.other")}</span>
          </button>
        </div>
      </header>
      <div className={data ? "board" : "board no-map"}>
        {data && (
          <GameMap
            data={data}
            mode={inGame ? screen : "overview"}
            pilot={inGame ? game!.pilot : homePilot}
            placements={inGame ? game!.placements : []}
            alarm={inGame && screen === "event" ? featuredAlarm(playable!, game!.level) : null}
            apiRef={mapApi}
            onSelectSite={(pilot) => {
              setHomePilot(pilot);
              announce(t("map.selected", { name: siteName(data, pilot, i18n.pick) }));
            }}
            onMovePlacement={movePlacement}
            onRemovePlacement={(id) => {
              removePlacement(id);
              announce(t("map.removed"));
            }}
          />
        )}
        <div className="board-panel">
          <main id="main" ref={mainRef} tabIndex={-1}>
            {body}
          </main>
          {data && (
            <footer className="footer">
              <p>{t("app.footer", { date: i18n.date(data.snapshot.fetched_at[0]) })}</p>
            </footer>
          )}
        </div>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </div>
  );
}

function siteName(data: GameData, pilot: string, pick: ReturnType<typeof useI18n>["pick"]): string {
  const m = data.monuments.find((x) => x.pilot_key === pilot);
  return m ? (m.display_name ? pick(m.display_name) : m.name) : pilot;
}
