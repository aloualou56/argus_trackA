import { useI18n } from "../i18n";
import { Icon } from "./Icon";

/**
 * A week on duty at a glance: one box per day. Caught and missed differ by icon and border as well
 * as colour; each box is spelled out for screen readers.
 */
export function DayStrip({ results, total }: { results: boolean[]; total: number }) {
  const { t } = useI18n();
  return (
    <ol className="day-strip" aria-label={t("week.title")}>
      {Array.from({ length: total }, (_, i) => {
        const done = i < results.length;
        const state = !done ? "ahead" : results[i] ? "caught" : "missed";
        const key = state === "caught" ? "week.stripCaught" : state === "missed" ? "week.stripMissed" : "week.stripAhead";
        return (
          <li key={i} className={`day-box is-${state}${i === results.length - 1 ? " is-today" : ""}`}>
            <span aria-hidden="true">{done ? <Icon name={results[i] ? "check" : "cross"} size={18} /> : i + 1}</span>
            <span className="sr-only">{t(key, { n: i + 1 })}</span>
          </li>
        );
      })}
    </ol>
  );
}
