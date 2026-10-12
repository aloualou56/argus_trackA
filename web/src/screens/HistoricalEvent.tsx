import { useMemo } from "react";
import type { ScreenProps } from "../App";
import { Icon } from "../components/Icon";
import {
  argusCards,
  cardById,
  detects,
  humanCards,
  judgeDecision,
  missionScenarios,
  owned,
  ruleFor,
  type DecisionVerdict,
} from "../game/logic";
import type { Alarm, GameData } from "../game/types";
import { useI18n, type MessageKey } from "../i18n";

interface Props extends ScreenProps {
  /** The player's answer to "what would you do next?" (kept for the class discussion, never scored). */
  onDecide: (optionId: string) => void;
  /** The real alarm replayed today: the level's own on day 1, another one on each later day on duty. */
  today: Alarm | null;
  /** How many days the week on duty has here (0 where no alarm can be replayed). */
  days: number;
}

const VERDICT: Record<DecisionVerdict, { cls: string; icon: string }> = {
  first: { cls: "learn is-yes", icon: "check" },
  fair: { cls: "learn is-partial", icon: "half" },
  early: { cls: "learn is-partial", icon: "half" },
  risky: { cls: "learn is-no", icon: "cross" },
};

/** After the alarm: someone has to decide what happens next. `alarm` is null where none can be replayed. */
function NextStep({
  data,
  alarm,
  chosen,
  onDecide,
}: {
  data: GameData;
  alarm: Alarm | null;
  chosen: string | null;
  onDecide: (optionId: string) => void;
}) {
  const { t, pick } = useI18n();
  const decisions = data.decisions;
  const option = decisions.options.find((o) => o.id === chosen);
  const verdict = option && judgeDecision(option, alarm);
  const review = decisions.needs_review;

  return (
    <section className="panel next-step" aria-labelledby="next-title">
      <fieldset className="choices choices-actions">
        <legend>
          <h2 id="next-title">{t("event.nextTitle")}</h2>
        </legend>
        <p className="hint" data-needs-review={review}>
          {pick(alarm ? decisions.intro : decisions.intro_no_alarm)}
        </p>
        <div className="action-grid">
          {decisions.options.map((o) => (
            <label key={o.id} className="choice">
              <input type="radio" name="next-step" value={o.id} checked={chosen === o.id} onChange={() => onDecide(o.id)} />
              <span className="choice-body">
                <span className="choice-title" data-needs-review={review}>
                  <Icon name={o.icon} size={20} />
                  {pick(o.label)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {/* Read out when the player chooses; they can change their mind and compare. */}
      <div role="status">
        {option && verdict && (
          <div className={VERDICT[verdict].cls}>
            <p className="status-tag">
              <Icon name={VERDICT[verdict].icon} size={20} />
              {t(`decision.${verdict}` as MessageKey)}
            </p>
            <p data-needs-review={review}>{pick((verdict === "risky" && option.feedback_risky) || option.feedback)}</p>
          </div>
        )}
        {option && alarm?.decision && (
          <>
            <p>{t("event.nextArgus")}</p>
            {/* ARGUS's own words, as recorded; our reading of them follows. */}
            <blockquote className="argus-quote" lang="en">
              {alarm.decision.text}
            </blockquote>
            <p data-needs-review={review}>{pick(decisions.argus_plain)}</p>
          </>
        )}
      </div>
      <p className="small">{t("event.nextNote")}</p>
    </section>
  );
}

export function HistoricalEvent({ data, mon, session, go, onDecide, today, days }: Props) {
  const { t, pick, number, date, list, month } = useI18n();
  // First and last alarm in the data, for "real data from ... to ..." (grows with each new snapshot).
  const alarmSpan = useMemo(() => {
    const stamps = data.monuments.flatMap((m) => (m.playable ? m.alarms.map((a) => a.timestamp) : [])).sort();
    return [stamps[0] ?? data.snapshot.fetched_at[0], stamps[stamps.length - 1] ?? data.snapshot.fetched_at[0]];
  }, [data]);
  const cards = useMemo(() => cardById(data), [data]);
  const alarm = today;
  const rule = alarm && ruleFor(data, mon, alarm);
  const later = session.day > 0;
  const heading = later ? t("week.eventHeading", { n: session.day + 1 }) : t("event.heading");

  const next = (
    <div className="actions">
      <button type="button" className="btn btn-primary btn-big" onClick={() => go("score")}>
        {t("event.continue")}
        <Icon name="arrow" />
      </button>
    </div>
  );

  if (!alarm || !rule) {
    return (
      <div className="screen event">
        <h1 tabIndex={-1}>{heading}</h1>
        {mon.no_alarm_note ? (
          <p className="lead" data-needs-review={mon.no_alarm_note.needs_review}>
            {pick(mon.no_alarm_note)}
          </p>
        ) : (
          <p className="lead">{t("event.none")}</p>
        )}
        <p>{t("event.noneScore")}</p>
        <NextStep data={data} alarm={null} chosen={session.decision} onDecide={onDecide} />
        {next}
      </div>
    );
  }

  const names = (ids: string[], type: "conjunction" | "disjunction" = "conjunction") =>
    list(ids.map((id) => pick(cards.get(id)?.name)), type);
  const withUnit = (v: number) =>
    rule.unit === "%" ? `${number(v)}%` : rule.unit ? `${number(v)} ${rule.unit}` : number(v);
  const detection = detects(rule, session.picks);
  const missing = list(detection.missing.map((group) => names(group, "disjunction")));
  const caughtBy = argusCards(alarm);
  const human = humanCards(data);
  const pickedHuman = [...owned(session.picks)].some((c) => human.has(c));
  const scale = Math.max(alarm.value, alarm.threshold) * 1.15;
  const missionKeys = new Set(missionScenarios(mon, session.level, session.mission).map((s) => s.scenario_key));
  const ai = alarm.type === "DL";
  const episode = alarm.episode.alarm_count > 1 && (
    <p>{t("event.episode", { n: alarm.episode.alarm_count, start: date(alarm.episode.start), end: date(alarm.episode.end) })}</p>
  );
  // ARGUS's risk model raised a linked danger within three days after this alarm (real data).
  const alarmTime = Date.parse(`${alarm.timestamp}Z`);
  const riskAfter = (alarm.context?.links ?? [])
    .map((key) => mon.scenarios.find((s) => s.scenario_key === key))
    .flatMap((scenario) =>
      (scenario?.risk?.raised ?? [])
        .filter((p) => {
          const lag = Date.parse(p.from) - alarmTime;
          return lag >= -3_600_000 && lag <= 3 * 86_400_000;
        })
        .map((period) => ({ scenario: scenario!, period, thresholds: scenario!.risk!.thresholds })),
    );
  const linked = (alarm.context?.links ?? [])
    .map((key) => mon.scenarios.find((s) => s.scenario_key === key))
    .filter((s): s is NonNullable<typeof s> => !!s);

  return (
    <div className="screen event">
      <h1 tabIndex={-1}>{heading}</h1>
      {later && <p className="day-label">{t("week.day", { n: session.day + 1, total: days })}</p>}
      <p className="lead">
        {t(ai ? "event.whatAi" : "event.what", { date: date(alarm.timestamp), measures: pick(rule.measures) })}
      </p>

      {ai ? (
        <section className="panel reading" aria-label={pick(rule.measures)}>
          <p>{t("event.aiHow")}</p>
          {alarm.feature_share !== null && (
            <p>
              <strong>{t("event.aiShare", { pct: number(alarm.feature_share * 100, 0) })}</strong>
            </p>
          )}
          {episode}
        </section>
      ) : (
        <section className="panel reading" aria-label={pick(rule.measures)}>
          <dl className="readings">
            <div>
              <dt>{t("event.value")}</dt>
              <dd>{withUnit(alarm.value)}</dd>
            </div>
            <div>
              <dt>{t("event.limit")}</dt>
              <dd>{withUnit(alarm.threshold)}</dd>
            </div>
          </dl>
          <div className="gauge" aria-hidden="true">
            <span className="gauge-fill" style={{ width: `${(alarm.value / scale) * 100}%` }} />
            <span className="gauge-limit" style={{ left: `${(alarm.threshold / scale) * 100}%` }} />
          </div>
          <p>
            {alarm.direction === "above"
              ? // "1 times the limit" reads oddly for a value only just over it (e.g. wind 12.4 vs 12)
                (alarm.times_threshold ?? alarm.value / alarm.threshold) < 1.1
                ? t("event.justAbove")
                : t("event.timesAbove", { x: number(alarm.times_threshold ?? alarm.value / alarm.threshold) })
              : t("event.timesBelow", { pct: number((alarm.value / alarm.threshold) * 100, 0) })}
          </p>
          {alarm.quality_flags.includes("flat_signal") && <p className="note">{t("event.flatNote")}</p>}
          {episode}
        </section>
      )}

      <section
        className={detection.detected ? "panel result is-yes" : "panel result is-no"}
        aria-labelledby="result-title"
      >
        <h2 id="result-title">{t("event.question")}</h2>
        <p className="result-line">
          <Icon name={detection.detected ? "check" : "cross"} size={28} className="result-icon" />
          <strong>
            {detection.detected
              ? t("event.yes", { names: names(detection.matched) })
              : t("event.no", { names: missing })}
          </strong>
        </p>
        {caughtBy.length > 0 && <p>{t("event.argusCaught", { names: names(caughtBy) })}</p>}
        {pickedHuman && <p>{t("event.human")}</p>}
        <p className="small">{t("event.counts")}</p>
        {alarm.instruments.some((i) => i.lat !== null) && <p className="small">{t("event.mapNote")}</p>}
      </section>

      {alarm.context && (
        <section className="panel" aria-labelledby="why-title">
          <h2 id="why-title">{t("event.why")}</h2>
          <p data-needs-review={alarm.context.needs_review}>{pick(alarm.context.why)}</p>
          {linked.length > 0 && (
            <>
              <h3>{t("event.linked")}</h3>
              <ul className="linked-list">
                {linked.map((s) => (
                  <li key={s.scenario_key}>
                    {pick(s.plain.title)}
                    {missionKeys.has(s.scenario_key) && <span className="tag">{t("event.inMission")}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {riskAfter.length > 0 && (
        <section className="panel risk-note" aria-labelledby="risk-title">
          <h2 id="risk-title">{t("event.riskTitle")}</h2>
          <p>{t("event.riskIntro", { watch: number((riskAfter[0].thresholds?.watch ?? 0.1) * 100, 0) })}</p>
          <ul className="linked-list">
            {riskAfter.map(({ scenario, period }) => (
              <li key={`${scenario.scenario_key}-${period.from}`}>
                {t("event.riskRaised", {
                  name: pick(scenario.plain.title),
                  state: t(`risk.${period.state}` as MessageKey),
                  date: date(period.from),
                  pct: number(period.probability * 100, 0),
                })}{" "}
                {period.until && t("event.riskBack", { date: date(period.until) })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <NextStep data={data} alarm={alarm} chosen={session.decision} onDecide={onDecide} />

      <p className="small">
        {t("event.dataNote", { from: month(alarmSpan[0]), to: month(alarmSpan[1]) })}{" "}
        {ai
          ? t("event.sourceAi", { ids: alarm.event_ids.join(", ") })
          : t("event.source", { rule: alarm.rule, ids: alarm.event_ids.join(", ") })}
      </p>
      {next}
    </div>
  );
}
