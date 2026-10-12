import { useI18n, type MessageKey } from "../i18n";

export const STEPS = ["story", "mission", "event", "reveal", "score"] as const;
export type Step = (typeof STEPS)[number];

export const stepKey = (step: Step) => `steps.${step}` as MessageKey;

/** "Step 2 of 5: Mission" in text, plus a decorative bar. */
export function Progress({ current }: { current: Step }) {
  const { t } = useI18n();
  const index = STEPS.indexOf(current);
  return (
    <div className="progress">
      <p className="progress-text">
        {t("steps.current", { n: index + 1, total: STEPS.length })}: <strong>{t(stepKey(current))}</strong>
      </p>
      <ol className="progress-bar" aria-hidden="true">
        {STEPS.map((step, i) => (
          <li key={step} className={i < index ? "done" : i === index ? "now" : ""} />
        ))}
      </ol>
    </div>
  );
}
