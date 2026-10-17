// How a player is named on the leaderboard: the name of their account, or for a record of an older
// version of the game its guardian name ("Owl 27": an animal of a fixed list and a number), in the
// player's language (community/nickname.ts).
import { nickParts, userName } from "../community/nickname";
import { useI18n, type MessageKey } from "../i18n";

/** "Maria", or "Owl 27" in the player's language. */
export function useNickLabel(): (nick: string) => string {
  const { t } = useI18n();
  return (nick) => {
    const own = userName(nick);
    if (own !== null) return own;
    const { animal, number } = nickParts(nick);
    return `${t(`nick.${animal}` as MessageKey)} ${number}`;
  };
}
