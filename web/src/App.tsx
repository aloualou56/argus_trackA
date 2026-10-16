import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createCommunityStore } from "./community";
import { classCodeFromUrl, loadClassCode, saveClassCode } from "./community/classCode";
import { quizSummaryOf } from "./community/store";
import { GameMap, type MapApi, type MapMode } from "./components/GameMap";
import { BrandMark } from "./components/BrandMark";
import { LangMenu } from "./components/LangMenu";
import { A11yMenu } from "./components/A11yMenu";
import { enterFullscreen } from "./a11y/fullscreen";
import { getSettings, motionReduced } from "./a11y/settings";
import { play, playReplay } from "./audio/sounds";
import { PhotoCredit } from "./components/PhotoCredit";
import { Progress, STEPS, stepKey, type Step } from "./components/Progress";
import { loadGameData } from "./game/data";
import { challengeFromUrl } from "./game/challenge";
import { canDrawMission, countPicks, detects, drawMission, isPlayable, ruleFor, type DayResult, weekAlarms } from "./game/logic";
import type { Alarm, GameData, LatLng, LevelId, Monument, Picks, Placement } from "./game/types";
import { isBaseLang, useI18n } from "./i18n";
import { HistoricalEvent } from "./screens/HistoricalEvent";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { Mission } from "./screens/Mission";
import { Observe, type ReportOnMap } from "./screens/Observe";
import { Quiz } from "./screens/Quiz";
import { Reveal } from "./screens/Reveal";
import { Score } from "./screens/Score";
import { Story } from "./screens/Story";
import { Teacher } from "./screens/Teacher";
import { View3D } from "./components/View3D";
import { Alarm3D } from "./components/Alarm3D";
import { OWN } from "./game/report";
import { MAP_ZOOM, serialOf } from "./view3d/math";
import { canShow3d, preload3d, type Focus3d, type Loaded } from "./view3d/preload";

type Screen = "home" | "teacher" | "observe" | Step | "quizPre" | "quizPost" | "history";

