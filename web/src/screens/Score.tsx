import { useEffect, useMemo, useState } from "react";
import type { ScreenProps } from "../App";
import { summaryOf, topCard, type CommunityStore, type PlayRecord, type Summary } from "../community/store";
import { DayStrip } from "../components/DayStrip";
import { Leaderboard } from "../components/Leaderboard";
import { loadAccount } from "../community/nickname";
import { SaveScore } from "../components/SaveScore";
import { ConsequenceDrawings } from "../components/Consequence";
import { GuardianSays } from "../components/Guardian";
import { Open3dButton } from "../components/View3D";
import { canShow3d, type Focus3d, type Loaded } from "../view3d/preload";
import { serialOf } from "../view3d/math";
import { ReadAloud } from "../components/ReadAloud";
import { endingNarration, farewellNarration, guardianBack } from "../audio/narration";
import { Icon } from "../components/Icon";
import { challengeOutcome, challengeQuery } from "../game/challenge";
import {
  cardById,
  checklistFor,
  earlierRules,
  humanCards,
  missionScenarios,
  ruleFor,
  score,
  visitorCodeFor,
  type CoverLevel,
  type DayResult,
} from "../game/logic";
import type { Alarm } from "../game/types";
import { play } from "../audio/sounds";
import { useI18n, type MessageKey } from "../i18n";
import { runtimeConfig } from "../runtime";

interface Props extends ScreenProps {
  community: CommunityStore;
  onReplay: () => void;
  /** "Play again with new dangers" when the level can draw a new mission. */
  replayLabel: string;
  onQuiz: () => void;
  /** This game's record, not stored yet: App stores it without a name if the player never saves it. */
  onPending: (record: PlayRecord) => void;
  /** The player saved this game under their account (`nick`): it is in the community store. */
  onRecorded: (nick: string) => void;
  /** Opens the observation report for this monument. */
  onReport: () => void;
  /** "Display in 3D" under the drawings, once the view is loaded: the game opens it over the map. */
  onView3d: (scene: string, loaded: Loaded, focus: Focus3d, from: string) => void;
  /** The real alarms of the week on duty, one per day; today's is week[session.day]. Empty if none can be replayed. */
  week: Alarm[];
  /** Back to the mission with the same sensors and dangers; `total` is the score to compare with afterwards. */
  onImprove: (total: number) => void;
  /** Settle today as it stands and replay tomorrow's alarm. */
  onNextDay: (today: DayResult) => void;
}

const STATUS: Record<CoverLevel | "unscored", { cls: string; icon: string; key: MessageKey }> = {
  full: { cls: "learn is-yes", icon: "check", key: "score.covered" },
  partial: { cls: "learn is-partial", icon: "half", key: "score.partial" },
  none: { cls: "learn is-no", icon: "cross", key: "score.notCovered" },
  // No card can warn about it (e.g. lost skills): taught, never scored, so no "not covered" mark.
  unscored: { cls: "learn is-info", icon: "talk", key: "score.noSensorTag" },
};

