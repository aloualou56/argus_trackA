import { useCallback, useEffect, useMemo, useState } from "react";
import { classLink, newClassCode } from "../community/classCode";
import { summarize, summarizeQuiz, type CommunityStore, type PlayRecord, type QuizRecord } from "../community/store";
import { Icon } from "../components/Icon";
import { cardById, humanCards, isPlayable } from "../game/logic";
import type { GameData } from "../game/types";
import { useI18n } from "../i18n";

interface Props {
  data: GameData;
  community: CommunityStore;
  classCode: string | null;
  setClassCode: (code: string | null) => void;
  onBack: () => void;
}

type Results = { plays: PlayRecord[]; quizzes: QuizRecord[] } | "loading" | "error";

/** Teacher page: create a class code, share it, and see the group's choices next to ARGUS. */
export function Teacher({ data, community, classCode, setClassCode, onBack }: Props) {
  const { t, pick, number } = useI18n();
  const cards = useMemo(() => cardById(data), [data]);
  const human = useMemo(() => humanCards(data), [data]);
  const [results, setResults] = useState<Results>("loading");
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    if (!classCode) return;
    setResults("loading");
    Promise.all([community.plays({ classCode }), community.quizzes({ classCode })])
      .then(([plays, quizzes]) => setResults({ plays, quizzes }))
      .catch(() => setResults("error"));
  }, [community, classCode]);
  useEffect(load, [load]);

  const link = classCode ? classLink(classCode, window.location) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setStatus(t("teacher.copied"));
    } catch {
      setStatus(t("teacher.copyFailed"));
    }
  };

  return (
    <div className="screen teacher">
      <h1 tabIndex={-1}>{t("teacher.title")}</h1>
      <p className="lead">{t("teacher.intro")}</p>

      {!classCode ? (
        <div className="actions">
          <button type="button" className="btn btn-primary btn-big" onClick={() => setClassCode(newClassCode())}>
            {t("teacher.create")}
          </button>
        </div>
      ) : (
        <>
          <section className="panel" aria-labelledby="code-title">
            <h2 id="code-title">{t("teacher.codeTitle")}</h2>
            <p className="class-code">
              <span aria-hidden="true">{classCode}</span>
              {/* Spelled out, so screen readers read the letters one by one. */}
              <span className="sr-only">{classCode.split("").join(" ")}</span>
            </p>
            <p>{t("teacher.share")}</p>
            <p className="class-link">
              <a href={link}>{link}</a>
            </p>
            <div className="actions actions-split">
              <button type="button" className="btn btn-secondary" onClick={copy}>
                {t("teacher.copy")}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setClassCode(newClassCode())}>
                {t("teacher.newCode")}
              </button>
            </div>
            <p className="small" role="status">
              {status}
            </p>
          </section>

          <section aria-labelledby="results-title">
            <h2 id="results-title">{t("teacher.results")}</h2>
            <p className="small">{t(community.kind === "shared" ? "teacher.sharedNote" : "teacher.localNote")}</p>
            <button type="button" className="btn btn-quiet" onClick={load}>
              {t("teacher.refresh")}
            </button>
            {results === "loading" && <p>{t("app.loading")}</p>}
            {results === "error" && <p role="alert">{t("teacher.error")}</p>}
            {typeof results === "object" && results.plays.length === 0 && <p>{t("teacher.empty")}</p>}
            {typeof results === "object" && results.plays.length > 0 && (
              <>
                <p>{t("teacher.games", { n: results.plays.length })}</p>
                <QuizLine quizzes={results.quizzes} total={data.quiz.questions.length} />
                {data.monuments.filter(isPlayable).map((mon) => {
                  const plays = results.plays.filter((p) => p.monument === mon.pilot_key);
                  if (!plays.length) return null;
                  const summary = summarize(plays);
                  const argus = new Map(mon.installed.by_card.map((r) => [r.card, r.count]));
                  const rows = data.cards.cards.filter((c) => summary.cardShare[c.id] || argus.get(c.id));
                  return (
                    // Focusable region: on a phone the table can scroll sideways, so keyboards must reach it.
                    <div
                      key={mon.pilot_key}
                      className="table-wrap"
                      role="region"
                      tabIndex={0}
                      aria-labelledby={`caption-${mon.pilot_key}`}
                    >
                      <table className="mix">
                        <caption id={`caption-${mon.pilot_key}`}>
                          {t("teacher.tableCaption", { name: pick(mon.display_name), n: plays.length })}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{t("reveal.colSensor")}</th>
                            <th scope="col" className="num">
                              {t("teacher.colClass")}
                            </th>
                            <th scope="col" className="num">
                              {t("reveal.colArgus")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((c) => (
                            <tr key={c.id}>
                              <th scope="row">
                                <span className="row-label">
                                  <Icon name={c.id} size={22} />
                                  {pick(cards.get(c.id)?.name)}
                                </span>
                              </th>
                              <td className="num">{number((summary.cardShare[c.id] ?? 0) * 100, 0)}%</td>
                              <td className="num">{human.has(c.id) ? "–" : (argus.get(c.id) ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </>
            )}
          </section>
        </>
      )}

      <div className="actions">
        <button type="button" className="btn btn-secondary btn-big" onClick={onBack}>
          {t("teacher.back")}
        </button>
      </div>
    </div>
  );
}

function QuizLine({ quizzes, total }: { quizzes: QuizRecord[]; total: number }) {
  const { t, number } = useI18n();
  const q = summarizeQuiz(quizzes);
  if (!q.withPre) return null;
  return (
    <p>
      <strong>{t("teacher.quiz", { n: q.withPre, pre: number(q.averagePre), post: number(q.averagePost), total })}</strong>
    </p>
  );
}
