// The player's guardian name on the leaderboard ("🦉 Owl 27"): an animal of a fixed list and a number,
// so a child never puts a real name where others see it. "New player" gives another one (for the next
// child on the same device, or for a name they do not like).
import { useState } from "react";
import { loadNick, newNick, nickParts, saveNick } from "../community/nickname";
import { useI18n, type MessageKey } from "../i18n";

/** "🦉 Owl 27", in the player's language. */
export function useNickLabel(): (nick: string) => string {
  const { t } = useI18n();
  return (nick) => {
    const { animal, number, emoji } = nickParts(nick);
    return `${emoji} ${t(`nick.${animal}` as MessageKey)} ${number}`;
  };
}

export function GuardianName() {
  const { t } = useI18n();
  const label = useNickLabel();
  const [nick, setNick] = useState(loadNick);
  return (
    <section className="panel guardian-name" aria-labelledby="guardian-name-title">
      <h2 id="guardian-name-title">{t("board.nameLine", { name: label(nick) })}</h2>
      <p className="small">{t("board.nameHelp")}</p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          let next = newNick();
          while (next === nick) next = newNick();
          setNick(saveNick(next));
        }}
      >
        {t("board.newName")}
      </button>
    </section>
  );
}
