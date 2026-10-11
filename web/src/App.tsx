import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalCommunityStore } from "./community/store";
import { Icon } from "./components/Icon";
import { Progress, STEPS, type Step } from "./components/Progress";
import { loadGameData } from "./game/data";
import { isPlayable } from "./game/logic";
import type { GameData, LevelId, Monument, Picks } from "./game/types";
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
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");
  const community = useMemo(() => new LocalCommunityStore(), []);
  const mainRef = useRef<HTMLElement>(null);
  const firstScreen = useRef(true);

  const fetchData = useCallback(() => {
    setLoad({ state: "loading" });
    loadGameData()
      .then((data) => setLoad({ state: "ready", data }))
      .catch(() => setLoad({ state: "error" }));
  }, []);
  useEffect(fetchData, [fetchData]);

  // Polite announcements; a trailing no-break space toggles so repeats are read again.
  const announce = useCallback((text: string) => {
    setMessage((prev) => (prev === text ? `${text} ` : text));
  }, []);

  // Move focus to the new screen's heading so keyboard and screen-reader users start there.
  useEffect(() => {
    document.title = screen === "home" ? t("app.title") : `${t(`steps.${screen}`)} · ${t("app.title")}`;
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [screen, load.state, t]);

  const go = useCallback((next: Screen) => setScreen(next), []);

  const data = load.state === "ready" ? load.data : null;
  const mon = data && session ? data.monuments.find((m) => m.pilot_key === session.pilot) : undefined;
  const playable = mon && isPlayable(mon) ? mon : null;

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
  } else if (screen === "home" || !session || !playable) {
    body = (
      <Home
        data={data}
        initial={session}
        onStart={(pilot, level) => {
          setSession({ pilot, level, picks: {} });
          setScreen("story");
        }}
      />
    );
  } else {
    const props: ScreenProps = { data, mon: playable, session, go, announce };
    const setPicks = (picks: Picks) => setSession({ ...session, picks });
    body = (
      <>
        <Progress current={screen} />
        {screen === "story" && <Story {...props} />}
        {screen === "mission" && <Mission {...props} setPicks={setPicks} />}
        {screen === "reveal" && <Reveal {...props} />}
        {screen === "event" && <HistoricalEvent {...props} />}
        {screen === "score" && (
          <Score
            {...props}
            community={community}
            onReplay={() => {
              setSession({ ...session, picks: {} });
              setScreen(STEPS[0]);
            }}
          />
        )}
      </>
    );
  }

  const otherLang = t("lang.other");
  return (
    <div className={REVIEW_MODE ? "app review" : "app"}>
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <header className="topbar">
        <div className="topbar-inner">
        <button
          type="button"
          className="brand"
          onClick={() => setScreen("home")}
          disabled={screen === "home"}
        >
          <Icon name="shield" />
          <span>{t("app.title")}</span>
        </button>
        <button
          type="button"
          className="btn btn-quiet lang-switch"
          onClick={() => setLang(lang === "el" ? "en" : "el")}
        >
          <Icon name="globe" size={20} />
          <span lang={t("lang.otherCode")}>{otherLang}</span>
        </button>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        {body}
      </main>
      {data && (
        <footer className="footer">
          <p>{t("app.footer", { date: i18n.date(data.snapshot.fetched_at[0]) })}</p>
        </footer>
      )}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </div>
  );
}
