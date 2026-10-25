/**
 * Stable, content-derived identifiers.
 *
 * Ids are derived from what a thing *is* (file path and hunk text), never from
 * where it came from (PR number, commit, position in a list). That is what lets
 * the same feature split two ways produce the same ids, and lets an anchor made
 * on one analysis run still resolve on the next.
 *
 * The hash is a 64-bit non-cryptographic hash (two independent 32-bit lanes of
 * MurmurHash3's mixer). It runs synchronously in Node and the browser, which
 * Web Crypto's async digest does not. Collisions only need to be unlikely
 * within one Change, not adversarially hard.
 */
export function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** A short prefixed id, e.g. `hunk_1a2b3c4d5e6f7a8b`. */
export function stableId(prefix: string, ...parts: string[]): string {
  // The separator cannot appear in paths or diff text, so ["a", "bc"] and
  // ["ab", "c"] never hash to the same input.
  return `${prefix}_${stableHash(parts.join("\u0000"))}`;
}
