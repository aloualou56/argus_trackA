import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { countRight, markQuiz } from "../game/logic";
import type { QuizQuestion } from "../game/types";
import { useI18n } from "../i18n";

interface Props {
  questions: QuizQuestion[];
  /** "pre": before the game, no feedback. "post": after it, with answers and the before/after comparison. */
  phase: "pre" | "post";
  /** Marks from the quiz before the game, if the player did it (post only). */
  before?: boolean[] | null;
  /** Called with right/wrong per question once the player is done; may return a sentence about the group. */
  onDone: (marks: boolean[]) => Promise<string | null> | void;
  /** Where answers are kept (post only). */
  savedNote?: string;
  onSkip?: () => void;
  announce: (message: string) => void;
  /** Buttons shown under the post-quiz results. */
  after?: ReactNode;
}

export function Quiz({ questions, phase, before, onDone, onSkip, announce, after, savedNote }: Props) {
  const { t, pick } = useI18n();
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [marks, setMarks] = useState<boolean[] | null>(null);
  const [groupNote, setGroupNote] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const resultsRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (marks) resultsRef.current?.focus();
  }, [marks]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = answers.findIndex((a) => a === null);
    if (missing >= 0) {
      const message = t("quiz.needAll", { n: missing + 1 });
      setHint(message);
      announce(message);
      document.getElementById(`q-${questions[missing].id}-0`)?.focus();
      return;
    }
    const result = markQuiz(questions, answers);
    const done = onDone(result);
    if (phase === "post") {
      setMarks(result);
      setGroupNote((await done) ?? null);
    }
  };

  if (marks) {
    const total = questions.length;
    return (
      <div className="screen quiz">
        <h1 tabIndex={-1} ref={resultsRef}>
          {t("quiz.resultTitle")}
        </h1>
        <p className="lead">
          {before
            ? t("quiz.compare", { pre: countRight(before), post: countRight(marks), total })
            : t("quiz.only", { post: countRight(marks), total })}
        </p>
        <ol className="learn-list quiz-results">
          {questions.map((q, i) => (
            <li key={q.id} className={marks[i] ? "learn is-yes" : "learn is-no"}>
              <p className="status-tag">
                <Icon name={marks[i] ? "check" : "cross"} size={20} />
                {t(marks[i] ? "quiz.right" : "quiz.wrong")}
              </p>
              <h2 className="quiz-q">{pick(q.question)}</h2>
              {!marks[i] && <p>{t("quiz.correctIs", { answer: pick(q.options[q.correct]) })}</p>}
              <p>{pick(q.explain)}</p>
            </li>
          ))}
        </ol>
        {groupNote && <p className="note">{groupNote}</p>}
        {savedNote && <p className="small">{savedNote}</p>}
        {after}
      </div>
    );
  }

  return (
    <form className="screen quiz" onSubmit={submit} noValidate>
      <h1 tabIndex={-1}>{t(phase === "pre" ? "quiz.preTitle" : "quiz.postTitle")}</h1>
      <p className="lead">{t(phase === "pre" ? "quiz.preIntro" : "quiz.postIntro")}</p>
      {questions.map((q, i) => (
        <fieldset key={q.id} className="choices choices-letters quiz-question">
          <legend>
            <span className="quiz-number">{t("quiz.number", { n: i + 1, total: questions.length })}</span>
            <span className="quiz-q">{pick(q.question)}</span>
          </legend>
          {q.options.map((option, j) => (
            <label key={j} className="choice">
              <input
                type="radio"
                id={`q-${q.id}-${j}`}
                name={`q-${q.id}`}
                checked={answers[i] === j}
                onChange={() => {
                  setAnswers((prev) => prev.map((a, k) => (k === i ? j : a)));
                  setHint("");
                }}
              />
              <span className="choice-body">
                <span className="choice-title">{pick(option)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {hint && <p className="budget-hint">{hint}</p>}
      <div className={onSkip ? "actions actions-split" : "actions"}>
        <button type="submit" className="btn btn-primary btn-big">
          {t("quiz.submit")}
          <Icon name="arrow" />
        </button>
        {onSkip && (
          <button type="button" className="btn btn-secondary btn-big" onClick={onSkip}>
            {t("quiz.skip")}
          </button>
        )}
      </div>
    </form>
  );
}