export function Score({
  data,
  mon,
  session,
  classCode,
  go,
  community,
  onReplay,
  replayLabel,
  onQuiz,
  onPending,
  onRecorded,
  onReport,
  onView3d,
  week,
  onImprove,
  onNextDay,
}: Props) {
  const i18n = useI18n();
  const { t, pick, list, number } = i18n;
  const cards = useMemo(() => cardById(data), [data]);
  const threats = missionScenarios(mon, session.level, session.mission);
  const alarm = week[session.day] ?? null;
  const rule = alarm && ruleFor(data, mon, alarm);
  // A sensor kept for an earlier day's alarm still counts as coins well spent.
  const result = score(threats, rule, session.picks, cards, earlierRules(data, mon, week, session.day));
  const detected = result.alarm?.detected ?? false;
  // A week on duty: the days before as they were settled, and today as it stands now.
  const hasWeek = week.length > 1;
  const lastDay = session.day >= week.length - 1;
  const results = [...session.past.map((d) => d.detected), ...(alarm ? [detected] : [])];
  const caught = results.filter(Boolean).length;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  // The checklist is folded until asked for (or until it is printed).
  const [checklistOpen, setChecklistOpen] = useState(false);

  // The challenge link: the same monument, level and dangers, and this score to beat. No class code in it.
  // On the class server it uses the address others on the network can reach, not this computer's "localhost".
  const here = runtimeConfig().publicUrl ?? `${window.location.origin}${window.location.pathname}`;
  const challengeUrl = `${here}?${challengeQuery(mon, session.level, session.mission, result.total)}`;
  const share = async () => {
    const text = t("share.text", { name: pick(mon.display_name), score: result.total });
    const url = challengeUrl;
    try {
      if (navigator.share) {
        await navigator.share({ title: t("app.title"), text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShareStatus(t("share.copied"));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setShareStatus(t("share.failed"));
    }
  };
  useEffect(() => play("complete"), []);

  // This game's record. It is stored when the player saves it under their account ("Save your score"),
  // or else without a name once the day or the game is over (App.tsx), so it counts in the statistics.
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const record = useMemo<PlayRecord>(
    () => ({
      v: 1,
      monument: mon.pilot_key,
      level: session.level,
      picks: session.picks,
      score: result.total,
      detected,
      day,
      ...(classCode ? { classCode } : {}),
      ...(session.decision ? { decision: session.decision } : {}),
    }),
    [mon.pilot_key, session.level, session.picks, result.total, detected, day, classCode, session.decision],
  );
  useEffect(() => {
    if (!session.recorded) onPending(record);
  }, [record, session.recorded, onPending]);

  useEffect(() => {
    summaryOf(community, { monument: mon.pilot_key, level: session.level, classCode: classCode ?? undefined })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [community, mon.pilot_key, session.level, classCode]);
  // On the board: the account this game was saved under, else the one last signed in to on this device.
  const [remembered] = useState(loadAccount);
  const nick = session.savedAs ?? remembered ?? "";

  const names = (ids: string[]) => list(ids.map((id) => pick(cards.get(id)?.name)));
  const top = summary && topCard(summary, humanCards(data));
  // Read after the summary arrived, so it says where that summary came from.
  const shared = summary !== null && community.kind === "shared";
  const argusCount = (card: string) => mon.installed.by_card.find((r) => r.card === card)?.count ?? 0;

  return (
    <div className="screen score">
      <h1 tabIndex={-1}>{session.day > 0 ? t("week.scoreHeading", { n: session.day + 1 }) : t("score.heading")}</h1>
      <div className="panel score-card">
        <p className="score-big">{t("score.points", { score: result.total })}</p>
        <p className="verdict">{t(`score.verdict.${result.verdict}` as MessageKey)}</p>
        {session.scoreBefore !== null && (
          <p className="score-change">
            <strong>{t("week.before", { before: session.scoreBefore, now: result.total })}</strong>
          </p>
        )}
        {session.beat !== null && (
          <p className="score-change">
            <strong>{t(`challenge.${challengeOutcome(result.total, session.beat)}` as MessageKey, { score: session.beat })}</strong>
          </p>
        )}
        <ul className="breakdown">
          <li>
            <span>{t("score.threats", { full: result.full, partial: result.partial, total: threats.length })}</span>
            <strong>{t("score.partPoints", { points: result.threats.points, max: result.threats.max })}</strong>
          </li>
          {result.alarm && (
            <li>
              <span className="breakdown-label">
                <Icon name={result.alarm.detected ? "check" : "cross"} size={20} />
                {t(result.alarm.detected ? "score.alarmYes" : "score.alarmNo")}
              </span>
              <strong>{t("score.partPoints", { points: result.alarm.points, max: result.alarm.max })}</strong>
            </li>
          )}
          <li>
            <span>{t("score.efficiency", { useful: result.usefulCoins, spent: result.spentCoins })}</span>
            <strong>{t("score.partPoints", { points: result.efficiency.points, max: result.efficiency.max })}</strong>
          </li>
        </ul>
        {!result.alarm && <p className="small">{t("score.scaled")}</p>}
      </div>

      {/* Save the score under an account (new, or signed in to), then who did best: the class, everyone,
          or this device; and how far the next one is. Read again once the score is saved. */}
      <SaveScore community={community} record={record} savedAs={session.savedAs} onSaved={onRecorded} />
      <Leaderboard
        key={session.savedAs ?? ""}
        community={community}
        monument={mon.pilot_key}
        level={session.level}
        classCode={classCode}
        nick={nick}
        score={result.total}
        ready
      />

      {/* The guardian comes back (first day), and what the day's alarm would have led to if nobody noticed. */}
      {(() => {
        const replayed = rule ? alarm : null;
        const firstDay = session.day === 0;
        const back = firstDay ? guardianBack(i18n, mon, replayed, detected) : null;
        const consequence = replayed ? mon.consequences?.[replayed.rule] : undefined;
        const narration = endingNarration(i18n, mon, replayed, detected, firstDay);
        // The monument's places in 3D (ARGUS's own models): the day's danger at the place of its sensor,
        // and the other places to look at.
        const scenes = canShow3d() ? (mon.scenes_3d ?? []) : [];
        const placeName = (place: string | null) => {
          const p = place ? mon.places?.find((x) => x.id === place) : undefined;
          return pick(p ? p.name : mon.display_name);
        };
        const sensor = replayed?.instruments.find((i) => i.lat != null && i.lon != null) ?? replayed?.instruments[0];
        const dayFocus: Focus3d = {
          kind: consequence?.picture ?? null,
          serial: sensor ? serialOf(sensor.name) : null,
          at: sensor && sensor.lat != null && sensor.lon != null ? [sensor.lat, sensor.lon] : null,
        };
        const looking: Focus3d = { kind: null, serial: null, at: null };
        const others = scenes.filter((s) => s.scene !== consequence?.view_3d);
        const placeButtons = (list: typeof scenes) => (
          <div className="consequence-3d-places">
            {list.map((s) => (
              <Open3dButton
                key={s.scene}
                id={`view3d-open-${s.scene}`}
                scene={s.scene}
                data={data}
                focus={looking}
                label={placeName(s.place)}
                onOpen={onView3d}
              />
            ))}
          </div>
        );
        const after = consequence ? (
          <section className="consequence" aria-labelledby="consequence-title">
            <h2 id="consequence-title">{t("consequence.title")}</h2>
            <p>{t(detected ? "consequence.caught" : "consequence.missed")}</p>
            <ConsequenceDrawings picture={consequence.picture} />
            {/* The same damage in 3D at this monument, where this device can draw it. */}
            {consequence.view_3d && scenes.some((s) => s.scene === consequence.view_3d) && (
              <Open3dButton scene={consequence.view_3d} data={data} focus={dayFocus} onOpen={onView3d} />
            )}
            <p className="lead" data-needs-review={consequence.needs_review}>
              {pick(consequence.text)}
            </p>
            {others.length > 0 && (
              <>
                <p className="small">{t("consequence.view3dAlso")}</p>
                {placeButtons(others)}
              </>
            )}
          </section>
        ) : (
          scenes.length > 0 && (
            // No danger of the day to show (no alarm to replay here): the monument itself, in 3D.
            <section className="consequence" aria-labelledby="in3d-title">
              <h2 id="in3d-title">{t("score.in3dTitle")}</h2>
              <p>{t("score.in3dText")}</p>
              {placeButtons(scenes)}
            </section>
          )
        );
        if (back && mon.guardian) {
          return (
            <>
              <GuardianSays
                mon={mon}
                headingId="guardian-back-title"
                title={t("guardian.backTitle", { name: pick(mon.guardian.name) })}
                text={back}
              >
                <ReadAloud text={narration} />
              </GuardianSays>
              {after}
            </>
          );
        }
        return (
          after && (
            <>
              {after}
              <ReadAloud text={narration} />
            </>
          )
        );
      })()}

      {/* The second turn: improve the network, and (optionally) stay on duty for another day. */}
      <section className="panel week" aria-labelledby="week-title">
        <h2 id="week-title">{t(hasWeek ? "week.title" : "week.improveTitle")}</h2>
        {hasWeek && (
          <>
            <p className="day-label">{t("week.day", { n: session.day + 1, total: week.length })}</p>
            <DayStrip results={results} total={week.length} />
            <p className="week-lead">
              {lastDay
                ? t("week.done", { caught, total: week.length })
                : t(detected ? "week.caughtToday" : "week.missedToday")}
            </p>
          </>
        )}
        <div className="actions actions-split">
          {hasWeek && !lastDay && alarm && (
            <button
              type="button"
              className="btn btn-primary btn-big"
              onClick={() => onNextDay({ alarm: alarm.id, detected, total: result.total })}
            >
              {t("week.next", { n: session.day + 2 })}
              <Icon name="arrow" />
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-big" onClick={() => onImprove(result.total)}>
            {t("week.improve")}
          </button>
        </div>
        {/* The fine print folds away: the block ends on its two buttons, and fits one phone screen. */}
        <details className="fold week-how">
          <summary>
            <span>{t("week.how")}</span>
            <Icon name="chevron" size={18} className="fold-chevron" />
          </summary>
          <p className="small">{t("week.improveHelp")}</p>
          {hasWeek && <p className="small">{t("week.note")}</p>}
        </details>
      </section>

      {/* The game's own questions again, straight after the result: it is the class's next step. */}
      <section className="panel quiz-invite" aria-labelledby="quiz-invite-title">
        <h2 id="quiz-invite-title">{t("quiz.inviteTitle")}</h2>
        <p>{t("quiz.inviteText")}</p>
        <button type="button" className="btn btn-primary btn-big" onClick={onQuiz}>
          {t("quiz.open")}
          <Icon name="arrow" />
        </button>
      </section>

      <section aria-labelledby="learn-title">
        <h2 id="learn-title">{t("score.learn")}</h2>
        <ul className="learn-list">
          {result.coverage.map(({ scenario: s, level, by }) => {
            const status = STATUS[s.capable_cards.length === 0 ? "unscored" : level];
            // Cards the player did not pick; when nothing watches the threat directly, the primary ones are listed apart.
            const others = s.capable_cards.filter((c) => !by.includes(c) && (level === "full" || !s.primary_cards.includes(c)));
            const review = s.capable_cards_needs_review;
            return (
              <li key={s.scenario_key} className={status.cls}>
                <p className="status-tag">
                  <Icon name={status.icon} size={20} />
                  {t(status.key)}
                </p>
                <h3 data-needs-review={s.plain.needs_review}>{pick(s.plain.title)}</h3>
                {/* What the danger is, again, only where it was not fully covered: that is the one to reread. */}
                {status !== STATUS.full && <p data-needs-review={s.plain.needs_review}>{pick(s.plain.text)}</p>}
                {s.capable_cards.length === 0 ? (
                  <p>{t("score.noSensor")}</p>
                ) : (
                  <>
                    {level === "full" && <p>{t("score.coveredBy", { names: names(by) })}</p>}
                    {level === "partial" && <p data-needs-review={review}>{t("score.partialBy", { names: names(by) })}</p>}
                    {level !== "full" && (
                      <p data-needs-review={review}>{t("score.directly", { names: names(s.primary_cards) })}</p>
                    )}
                    {others.length > 0 && level !== "partial" && (
                      <p data-needs-review={review}>{t("score.alsoHelp", { names: names(others) })}</p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* What the player takes with them: the guardian's parting words, true of this place, and how to
          behave at any old monument and why (content/visitor_code.json), so what the game taught is
          what they remember at the next monument they visit. */}
      {(() => {
        const code = visitorCodeFor(data.visitor_code.items, threats);
        const farewell = mon.guardian ? pick(mon.guardian.farewell) : null;
        const aloud = farewellNarration(i18n, data, mon);
        // Its own block under the guardian, as wide as the screen: on a phone the guardian's portrait
        // column would leave the rules a narrow strip.
        const rules = (
          <section className="visitor-code-block" aria-labelledby="visitor-code-title">
            <h2 id="visitor-code-title" className="visitor-code-title">
              {t("farewell.rules")}
            </h2>
            {!farewell && <ReadAloud text={aloud} />}
            <ol className="visitor-code" data-needs-review={data.visitor_code.needs_review}>
              {code.map(({ item, forMission }) => (
                <li key={item.id}>
                  <Icon name={item.icon} size={28} />
                  <div>
                    <p className="visitor-rule">
                      <strong>{pick(item.rule)}</strong>
                      {forMission && <span className="tag">{t("citizen.mission")}</span>}
                    </p>
                    <p className="visitor-why">{pick(item.why)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
        return (
          <>
            {farewell && mon.guardian && (
              <GuardianSays
                mon={mon}
                headingId="farewell-title"
                title={t("farewell.title", { name: pick(mon.guardian.name) })}
                text={farewell}
              >
                <ReadAloud text={aloud} />
              </GuardianSays>
            )}
            {rules}
          </>
        );
      })()}

      {/* Outside the game: watch for yourself, challenge someone, see what others chose. The long
          lists fold away, so the screen is not eight blocks in a row. */}
      <section className="panel citizen printable" aria-labelledby="citizen-title">
        <h2 id="citizen-title">
          <Icon name="observer" />
          {t("citizen.title")}
        </h2>
        <p>{t("citizen.intro")}</p>
        <details className="fold" open={checklistOpen} onToggle={(e) => setChecklistOpen(e.currentTarget.open)}>
          <summary>
            <span>{t("citizen.fold", { n: data.checklist.items.length })}</span>
            <Icon name="chevron" size={18} className="fold-chevron" />
          </summary>
          <ul className="checklist" data-needs-review={data.checklist.needs_review}>
            {checklistFor(data.checklist.items, threats).map(({ item, forMission }) => (
              <li key={item.id}>
                <Icon name={item.icon} size={22} />
                <span>
                  {pick(item.text)}
                  {forMission && <span className="tag">{t("citizen.mission")}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="citizen-report">
            <strong>{pick(data.checklist.report)}</strong>
          </p>
        </details>
        <div className="actions actions-split no-print">
          <button type="button" className="btn btn-secondary" onClick={onReport}>
            {t("report.open")}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              // The list must be open to be on the paper.
              setChecklistOpen(true);
              requestAnimationFrame(() => window.print());
            }}
          >
            {t("citizen.print")}
          </button>
        </div>
      </section>

      {/* Challenge a friend: the link is shown, so it can be seen and copied by hand too. */}
      <section className="panel challenge-send" aria-labelledby="challenge-send-title">
        <h2 id="challenge-send-title">
          <Icon name="shield" />
          {t("challenge.sendTitle")}
        </h2>
        <p>{t("challenge.sendText", { score: result.total })}</p>
        <p className="class-link">
          <a href={challengeUrl}>{challengeUrl}</a>
        </p>
        <button type="button" className="btn btn-primary" onClick={share}>
          {t("share.button")}
          <Icon name="arrow" />
        </button>
        <p className="small" role="status">
          {shareStatus}
        </p>
      </section>

      <details className="fold fold-block community">
        <summary>
          <span>{classCode ? t("score.communityClass", { code: classCode }) : t("score.community")}</span>
          <Icon name="chevron" size={18} className="fold-chevron" />
        </summary>
        {summary && summary.games > 1 && top ? (
          <>
            <p>{t(shared ? "score.communityCountShared" : "score.communityCount", { n: summary.games })}</p>
            <p>
              {t("score.communityTop", {
                name: pick(cards.get(top.card)?.name),
                pct: number(top.share * 100, 0),
                argus: argusCount(top.card),
              })}
            </p>
          </>
        ) : (
          <p>{t("score.communityFirst")}</p>
        )}
        <p className="small">{t(shared ? "score.communityShared" : "score.communityLocal")}</p>
      </details>

      <div className="actions actions-split">
        <button type="button" className="btn btn-secondary btn-big" onClick={onReplay}>
          {replayLabel}
        </button>
        <button type="button" className="btn btn-secondary btn-big" onClick={() => go("home")}>
          {t("score.otherLevel")}
        </button>
      </div>
    </div>
  );
}
