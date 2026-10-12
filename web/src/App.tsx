import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCommunityStore } from "./community";
import { classCodeFromUrl, loadClassCode, saveClassCode } from "./community/classCode";
import { quizSummaryOf } from "./community/store";
import { GameMap, type MapApi } from "./components/GameMap";
import { Icon } from "./components/Icon";
import { Progress, STEPS, stepKey, type Step } from "./components/Progress";
import { loadGameData } from "./game/data";
import { canDrawMission, countPicks, drawMission, featuredAlarm, isPlayable } from "./game/logic";
import type { GameData, LatLng, LevelId, Monument, Picks, Placement } from "./game/types";
import { isBaseLang, isLang, LANGS, useI18n } from "./i18n";
import { HistoricalEvent } from "./screens/HistoricalEvent";
import { Home } from "./screens/Home";
import { Mission } from "./screens/Mission";
import { Quiz } from "./screens/Quiz";
import { Reveal } from "./screens/Reveal";
import { Score } from "./screens/Score";
import { Story } from "./screens/Story";
import { Teacher } from "./screens/Teacher";

type Screen = "home" | "teacher" | Step | "quizPre" | "quizPost";

const isStep = (screen: Screen): screen is Step => (STEPS as readonly string[]).includes(screen);
/** What the map shows behind the quiz screens. */
const mapMode = (screen: Screen): Step => (screen === "quizPre" ? "story" : screen === "quizPost" ? "score" : (screen as Step));

export interface Session {
  pilot: string;
  level: LevelId;
  placements: Placement[];
  /** The three dangers: the level's own mission, or a drawn one after "play again". */
  mission: string[];
  /** Derived from placements: how many of each card. */
  picks: Picks;
  /** The player's answer to "what would you do next?" after the alarm, if they gave one. */
  decision: string | null;
}