const isStep = (screen: Screen): screen is Step => (STEPS as readonly string[]).includes(screen);
/** What the map shows behind the quiz screens. */
// The whole story has a map view of its own, so coming back to the story screen frames the site again.
const mapMode = (screen: Screen): MapMode =>
  screen === "quizPre" || screen === "quizPost" ? "story" : screen === "history" ? "history" : (screen as Step);

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

  // Where a screen should open instead of its top (the story's danger, after the whole story).
  const returnTo = useRef<string | null>(null);

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
              : screen === "history"
                ? t("history.heading")
                : null;
    document.title =
      screen === "home" ? t("app.title") : `${heading ?? t(stepKey(screen as Step))} · ${t("app.title")}`;
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    const anchor = returnTo.current ? document.getElementById(returnTo.current) : null;
    returnTo.current = null;
    if (anchor) {
      anchor.scrollIntoView({ block: "start" });
      anchor.focus();
      return;
    }
    // The page is a fixed frame; the panel is what scrolls, so a new screen starts at its top.
    mainRef.current?.closest(".board-panel")?.scrollTo({ top: 0 });
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [screen, load.state, t]);

  const go = useCallback((next: Screen) => setScreen(next), []);

  // Each day's real alarm plays on the map before its screen ("Done" on the mission for the first
  // day, "Next day" on the score for the others). Phones hide everything else meanwhile; wide
  // screens keep the panel. Then the alarm's screen says whether the sensors caught it.
  const [replaying, setReplaying] = useState(false);
  // The replay's picture is complete: its button says "See the answer" instead of "Skip".
  const [replayOver, setReplayOver] = useState(false);
  const replayFrom = useRef<Screen | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stopReplaySound = useRef<() => void>(() => {});
  // The alarm in 3D (Alarm3D.tsx), where ARGUS has a model of the place its sensor stands in: once the
  // map has shown the alarm, it flies down onto the place and the 3D view takes over. building: the
  // scene is made, unseen; waiting: the map still shows the alarm; flying: the map zooms in; arrived:
  // the 3D view takes over. Each replay has its own number, so a model that loads after it is over is
  // never shown.
  const [alarm3d, setAlarm3d] = useState<{
    loaded: Loaded;
    focus: Focus3d;
    stage: "building" | "waiting" | "flying" | "arrived";
  } | null>(null);
  const alarm3dStage = useRef<string | null>(null);
  useEffect(() => {
    alarm3dStage.current = alarm3d?.stage ?? null;
  }, [alarm3d]);
  const replayRun = useRef(0);
  const replayStart = useRef(0);
  // Whether the replay waits for the 3D view before its picture is complete.
  const awaiting3d = useRef(false);
  const replayComplete = useCallback(() => {
    awaiting3d.current = false;
    setReplayOver(true);
    announce(t("replay.over", { button: t("replay.continue") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finishReplay = useCallback(() => {
    stopReplaySound.current();
    stopReplaySound.current = () => {};
    replayRun.current++;
    awaiting3d.current = false;
    setAlarm3d(null);
    setReplaying(false);
    setReplayOver(false);
    setScreen("event");
  }, []);
  useEffect(() => {
    if (!replaying) return;
    const still = motionReduced();
    const run = replayRun.current;
    // No time limit: the replay waits on its final picture until the player goes on (WCAG 2.2.1). With
    // the alarm in 3D the picture is complete once the camera is down at the alarm; a model not loaded
    // within 8 s (a slow network) is not waited for: the alarm stays on the map.
    const timer = window.setTimeout(() => {
      if (!awaiting3d.current) replayComplete();
    }, still ? 600 : 3400);
    const giveUp = window.setTimeout(() => {
      if (replayRun.current !== run || !awaiting3d.current) return;
      if (alarm3dStage.current) return; // loaded: on its way
      replayRun.current++;
      setAlarm3d(null);
      replayComplete();
    }, 8000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(giveUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaying]);
  // Leaving the screen it started from (the home button on a wide screen) ends it, sound and all.
  useEffect(() => {
    if (!replaying || screen === replayFrom.current) return;
    setReplaying(false);
    stopReplaySound.current();
  }, [screen, replaying]);
  useEffect(() => {
    if (replaying) return;
    replayRun.current++;
    awaiting3d.current = false;
    setAlarm3d(null);
  }, [replaying]);
  // "Display in 3D" (Score): the map flies down onto the house and the 3D view takes over
  // (View3D.tsx). building: the scene is made, unseen, before the map moves; flying: the map zooms
  // in; arrived: the 3D view may take over. Phones give it the whole screen; wide screens keep the
  // panel in view, unusable meanwhile, as during the replay.
  const [view3d, setView3d] = useState<{
    scene: string;
    loaded: Loaded;
    focus: Focus3d;
    stage: "building" | "flying" | "arrived";
  } | null>(null);
  const opener = useRef("view3d-open");
  const in3d = view3d !== null;
  const topbarRef = useRef<HTMLElement>(null);
  const was3d = useRef(false);
  useEffect(() => {
    if (screen !== "score") setView3d(null);
  }, [screen]);
  useEffect(() => {
    if (in3d) was3d.current = true;
    else if (was3d.current) {
      // Back where the player was: the button that opened it (the panel is usable again by now).
      was3d.current = false;
      document.getElementById(opener.current)?.focus();
    }
  }, [in3d]);

  // While it plays, the panel stays in view on wide screens but cannot be used. (A layout effect:
  // it must be usable again before the next screen's heading takes the focus.)
  useLayoutEffect(() => {
    if (panelRef.current) panelRef.current.inert = replaying || in3d;
    if (topbarRef.current) topbarRef.current.inert = in3d;
  }, [replaying, in3d]);

  const data = load.state === "ready" ? load.data : null;
  const mon = data && game ? data.monuments.find((m) => m.pilot_key === game.pilot) : undefined;
  const playable = mon && isPlayable(mon) ? mon : null;
  const session: Session | null = game && { ...game, picks: countPicks(game.placements) };
  const inGame = screen !== "home" && screen !== "teacher" && screen !== "observe" && session && playable;
  const observing = screen === "observe" && report && data ? report : null;
  // A card for one of the game's monuments has its pin on the map; one for a building of the visitor's
  // own (OWN) is placed in words, and the map stays as it was.
  const observingSite = observing && observing.pilot !== OWN ? observing : null;
  // "Beat my score on the same dangers": ?m=delos&l=high&d=65.69.82&s=68 (see game/challenge.ts).
  const challenge = useMemo(() => (data ? challengeFromUrl(window.location.search, data) : null), [data]);
  // The real alarms of this game's week on duty, one per day; today's is week[day].
  const week = playable && game ? weekAlarms(playable, game.level) : [];
  const today = game ? (week[game.day] ?? null) : null;
  // The alarm in 3D starts loading with the mission (and with the score, for the next day's alarm), so it
  // is there when the alarm goes off.
  const comingAlarms = [today, game ? (week[game.day + 1] ?? null) : null].map((a) => a?.view_3d ?? "").join(" ");
  useEffect(() => {
    if (!data || !inGame || (screen !== "mission" && screen !== "score") || !canShow3d()) return;
    for (const scene of new Set(comingAlarms.split(" ").filter(Boolean))) preload3d(scene, data).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comingAlarms, screen, !!inGame, data]);

  /** Plays `alarm` on the map, then opens its screen; an alarm with no position goes straight there. */
  const beginReplay = (alarm: Alarm | null, picks: Picks) => {
    if (!data || !playable || !alarm?.instruments.some((i) => i.lat !== null && i.lon !== null)) {
      setScreen("event");
      return;
    }
    replayFrom.current = screen;
    setReplayOver(false);
    setReplaying(true);
    announce(t("replay.live"));
    const rule = ruleFor(data, playable, alarm);
    const still = motionReduced();
    stopReplaySound.current = playReplay(!!rule && detects(rule, picks).detected, still);
    // In 3D too, where ARGUS has a model of the place the alarm's sensor stands in.
    const run = ++replayRun.current;
    replayStart.current = performance.now();
    const sensor = alarm.instruments.find((i) => i.lat !== null && i.lon !== null)!;
    if (alarm.view_3d && canShow3d()) {
      awaiting3d.current = true;
      // today: the alarm, at its sensor (no damage drawn yet)
      const focus: Focus3d = {
        kind: null,
        serial: serialOf(sensor.name),
        at: [sensor.lat!, sensor.lon!],
      };
      preload3d(alarm.view_3d, data).then(
        (loaded) => replayRun.current === run && setAlarm3d({ loaded, focus, stage: "building" }),
        // not loadable (offline): the alarm stays on the map, and its picture is complete when the map's is
        () => replayRun.current === run && mapOnly(),
      );
    }
  };
  /** The alarm stays on the map after all: its picture is complete when the map's is (the replay's own
   *  time, 3.4 s, or at once if that has passed). */
  const mapOnly = () => {
    awaiting3d.current = false;
    const left = replayStart.current + (motionReduced() ? 600 : 3400) - performance.now();
    if (left <= 0) replayComplete();
    // else the replay's own timer completes it
  };
  /** The scene is built: the map keeps showing the alarm for a moment (2.6 s from the start), then flies down. */
  const alarm3dReady = () => {
    const run = replayRun.current;
    setAlarm3d((a) => (a ? { ...a, stage: "waiting" } : a));
    const wait = Math.max(0, replayStart.current + (motionReduced() ? 600 : 2600) - performance.now());
    window.setTimeout(() => replayRun.current === run && setAlarm3d((a) => (a ? { ...a, stage: "flying" } : a)), wait);
  };

  const start = (pilot: string, level: LevelId, mission?: string[], beat: number | null = null) => {
    // Phones: the whole screen for the game (from this tap: browsers allow it only from one).
    if (getSettings().fullScreen) enterFullscreen();
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
        onOwn={() => openReport(OWN, "home")}
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
        {screen === "history" && (
          <History
            {...props}
            mapApi={mapApi}
            onBack={() => {
              returnTo.current = "hook-title";
              setScreen("story");
            }}
          />
        )}
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
            onReplay={() => beginReplay(today, session.picks)}
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
            onOwn={() => openReport(OWN, "score")}
            onView3d={(scene, loaded, focus, from) => {
              opener.current = from; // the button that opened it has the focus again afterwards
              setView3d({ scene, loaded, focus, stage: "building" });
            }}
            week={week}
            onImprove={(total) => {
              // The first score of the day is the "before", however often the network is changed.
              setGame((g) => (g ? { ...g, improving: true, scoreBefore: g.scoreBefore ?? total } : g));
              setScreen("mission");
            }}
            onNextDay={(result) => {
              // Today is settled as it stands; tomorrow starts with the same network and a fresh question.
              setGame((g) => (g ? { ...g, past: [...g.past, result], day: g.day + 1, scoreBefore: null, decision: null } : g));
              // Tomorrow's alarm plays on the map first, as the first day's did.
              beginReplay(week[session.day + 1] ?? null, session.picks);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div
      className={`app${REVIEW_MODE ? " review" : ""}${inGame && screen === "mission" ? " is-play" : ""}${replaying ? " is-replay" : ""}${in3d ? " is-3d" : ""}`}
      // Small screens size the map by what the screen is for (styles.css, "small screens").
      data-screen={screen}
    >
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <header className="topbar" ref={topbarRef}>
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={() => setScreen("home")} disabled={screen === "home"}>
            <BrandMark />
            <span>{t("app.title")}</span>
          </button>
          <div className="topbar-tools">
            <A11yMenu />
            <LangMenu />
          </div>
        </div>
      </header>
      <div className={data ? "board" : "board no-map"}>
        {data && (
          <GameMap
            data={data}
            mode={observingSite ? "report" : inGame ? (replaying ? "replay" : mapMode(screen)) : "overview"}
            pilot={observingSite ? observingSite.pilot : inGame ? game!.pilot : homePilot}
            reportPin={observingSite?.at}
            onReportPin={observingSite?.editable ? (at) => setReport((r) => (r ? { ...r, at } : r)) : undefined}
            placements={inGame ? game!.placements : []}
            alarm={inGame && (screen === "event" || replaying) ? today : null}
            onReplaySkip={finishReplay}
            replayOver={replayOver}
            view3d={
              view3d && view3d.stage !== "building"
                ? { center: view3d.loaded.assets.centre, zoom: MAP_ZOOM }
                : alarm3d && (alarm3d.stage === "flying" || alarm3d.stage === "arrived")
                  ? { center: alarm3d.loaded.assets.centre, zoom: MAP_ZOOM }
                  : null
            }
            onArrived3d={() => {
              setView3d((v) => (v ? { ...v, stage: "arrived" } : v));
              setAlarm3d((a) => (a ? { ...a, stage: "arrived" } : a));
            }}
            overlay={
              view3d && playable ? (
                <View3D
                  mon={playable}
                  scene={view3d.scene}
                  focus={view3d.focus}
                  cards={data.cards.cards}
                  loaded={view3d.loaded}
                  mapApi={mapApi}
                  arrived={view3d.stage === "arrived"}
                  onReady={() => setView3d((v) => (v && v.stage === "building" ? { ...v, stage: "flying" } : v))}
                  onClosed={() => setView3d(null)}
                />
              ) : alarm3d && replaying ? (
                <Alarm3D
                  loaded={alarm3d.loaded}
                  focus={alarm3d.focus}
                  mapApi={mapApi}
                  arrived={alarm3d.stage === "arrived"}
                  onReady={alarm3dReady}
                  onDown={() => awaiting3d.current && replayComplete()}
                  onFailed={() => {
                    replayRun.current++;
                    setAlarm3d(null);
                    mapOnly();
                  }}
                />
              ) : null
            }
            apiRef={mapApi}
            onSelectSite={(pilot) => {
              setHomePilot(pilot);
              announce(t("map.selected", { name: siteName(data, pilot, i18n.pick) }));
            }}
            onMovePlacement={(id, at) => {
              movePlacement(id, at);
              play("drop");
              announce(t("map.pinMoved"));
            }}
            onRemovePlacement={(id) => {
              removePlacement(id);
              play("remove");
              announce(t("map.removed"));
            }}
          />
        )}
        <div className="board-panel" ref={panelRef}>
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
