import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenProps } from "../App";
import { topCard, type CommunityStore, type Summary } from "../community/store";
import { Icon } from "../components/Icon";
import { cardById, detects, featuredAlarm, missionScenarios, ruleFor, score } from "../game/logic";
import { useI18n, type MessageKey } from "../i18n";

interface Props extends ScreenProps {
  community: CommunityStore;
  onReplay: () => void;
}

export function Score({ data, mon, session, go, community, onReplay }: Props) {
  const { t, tn, pick, list, number } = useI18n();
  const cards = useMemo(() => cardById(data), [data]);
  const threats = missionScenarios(mon, session.level);
  const alarm = featuredAlarm(mon, session.level);
  const rule = alarm && ruleFor(data, mon, alarm);
  const result = score(threats, rule, session.picks, cards);
  const detected = rule ? detects(rule, session.picks).detected : false;
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
  const top = summary && topCard(summary);
  const argusCount = (card: string) => mon.installed.by_card.find((r) => r.card === card)?.count ?? 0;

  return (
    <div className="screen score">
      <h1 tabIndex={-1}>{t("score.heading")}</h1>
      <div className="panel score-card">
        <p className="score-big">{t("score.points", { score: result.total })}</p>
        <p className="verdict">{t(`score.verdict.${result.verdict}` as MessageKey)}</p>
        <ul className="breakdown">
          <li>
            <span>{t("score.threats", { covered: result.covered, total: threats.length })}</span>
            <strong>{tn("unit.points", result.coveragePoints)}</strong>
          </li>
          <li>
            <span>{t("score.efficiency", { useful: result.usefulCoins, spent: result.spentCoins })}</span>
            <strong>{tn("unit.points", result.efficiencyPoints)}</strong>
          </li>
        </ul>
      </div>

      <section aria-labelledby="learn-title">
        <h2 id="learn-title">{t("score.learn")}</h2>
        <ul className="learn-list">
          {result.coverage.map(({ scenario: s, covered, by }) => (
            <li key={s.scenario_key} className={covered ? "learn is-yes" : "learn is-no"}>
              <p className="status-tag">
                <Icon name={covered ? "check" : "cross"} size={20} />
                {covered ? t("score.covered") : t("score.notCovered")}
              </p>
              <h3 data-needs-review={s.plain.needs_review}>{pick(s.plain.title)}</h3>
              <p data-needs-review={s.plain.needs_review}>{pick(s.plain.text)}</p>
              {s.capable_cards.length === 0 ? (
                <p>{t("score.noSensor")}</p>
              ) : (
                <>
                  {covered && <p>{t("score.coveredBy", { names: names(by) })}</p>}
                  {!covered && (
                    <p data-needs-review={s.capable_cards_needs_review}>
                      {t("score.canHelp", { names: names(s.capable_cards) })}
                    </p>
                  )}
                  {covered && s.capable_cards.length > by.length && (
                    <p data-needs-review={s.capable_cards_needs_review}>
                      {t("score.alsoHelp", { names: names(s.capable_cards.filter((c) => !by.includes(c))) })}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
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

      <div className="actions actions-split">
        <button type="button" className="btn btn-primary btn-big" onClick={onReplay}>
          {t("score.playAgain")}
        </button>
        <button type="button" className="btn btn-secondary btn-big" onClick={() => go("home")}>
          {t("score.otherLevel")}
        </button>
      </div>
    </div>
  );
}
