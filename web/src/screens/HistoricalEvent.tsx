import { useMemo } from "react";
import type { ScreenProps } from "../App";
import { Icon } from "../components/Icon";
import { argusCards, cardById, detects, featuredAlarm, missionScenarios, ruleFor } from "../game/logic";
import { useI18n } from "../i18n";

export function HistoricalEvent({ data, mon, session, go }: ScreenProps) {
  const { t, pick, number, date, list } = useI18n();
  const cards = useMemo(() => cardById(data), [data]);
  const alarm = featuredAlarm(mon, session.level);
  const rule = alarm && ruleFor(data, mon, alarm);

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
        <h1 tabIndex={-1}>{t("event.heading")}</h1>
        <p className="lead">{t("event.none")}</p>
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
  const scale = Math.max(alarm.value, alarm.threshold) * 1.15;
  const missionKeys = new Set(missionScenarios(mon, session.level).map((s) => s.scenario_key));
  const linked = (alarm.context?.links ?? [])
    .map((key) => mon.scenarios.find((s) => s.scenario_key === key))
    .filter((s): s is NonNullable<typeof s> => !!s);

  return (
    <div className="screen event">
      <h1 tabIndex={-1}>{t("event.heading")}</h1>
      <p className="lead">{t("event.what", { date: date(alarm.timestamp), measures: pick(rule.measures) })}</p>

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
            ? t("event.timesAbove", { x: number(alarm.times_threshold ?? alarm.value / alarm.threshold) })
            : t("event.timesBelow", { pct: number((alarm.value / alarm.threshold) * 100, 0) })}
        </p>
        {alarm.quality_flags.includes("flat_signal") && <p className="note">{t("event.flatNote")}</p>}
      </section>

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

      <p className="small">
        {t("event.dataNote")} {t("event.source", { rule: alarm.rule, ids: alarm.event_ids.join(", ") })}
      </p>
      {next}
    </div>
  );
}
