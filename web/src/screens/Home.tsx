import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { normalizeClassCode } from "../community/classCode";
import { GuardianName } from "../components/GuardianName";
import { Icon } from "../components/Icon";
import { LevelBars, levelKey } from "../components/LevelBadge";
import { LiveArgus } from "../components/LiveArgus";
import type { Challenge } from "../game/challenge";
import { formatCoords, isPlayable } from "../game/logic";
import type { GameData, Level, LevelId, LevelSummary } from "../game/types";
import { useI18n } from "../i18n";

interface Props {
  data: GameData;
  /** Selected monument; shared with the map so a tap on a pin selects it here too. */
  pilot: string | null;
  setPilot: (pilot: string) => void;
  initialLevel?: LevelId;
  onStart: (pilot: string, level: LevelId) => void;
  classCode: string | null;
  setClassCode: (code: string | null) => void;
  onTeacher: () => void;
  /** Opens the observation report for the selected monument. */
  onReport: () => void;
  /** "Your own monument": a card for an old building of the player's own neighbourhood. */
  onOwn: () => void;
  /** The game was opened from a challenge link ("beat my score on the same dangers"). */
  challenge: Challenge | null;
  onChallenge: () => void;
}

/** Join or leave a class. Lives inside the home form, so Enter here joins instead of starting the game. */
function ClassPanel({ classCode, setClassCode, onTeacher }: Pick<Props, "classCode" | "setClassCode" | "onTeacher">) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState(false);
  const join = () => {
    const code = normalizeClassCode(typed);
    setError(!code);
    if (code) {
      setClassCode(code);
      setTyped("");
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      join();
    }
  };
  return (
    <section className="panel class-panel" aria-labelledby="class-title">
      <h2 id="class-title">{t("class.title")}</h2>
      {classCode ? (
        <>
          <p>{t("class.in", { code: classCode })}</p>
          <button type="button" className="btn btn-quiet" onClick={() => setClassCode(null)}>
            {t("class.leave")}
          </button>
        </>
      ) : (
        <>
          <p className="hint">{t("class.help")}</p>
          <label className="field-label" htmlFor="class-code">
            {t("class.label")}
          </label>
          <div className="field-row">
            <input
              id="class-code"
              className="field"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={8}
              value={typed}
              aria-invalid={error}
              aria-describedby={error ? "class-error" : undefined}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(false);
              }}
              onKeyDown={onKey}
            />
            <button type="button" className="btn btn-secondary" onClick={join}>
              {t("class.join")}
            </button>
          </div>
          {error && (
            <p id="class-error" className="field-error">
              {t("class.invalid")}
            </p>
          )}
        </>
      )}
      <p className="teacher-link">
        <button type="button" className="btn btn-quiet" onClick={onTeacher}>
          {t("class.teacher")}
        </button>
      </p>
    </section>
  );
}

/** Shown when the game was opened from a challenge link: the same monument, level and dangers. */
function ChallengePanel({ data, challenge, onChallenge }: Pick<Props, "data" | "onChallenge"> & { challenge: Challenge }) {
  const { t, pick } = useI18n();
  const mon = data.monuments.find((m) => m.pilot_key === challenge.pilot);
  const name = mon?.display_name ? pick(mon.display_name) : (mon?.name ?? challenge.pilot);
  return (
    <section className="panel challenge" aria-labelledby="challenge-title">
      <h2 id="challenge-title">
        <Icon name="shield" />
        {t("challenge.title")}
      </h2>
      <p>{t("challenge.text", { name, level: t(levelKey(challenge.level)) })}</p>
      {challenge.score !== null && (
        <p>
          <strong>{t("challenge.beat", { score: challenge.score })}</strong>
        </p>
      )}
      <button type="button" className="btn btn-primary btn-big" onClick={onChallenge}>
        {t("challenge.accept")}
        <Icon name="arrow" />
      </button>
    </section>
  );
}

/** Highest available level: it carries the monument's story hook. */
function defaultLevel(levels: LevelSummary[]): LevelId | undefined {
  return [...levels].reverse().find((l) => l.available)?.id;
}

/** The level the player chose, or the nearest one this monument has (the less serious on a tie). */
function nearestLevel(levels: LevelSummary[], wanted: LevelId): LevelId | undefined {
  const at = levels.findIndex((l) => l.id === wanted);
  return levels
    .map((l, i) => ({ l, distance: Math.abs(i - at) + (i > at ? 0.5 : 0) }))
    .filter(({ l }) => l.available)
    .sort((a, b) => a.distance - b.distance)[0]?.l.id;
}

