import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenProps } from "../App";
import { topCard, type CommunityStore, type Summary } from "../community/store";
import { Icon } from "../components/Icon";
import { cardById, featuredAlarm, humanCards, missionScenarios, ruleFor, score, type CoverLevel } from "../game/logic";
import { useI18n, type MessageKey } from "../i18n";

interface Props extends ScreenProps {
  community: CommunityStore;
  onReplay: () => void;
  onQuiz: () => void;
}

const STATUS: Record<CoverLevel | "unscored", { cls: string; icon: string; key: MessageKey }> = {
  full: { cls: "learn is-yes", icon: "check", key: "score.covered" },
  partial: { cls: "learn is-partial", icon: "half", key: "score.partial" },
  none: { cls: "learn is-no", icon: "cross", key: "score.notCovered" },
  // No card can warn about it (e.g. lost skills): taught, never scored, so no "not covered" mark.
  unscored: { cls: "learn is-info", icon: "talk", key: "score.noSensorTag" },
};

export function Score({ data, mon, session, go, community, onReplay, onQuiz }: Props) {
  const { t, pick, list, number } = useI18n();
  const cards = useMemo(() => cardById(data), [data]);
  const threats = missionScenarios(mon, session.level);
  const alarm = featuredAlarm(mon, session.level);
  const rule = alarm && ruleFor(data, mon, alarm);
  const result = score(threats, rule, session.picks, cards);
  const detected = result.alarm?.detected ?? false;
  const [summary, setSummary] = useState<Summary | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    community
      .submit({
        v: 1,
        monument: mon.pilot_key,
        level: session.level,
        picks: session.picks,
        score: result.total,
        detected,
        day: new Date().toISOString().slice(0, 10),
      })
      .then(() => community.summary(mon.pilot_key, session.level))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [community, mon.pilot_key, session, result.total, detected]);

  const names = (ids: string[]) => list(ids.map((id) => pick(cards.get(id)?.name)));
  const top = summary && topCard(summary, humanCards(data));
  const argusCount = (card: string) => mon.installed.by_card.find((r) => r.card === card)?.count ?? 0;

  return (
    <div className="screen score">
      <h1 tabIndex={-1}>{t("score.heading")}</h1>
      <div className="panel score-card">
        <p className="score-big">{t("score.points", { score: result.total })}</p>
        <p className="verdict">{t(`score.verdict.${result.verdict}` as MessageKey)}</p>
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
                <p data-needs-review={s.plain.needs_review}>{pick(s.plain.text)}</p>
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

      <section className="panel community" aria-labelledby="community-title">
        <h2 id="community-title">{t("score.community")}</h2>
        {summary && summary.games > 1 && top ? (
          <>
            <p>{t("score.communityCount", { n: summary.games })}</p>
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
        <p className="small">{t("score.communityLocal")}</p>
      </section>

      <section className="panel quiz-invite" aria-labelledby="quiz-invite-title">
        <h2 id="quiz-invite-title">{t("quiz.inviteTitle")}</h2>
        <p>{t("quiz.inviteText")}</p>
        <button type="button" className="btn btn-primary btn-big" onClick={onQuiz}>
          {t("quiz.open")}
          <Icon name="arrow" />
        </button>
      </section>

      <div className="actions actions-split">
        <button type="button" className="btn btn-secondary btn-big" onClick={onReplay}>
          {t("score.playAgain")}
        </button>
        <button type="button" className="btn btn-secondary btn-big" onClick={() => go("home")}>
          {t("score.otherLevel")}
        </button>
      </div>
    </div>
  );
}
