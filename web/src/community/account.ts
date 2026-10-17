// Saving a score under an account (README, "Leaderboard"). There is no account server: an account is
// the name and the six characters made from it and the password (community/nickname.ts), and it
// exists once a score has been saved under it. So the records the game can read decide: a name nobody
// has saved under yet makes a new account; a name with the same password signs in; a name someone has
// saved under with another password is taken.
import { cleanUsername, isUsername, nameKey, playerKey, userName, userNick } from "./nickname";
import type { PlayRecord } from "./store";

export type SignIn =
  /** the name is free: saving makes the account */
  | { kind: "new"; nick: string; name: string }
  /** the name and the password match an account: saving signs in */
  | { kind: "known"; nick: string; name: string }
  /** someone has saved under the name with another password */
  | { kind: "taken"; name: string }
  /** not a name the game allows */
  | { kind: "bad" };

export function signIn(records: PlayRecord[], name: string, password: string): SignIn {
  const clean = cleanUsername(name);
  if (!isUsername(clean)) return { kind: "bad" };
  const nick = userNick(clean, password);
  const key = nameKey(clean);
  const holders = new Set(
    records.flatMap((r) => {
      const held = r.nick ? userName(r.nick) : null;
      return held !== null && nameKey(held) === key ? [playerKey(r.nick!)] : [];
    }),
  );
  if (holders.size === 0) return { kind: "new", nick, name: clean };
  return holders.has(playerKey(nick)) ? { kind: "known", nick, name: clean } : { kind: "taken", name: clean };
}
