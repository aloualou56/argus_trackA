// The name a player has on the leaderboard: an account, a name the player chose and a password
// ("u:Maria#k3j9a2"), made when they first save a score (community/account.ts). The name is what the
// board shows; the six characters after "#" are made from the name and the password, and are all that
// is ever kept of the password (it may be anything, even empty). Records of older versions of the game
// have a guardian name instead, an animal and a number ("owl-27", shown as "Owl 27"); they stay on the
// board as they are.
import { stretchedHash } from "../game/hash";

/** The animals a guardian can be named after, with their picture signs (names: i18n "nick.<id>"). */
export const ANIMALS: Record<string, string> = {
  owl: "🦉",
  dolphin: "🐬",
  falcon: "🦅",
  fox: "🦊",
  turtle: "🐢",
  deer: "🦌",
  hedgehog: "🦔",
  otter: "🦦",
  seal: "🦭",
  wolf: "🐺",
  bee: "🐝",
  swan: "🦢",
  squirrel: "🐿️",
  lizard: "🦎",
  bear: "🐻",
  lion: "🦁",
  whale: "🐋",
  octopus: "🐙",
  parrot: "🦜",
  butterfly: "🦋",
  rabbit: "🐇",
  horse: "🐎",
  goat: "🐐",
  penguin: "🐧",
};

const PATTERN = /^([a-z]{2,12})-([1-9][0-9])$/;
const KEY = "guardian.nick.v1";

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 20;
// Letters of any alphabet, digits, and space . _ - inside; starting with a letter or a digit. The same
// rule as tools/class_server.py (USER) and supabase/schema.sql.
const USERNAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._-]{1,19}$/u;
const USER = /^u:(.+)#([0-9a-z]{6})$/u;

/** A typed name as it is kept: the same letters composed one way, no spaces at the ends or in runs. */
export function cleanUsername(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function isUsername(name: string): boolean {
  return USERNAME.test(name) && [...name].length <= USERNAME_MAX;
}

/** Who a name is, whatever capitals and accents were typed ("ΜΑΡΙΑ", "Μαρία", "μαρια": one player).
 *  Not the device's own rules for capitals, so it is the same on every device. */
export function nameKey(name: string): string {
  return cleanUsername(name).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The player's own name and password as a leaderboard name. Throws if the name is not allowed. */
export function userNick(name: string, password: string): string {
  const clean = cleanUsername(name);
  if (!isUsername(clean)) throw new Error("not a player name");
  return `u:${clean}#${stretchedHash(`prototype3\n${nameKey(clean)}\n${password}`)}`;
}

/** The name a player chose ("Maria"), or null for a guardian name of the list. */
export function userName(nick: string): string | null {
  const m = USER.exec(nick);
  return m && isUsername(m[1]) ? m[1] : null;
}

/** Who a leaderboard name is: an account's name in any capitals and accents is one player. */
export function playerKey(nick: string): string {
  const name = userName(nick);
  return name === null ? nick : `u:${nameKey(name)}#${nick.slice(-6)}`;
}

/** Whether `value` is a leaderboard name: a guardian name of the list ("owl-27") or one the player chose. */
export function isNick(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (userName(value) !== null) return true;
  const m = PATTERN.exec(value);
  return !!m && m[1] in ANIMALS;
}

/** The animal and the number of a guardian name. */
export function nickParts(nick: string): { animal: string; number: string; emoji: string } {
  const [animal, number] = nick.split("-");
  return { animal, number, emoji: ANIMALS[animal] ?? "" };
}

/** The account last signed in to on this device ("u:Maria#k3j9a2"), or null. A guardian name an older
 *  version of the game gave this device is not an account. */
export function loadAccount(storage: Storage | null = safeStorage()): string | null {
  try {
    const saved = storage?.getItem(KEY);
    return saved && userName(saved) !== null ? saved : null;
  } catch {
    return null; // storage blocked
  }
}

/** Remembers the account on this device (null: forgets it, for the next player). */
export function saveAccount(nick: string | null, storage: Storage | null = safeStorage()): void {
  try {
    if (nick) storage?.setItem(KEY, nick);
    else storage?.removeItem(KEY);
  } catch {
    // privacy mode: remembered for this visit only, by the screen that holds it
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
