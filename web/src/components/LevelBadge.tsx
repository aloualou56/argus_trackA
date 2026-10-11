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

export function LevelBadge({ id, template = "level.badge" }: { id: LevelId; template?: MessageKey }) {
  const { t } = useI18n();
  return (
    <span className="level-badge">
      <LevelBars id={id} />
      {t(template, { level: t(levelKey(id)) })}
    </span>
  );
}
