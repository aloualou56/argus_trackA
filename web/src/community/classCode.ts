// Class codes: a teacher creates one, players join with it, and every record carries it so the
// teacher can see the group's choices. Six characters from an alphabet without look-alikes (0/O, 1/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CLASS_CODE_LENGTH = 6;
const STORAGE_KEY = "guardian.class";
const PATTERN = new RegExp(`^[${ALPHABET}]{${CLASS_CODE_LENGTH}}$`);

/** A new random code. 256 is a multiple of the alphabet size (32), so every letter is equally likely. */
export function newClassCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(CLASS_CODE_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** What a person typed ("abc 234", "ABC-234") as a code, or null if it cannot be one. */
export function normalizeClassCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return PATTERN.test(code) ? code : null;
}

/** ?class=ABC234 in a link the teacher shared. */
export function classCodeFromUrl(search: string): string | null {
  const value = new URLSearchParams(search).get("class");
  return value ? normalizeClassCode(value) : null;
}

export function classLink(code: string, location: Pick<Location, "origin" | "pathname">): string {
  return `${location.origin}${location.pathname}?class=${code}`;
}

/** Remembered on this device only, as a convenience; the game works the same without storage. */
export function loadClassCode(): string | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeClassCode(saved) : null;
  } catch {
    return null;
  }
}

export function saveClassCode(code: string | null): void {
  try {
    if (code) window.localStorage.setItem(STORAGE_KEY, code);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the code lasts for this visit only
  }
}
