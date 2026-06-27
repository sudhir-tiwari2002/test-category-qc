/**
 * Text normalization + structured comparison used by all "match" QC checks.
 * Preview and source views often differ in whitespace, &nbsp;, MathJax wrappers,
 * smart-quote substitution and image rendering — normalize away the noise but
 * keep meaningful differences.
 */

const SOFT_WHITESPACE = /[\u00A0\u2007\u202F\u2028\u2029\t]+/g;
const SMART_QUOTES: Array<[RegExp, string]> = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2013\u2014]/g, "-"],
  [/\u2026/g, "..."],
];

export function normalize(text: string | null | undefined): string {
  if (!text) return "";
  let t = text;
  t = t.replace(/<[^>]*>/g, " "); // strip HTML tags
  t = t.replace(SOFT_WHITESPACE, " ");
  for (const [re, rep] of SMART_QUOTES) t = t.replace(re, rep);
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export function eq(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalize(a) === normalize(b);
}

export interface ListDiff<T> {
  matched: boolean;
  lengthMismatch: boolean;
  mismatches: Array<{ index: number; source?: T; preview?: T }>;
}

export function compareLists<T>(
  source: T[],
  preview: T[],
  equals: (a: T, b: T) => boolean,
): ListDiff<T> {
  const mismatches: ListDiff<T>["mismatches"] = [];
  const max = Math.max(source.length, preview.length);
  for (let i = 0; i < max; i++) {
    const s = source[i];
    const p = preview[i];
    if (s === undefined || p === undefined || !equals(s, p)) {
      mismatches.push({ index: i, source: s, preview: p });
    }
  }
  return {
    matched: mismatches.length === 0,
    lengthMismatch: source.length !== preview.length,
    mismatches,
  };
}

/** Returns the symmetric difference between two arrays of primitives. */
export function symDiff<T>(a: T[], b: T[]): { onlyA: T[]; onlyB: T[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyA: a.filter((x) => !sb.has(x)),
    onlyB: b.filter((x) => !sa.has(x)),
  };
}
