// The name a player has on the leaderboard: an animal and a number ("owl-27", shown as "🦉 Owl 27"
// in the player's language). Chosen from a fixed list, never typed: a child can never put their real
// name, or anyone else's, on a board others see. Kept on this device only; a new one for a new player.

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

/** Whether `value` is a guardian name of the list ("owl-27"). */
export function isNick(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = PATTERN.exec(value);
  return !!m && m[1] in ANIMALS;
}

/** A new guardian name, e.g. "fox-58" (numbers 10 to 99). */
export function newNick(random: () => number = Math.random): string {
  const ids = Object.keys(ANIMALS);
  const animal = ids[Math.floor(random() * ids.length) % ids.length];
  return `${animal}-${10 + (Math.floor(random() * 90) % 90)}`;
}

/** The animal and the number of a guardian name. */
export function nickParts(nick: string): { animal: string; number: string; emoji: string } {
  const [animal, number] = nick.split("-");
  return { animal, number, emoji: ANIMALS[animal] ?? "" };
}

/** This device's guardian name, made the first time it is asked for. */
export function loadNick(storage: Storage | null = safeStorage()): string {
  try {
    const saved = storage?.getItem(KEY);
    if (isNick(saved)) return saved;
  } catch {
    // storage blocked: a name for this visit
  }
  return saveNick(newNick(), storage);
}

export function saveNick(nick: string, storage: Storage | null = safeStorage()): string {
  try {
    storage?.setItem(KEY, nick);
  } catch {
    // privacy mode: kept for this visit only
  }
  return nick;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
