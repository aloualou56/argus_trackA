import type { LevelId } from "../game/types";
import { useI18n, type MessageKey } from "../i18n";

export const LEVEL_IDS: LevelId[] = ["low", "medium", "high", "extreme", "catastrophic"];
export const levelKey = (id: LevelId) => `level.${id}` as MessageKey;

/** Danger level as words plus a 5-step bar, so meaning never depends on colour. */
export function LevelBars({ id }: { id: LevelId }) {
  const filled = LEVEL_IDS.indexOf(id) + 1;
  return (
    <span className="level-bars" aria-hidden="true">
      {LEVEL_IDS.map((l, i) => (
        <span key={l} className={i < filled ? "on" : ""} />
      ))}
    </span>
  );
}

/**
 * A rating on the five-step scale: what is rated (a small label), then the scale and the level in
 * words. `template` is a sentence such as "Experts' rating: {level}"; the part before the level
 * becomes the label, so every language keeps its own wording.
 */
export function LevelBadge({ id, template = "level.badge" }: { id: LevelId; template?: MessageKey }) {
  const { t } = useI18n();
  const level = t(levelKey(id));
  const mark = "\u0000";
  const [before, after = ""] = t(template, { level: mark }).split(mark);
  const label = before.replace(/[\s:]+$/, "");
  return (
    <span className="level-badge">
      {label && <span className="level-label">{label}</span>}
      <span className="level-value">
        <LevelBars id={id} />
        {level}
        {after}
      </span>
    </span>
  );
}
