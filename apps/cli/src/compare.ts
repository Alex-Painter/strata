/**
 * Where two reports differ, for scripts/stack-vs-range.ts. It names places,
 * never values, so its output says nothing about the code.
 */
import { stableStringify } from "@strata/core";

/**
 * Paths like `change.files[2].layer.by` where two JSON values differ, the
 * first `limit` of them in key order. Arrays of different lengths are one
 * difference, then compared item by item as far as both go.
 */
export function differences(a: unknown, b: unknown, limit = Infinity): string[] {
  const out: string[] = [];
  walk(a, b, "", out, limit);
  return out;
}

function walk(a: unknown, b: unknown, at: string, out: string[], limit: number): void {
  if (out.length >= limit || stableStringify(a) === stableStringify(b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at}: ${a.length} items and ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      walk(a[i], b[i], `${at}[${i}]`, out, limit);
    return;
  }
  if (isRecord(a) && isRecord(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      walk(a[key], b[key], at ? `${at}.${key}` : key, out, limit);
    }
    return;
  }
  out.push(at || "the whole value");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
