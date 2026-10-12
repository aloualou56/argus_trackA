import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCommunityStore } from "./community";
import { classCodeFromUrl, loadClassCode, saveClassCode } from "./community/classCode";
import { quizSummaryOf } from "./community/store";
import { GameMap, type MapApi } from "./components/GameMap";
import { BrandMark } from "./components/BrandMark";
import { LangMenu } from "./components/LangMenu";
import { PhotoCredit } from "./components/PhotoCredit";
import { Progress, STEPS, stepKey, type Step } from "./components/Progress";
import { loadGameData } from "./game/data";
import { challengeFromUrl } from "./game/challenge";
import { canDrawMission, countPicks, drawMission, isPlayable, weekAlarms, type DayResult } from "./game/logic";
import type { GameData, LatLng, LevelId, Monument, Picks, Placement } from "./game/types";
import { isBaseLang, useI18n } from "./i18n";
import { HistoricalEvent } from "./screens/HistoricalEvent";
import { Home } from "./screens/Home";
import { Mission } from "./screens/Mission";
import { Observe, type ReportOnMap } from "./screens/Observe";
import { Quiz } from "./screens/Quiz";
import { Reveal } from "./screens/Reveal";
import { Score } from "./screens/Score";
import { Story } from "./screens/Story";
import { Teacher } from "./screens/Teacher";

type Screen = "home" | "teacher" | "observe" | Step | "quizPre" | "quizPost";

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
  /** This game is already in the community store (the score screen can be left and come back to). */
  recorded: boolean;
  /** A week on duty: the day being played (0 = the first) and how the days before it went. */
  day: number;
  past: DayResult[];
  /** Today's score before the player went back to improve the network, if they did. */
  scoreBefore: number | null;
  /** The mission screen is open to improve the network: "Done" goes back to the score. */
  improving: boolean;
  /** The score to beat, when the game was started from a challenge link. */
  beat: number | null;
}