export function Home({
  data,
  pilot,
  setPilot,
  initialLevel,
  onStart,
  classCode,
  setClassCode,
  onTeacher,
  onReport,
  onOwn,
  challenge,
  onChallenge,
}: Props) {
  const { t, tn, pick } = useI18n();
  const mon = data.monuments.find((m) => m.pilot_key === pilot);
  const [level, setLevel] = useState<LevelId | undefined>(initialLevel ?? (mon && defaultLevel(mon.levels)));
  // The level the player picked themselves: it stays when they switch monument.
  const [chosen, setChosen] = useState<LevelId | undefined>(initialLevel);

  // A new monument (from the list or the map) keeps the chosen level, or the nearest one it has;
  // without a choice yet, it starts at its highest available level.
  const [levelFor, setLevelFor] = useState(pilot);
  useEffect(() => {
    if (pilot === levelFor) return;
    setLevelFor(pilot);
    setLevel(mon && (chosen ? nearestLevel(mon.levels, chosen) : defaultLevel(mon.levels)));
  }, [pilot, levelFor, mon, chosen]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mon?.playable && level) onStart(mon.pilot_key, level);
  };

  const chosenLevel = mon?.levels.find((l) => l.id === level);
  const canStart = !!mon?.playable && !!level;

  return (
    <form className="screen home" onSubmit={submit}>
      <h1 tabIndex={-1}>{t("app.title")}</h1>
      <p className="lead">{t("home.intro")}</p>

      {challenge && <ChallengePanel data={data} challenge={challenge} onChallenge={onChallenge} />}

      {/* The two choices come first; the Start bar below stays in view while they are made. */}
      <fieldset className="choices choices-index">
        <legend>
          <h2>{t("home.monument")}</h2>
        </legend>
        <p className="hint">{t("home.mapHint")}</p>
        {[...data.monuments].sort((a, b) => Number(b.playable) - Number(a.playable)).map((m) => (
          <label key={m.pilot_key} className={`choice${m.playable ? "" : " is-disabled"}`}>
            <input
              type="radio"
              name="monument"
              value={m.pilot_key}
              checked={pilot === m.pilot_key}
              disabled={!m.playable}
              onChange={() => setPilot(m.pilot_key)}
            />
            {m.photo && <img className="choice-photo" src={`${import.meta.env.BASE_URL}${m.photo.thumb}`} alt="" />}
            <span className="choice-body">
              <span className="choice-title">{m.display_name ? pick(m.display_name) : m.name}</span>
              <span className="choice-meta">
                {m.place ? pick(m.place) : m.country}
                {!m.playable && <> · {t("home.comingSoon")}</>}
              </span>
              {m.map && <span className="choice-coords">{formatCoords(m.map.center)}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      {/* The monitoring goes on: the newest from ARGUS for the chosen monument (when the Pi has it). */}
      {mon && isPlayable(mon) && <LiveArgus data={data} mon={mon} />}

      {mon && (
        <fieldset className="choices choices-ladder">
          <legend>
            <h2>{t("home.level")}</h2>
          </legend>
          <p className="hint">{t("home.levelHelp")}</p>
          {mon.levels.map((l) => (
            <label key={l.id} className={`choice${l.available ? "" : " is-disabled"}`}>
              <input
                type="radio"
                name="level"
                value={l.id}
                checked={level === l.id}
                disabled={!l.available}
                onChange={() => {
                  setLevel(l.id);
                  setChosen(l.id);
                }}
              />
              <span className="choice-body">
                <span className="choice-title">
                  <LevelBars id={l.id} />
                  {t(levelKey(l.id))}
                </span>
                <span className="choice-meta">
                  {l.available
                    ? `${t("home.levelCount", { n: l.scenario_count })} · ${tn("unit.coins", (l as Level).budget ?? 0)}`
                    : t("home.levelNone")}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <section aria-labelledby="how-title" className="panel">
        <h2 id="how-title">{t("home.how")}</h2>
        <ol className="how-list">
          <li>{t("home.how1")}</li>
          <li>{t("home.how2")}</li>
          <li>{t("home.how3")}</li>
          <li>{t("home.how4")}</li>
        </ol>
      </section>

      <GuardianName />

      <ClassPanel classCode={classCode} setClassCode={setClassCode} onTeacher={onTeacher} />

      {/* Citizen science without playing: for someone standing at a monument right now. */}
      <section className="panel report-invite" aria-labelledby="report-invite-title">
        <h2 id="report-invite-title">
          <Icon name="observer" />
          {t("report.homeTitle")}
        </h2>
        <p>{t("report.homeText")}</p>
        <div className="actions">
          <button type="button" className="btn btn-secondary" disabled={!mon?.playable} onClick={onReport}>
            {t("report.open")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onOwn}>
            {t("own.option")}
          </button>
        </div>
      </section>

      {/* Last in the page, so a keyboard reaches it after the class code; pinned to the bottom of
          the panel, so nobody has to scroll to find it. It says what it will start. */}
      <div className="start-bar">
        <p className="start-summary" aria-live="polite">
          {canStart && mon && chosenLevel ? (
            <>
              <strong>{mon.display_name ? pick(mon.display_name) : mon.name}</strong>
              <span>
                {t(levelKey(chosenLevel.id))} · {tn("unit.coins", (chosenLevel as Level).budget ?? 0)}
              </span>
            </>
          ) : (
            t("home.monument")
          )}
        </p>
        <button type="submit" className="btn btn-primary btn-big" disabled={!canStart}>
          {t("home.start")}
          <Icon name="arrow" />
        </button>
      </div>
    </form>
  );
}