export interface ScreenProps {
  data: GameData;
  mon: Monument;
  session: Session;
  /** Class the player joined, if any: stored with every record so a teacher can see the group. */
  classCode: string | null;
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
  const [game, setGame] = useState<Omit<Session, "picks"> | null>(null);
  const [homePilot, setHomePilot] = useState<string | null>(null);
  // The quiz before a game is asked once per visit; its marks are compared with the quiz after each game.
  const [preQuiz, setPreQuiz] = useState<{ asked: boolean; marks: boolean[] | null }>({ asked: false, marks: null });
  const [message, setMessage] = useState("");
  const community = useMemo(() => createCommunityStore(), []);
  // A class link (?class=ABC234) wins over the code remembered on this device.
  const [classCode, setClassCodeState] = useState<string | null>(() => {
    const fromLink = classCodeFromUrl(window.location.search);
    if (fromLink) saveClassCode(fromLink);
    return fromLink ?? loadClassCode();
  });
  const setClassCode = useCallback((code: string | null) => {
    saveClassCode(code);
    setClassCodeState(code);
  }, []);
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
    const heading =
      screen === "quizPre"
        ? t("quiz.preTitle")
        : screen === "quizPost"
          ? t("quiz.postTitle")
          : screen === "teacher"
            ? t("teacher.title")
            : null;
    document.title =
      screen === "home" ? t("app.title") : `${heading ?? t(stepKey(screen as Step))} · ${t("app.title")}`;
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    // The page is a fixed frame; the panel is what scrolls, so a new screen starts at its top.
    mainRef.current?.closest(".board-panel")?.scrollTo({ top: 0 });
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [screen, load.state, t]);

  const go = useCallback((next: Screen) => setScreen(next), []);

  const data = load.state === "ready" ? load.data : null;
  const mon = data && game ? data.monuments.find((m) => m.pilot_key === game.pilot) : undefined;
  const playable = mon && isPlayable(mon) ? mon : null;
  const session: Session | null = game && { ...game, picks: countPicks(game.placements) };
  const inGame = screen !== "home" && screen !== "teacher" && session && playable;

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
  } else if (screen === "teacher") {
    body = (
      <Teacher
        data={data}
        community={community}
        classCode={classCode}
        setClassCode={setClassCode}
        onBack={() => setScreen("home")}
      />
    );
  } else if (!inGame) {
    body = (
      <Home
        classCode={classCode}
        setClassCode={(code) => {
          setClassCode(code);
          announce(code ? t("class.joined", { code }) : t("class.left"));
        }}
        onTeacher={() => setScreen("teacher")}
        data={data}
        pilot={homePilot}
        setPilot={setHomePilot}
        initialLevel={game?.pilot === homePilot ? game.level : undefined}
        onStart={(pilot, level) => {
          const started = data.monuments.find((m) => m.pilot_key === pilot);
          const mission = started && isPlayable(started) ? (started.levels.find((l) => l.id === level)?.mission ?? []) : [];
          setGame({ pilot, level, placements: [], mission, decision: null });
          setScreen(preQuiz.asked ? "story" : "quizPre");
        }}
      />
    );
  } else {
    const props: ScreenProps = { data, mon: playable, session, classCode, go, announce };
    // "Play again" draws new dangers from the level's pool; a class keeps the level's own mission
    // so classmates compare the same mission.
    const replay = () => {
      const drawn = classCode ? null : drawMission(data, playable, session.level, session.mission);
      setGame((g) => (g ? { ...g, placements: [], mission: drawn ?? g.mission, decision: null } : g));
      setScreen(STEPS[0]);
    };
    const replayLabel = t(!classCode && canDrawMission(playable, session.level) ? "score.playNew" : "score.playAgain");
    body = (
      <>
        {isStep(screen) && screen !== "mission" && <Progress current={screen} />}
        {screen === "quizPre" && (
          <Quiz
            questions={data.quiz.questions}
            phase="pre"
            announce={announce}
            onDone={(marks) => {
              setPreQuiz({ asked: true, marks });
              setScreen("story");
            }}
            onSkip={() => {
              setPreQuiz({ asked: true, marks: null });
              setScreen("story");
            }}
          />
        )}
        {screen === "quizPost" && (
          <Quiz
            questions={data.quiz.questions}
            phase="post"
            before={preQuiz.marks}
            savedNote={t(community.kind === "shared" ? "quiz.savedShared" : "quiz.saved")}
            announce={announce}
            onDone={async (marks) => {
              try {
                await community.submitQuiz({
                  v: 1,
                  monument: playable.pilot_key,
                  pre: preQuiz.marks,
                  post: marks,
                  day: new Date().toISOString().slice(0, 10),
                  ...(classCode ? { classCode } : {}),
                });
                const summary = await quizSummaryOf(community, classCode ?? undefined);
                if (summary.withPre < 2) return null;
                const key = classCode ? "quiz.class" : community.kind === "shared" ? "quiz.everyone" : "quiz.device";
                return t(key, {
                  n: summary.withPre,
                  pre: i18n.number(summary.averagePre),
                  post: i18n.number(summary.averagePost),
                  total: data.quiz.questions.length,
                });
              } catch {
                return null;
              }
            }}
            after={
              <div className="actions actions-split">
                <button type="button" className="btn btn-primary btn-big" onClick={replay}>
                  {replayLabel}
                </button>
                <button type="button" className="btn btn-secondary btn-big" onClick={() => go("home")}>
                  {t("score.otherLevel")}
                </button>
              </div>
            }
          />
        )}
        {screen === "story" && <Story {...props} />}
        {screen === "mission" && <Mission {...props} setPlacements={setPlacements} mapApi={mapApi} />}
        {screen === "reveal" && <Reveal {...props} />}
        {screen === "event" && (
          <HistoricalEvent {...props} onDecide={(decision) => setGame((g) => (g ? { ...g, decision } : g))} />
        )}
        {screen === "score" && (
          <Score
            {...props}
            community={community}
            onReplay={replay}
            replayLabel={replayLabel}
            onQuiz={() => setScreen("quizPost")}
          />
        )}
      </>
    );
  }

  return (
    <div className={`app${REVIEW_MODE ? " review" : ""}${inGame && screen === "mission" ? " is-play" : ""}`}>
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={() => setScreen("home")} disabled={screen === "home"}>
            <Icon name="shield" />
            <span>{t("app.title")}</span>
          </button>
          <label className="lang-switch">
            <Icon name="globe" size={20} />
            <span className="sr-only">{t("lang.label")}</span>
            <select value={lang} onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l.id} value={l.id} lang={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <div className={data ? "board" : "board no-map"}>
        {data && (
          <GameMap
            data={data}
            mode={inGame ? mapMode(screen) : "overview"}
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
              {!isBaseLang(lang) && <p>{t("app.translationNote")}</p>}
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