/** A game at its very start: nothing placed, day 1, nothing decided or stored yet. */
const fresh = (): Pick<Session, "placements" | "decision" | "recorded" | "day" | "past" | "scoreBefore" | "improving"> => ({
  placements: [],
  decision: null,
  recorded: false,
  day: 0,
  past: [],
  scoreBefore: null,
  improving: false,
});

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
  const { t, lang } = i18n;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [screen, setScreen] = useState<Screen>("home");
  const [game, setGame] = useState<Omit<Session, "picks"> | null>(null);
  const [homePilot, setHomePilot] = useState<string | null>(null);
  // The observation report in hand, and the screen to go back to. The map shows its pin.
  const [report, setReport] = useState<(ReportOnMap & { from: Screen }) | null>(null);
  const openReport = useCallback((pilot: string, from: Screen) => {
    setReport({ pilot, at: null, editable: true, from });
    setScreen("observe");
  }, []);
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
        // A challenge link opens on its own monument.
        const challenged = challengeFromUrl(window.location.search, data)?.pilot;
        setHomePilot((p) => p ?? challenged ?? data.monuments.find((m) => m.playable)?.pilot_key ?? null);
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
            : screen === "observe"
              ? t("report.title")
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
  const inGame = screen !== "home" && screen !== "teacher" && screen !== "observe" && session && playable;
  const observing = screen === "observe" && report && data ? report : null;
  // "Beat my score on the same dangers": ?m=delos&l=high&d=65.69.82&s=68 (see game/challenge.ts).
  const challenge = useMemo(() => (data ? challengeFromUrl(window.location.search, data) : null), [data]);
  // The real alarms of this game's week on duty, one per day; today's is week[day].
  const week = playable && game ? weekAlarms(playable, game.level) : [];
  const today = game ? (week[game.day] ?? null) : null;

  const start = (pilot: string, level: LevelId, mission?: string[], beat: number | null = null) => {
    const started = data?.monuments.find((m) => m.pilot_key === pilot);
    const own = started && isPlayable(started) ? (started.levels.find((l) => l.id === level)?.mission ?? []) : [];
    setGame({ ...fresh(), pilot, level, mission: mission ?? own, beat });
    setScreen(preQuiz.asked ? "story" : "quizPre");
  };

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
  } else if (observing) {
    body = (
      <Observe
        data={data}
        report={observing}
        setReport={(change) => setReport((r) => (r ? { ...r, ...change } : r))}
        mapApi={mapApi}
        announce={announce}
        onBack={() => setScreen(observing.from)}
      />
    );
  } else if (!inGame) {
    body = (
      <Home
        onReport={() => homePilot && openReport(homePilot, "home")}
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
        onStart={(pilot, level) => start(pilot, level)}
        challenge={challenge}
        onChallenge={() => challenge && start(challenge.pilot, challenge.level, challenge.mission, challenge.score)}
      />
    );
  } else {
    const props: ScreenProps = { data, mon: playable, session, classCode, go, announce };
    // "Play again" draws new dangers from the level's pool; a class keeps the level's own mission
    // so classmates compare the same mission.
    const replay = () => {
      const drawn = classCode ? null : drawMission(data, playable, session.level, session.mission);
      // New dangers are a new game: the challenge was about the old ones.
      setGame((g) => (g ? { ...g, ...fresh(), mission: drawn ?? g.mission, beat: drawn ? null : g.beat } : g));
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
        {screen === "mission" && (
          <Mission
            {...props}
            setPlacements={setPlacements}
            mapApi={mapApi}
            improving={session.improving}
            onImproved={() => {
              setGame((g) => (g ? { ...g, improving: false } : g));
              setScreen("score");
            }}
          />
        )}
        {screen === "reveal" && <Reveal {...props} />}
        {screen === "event" && (
          <HistoricalEvent
            {...props}
            today={today}
            days={week.length}
            onDecide={(decision) => setGame((g) => (g ? { ...g, decision } : g))}
          />
        )}
        {screen === "score" && (
          <Score
            {...props}
            community={community}
            onReplay={replay}
            replayLabel={replayLabel}
            onQuiz={() => setScreen("quizPost")}
            onRecorded={() => setGame((g) => (g ? { ...g, recorded: true } : g))}
            onReport={() => openReport(playable.pilot_key, "score")}
            week={week}
            onImprove={(total) => {
              // The first score of the day is the "before", however often the network is changed.
              setGame((g) => (g ? { ...g, improving: true, scoreBefore: g.scoreBefore ?? total } : g));
              setScreen("mission");
            }}
            onNextDay={(result) => {
              // Today is settled as it stands; tomorrow starts with the same network and a fresh question.
              setGame((g) => (g ? { ...g, past: [...g.past, result], day: g.day + 1, scoreBefore: null, decision: null } : g));
              setScreen("event");
            }}
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
            <BrandMark />
            <span>{t("app.title")}</span>
          </button>
          <LangMenu />
        </div>
      </header>
      <div className={data ? "board" : "board no-map"}>
        {data && (
          <GameMap
            data={data}
            mode={observing ? "report" : inGame ? mapMode(screen) : "overview"}
            pilot={observing ? observing.pilot : inGame ? game!.pilot : homePilot}
            reportPin={observing?.at}
            onReportPin={observing?.editable ? (at) => setReport((r) => (r ? { ...r, at } : r)) : undefined}
            placements={inGame ? game!.placements : []}
            alarm={inGame && screen === "event" ? today : null}
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
              {data.monuments.some((m) => m.photo) && (
                <details className="photo-credits">
                  <summary>{t("photo.credits")}</summary>
                  <ul>
                    {data.monuments.map(
                      (m) =>
                        m.photo && (
                          <li key={m.pilot_key}>
                            {m.display_name ? i18n.pick(m.display_name) : m.name}: <PhotoCredit photo={m.photo} />
                          </li>
                        ),
                    )}
                  </ul>
                  <p>{t("photo.changes")}</p>
                </details>
              )}
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
