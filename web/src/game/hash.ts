// Small string hashes that give the same result in every browser and in Node, with no Web Crypto
// (which a page served by the class server over plain http on the school's network does not have).

/** cyrb53: a small, fast 53-bit string hash (public domain, by bryc). */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * `text` hashed `rounds` times over, as `length` base-36 characters. Slow on purpose (some tens of
 * milliseconds): what it is made from cannot be found again quickly by trying many guesses. Not
 * cryptography: enough for a game's player names, never for anything that must stay secret.
 */
export function stretchedHash(text: string, rounds = 100_000, length = 6): string {
  let h = cyrb53(text);
  for (let i = 1; i <= rounds; i++) h = cyrb53(`${h.toString(36)}\n${text}`, i);
  return (h % 36 ** length).toString(36).padStart(length, "0");
}
