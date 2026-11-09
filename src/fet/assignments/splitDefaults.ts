/**
 * Default weekly split patterns for Italian school workloads (hours → duration list).
 * Prefer spreading across days (many duration-1 or duration-2 blocks) rather than one long block.
 */

export function defaultSplitForHours(hours: number): number[] {
  if (!Number.isFinite(hours) || hours <= 0) return [];
  const n = Math.round(hours);
  if (n !== hours) {
    // Non-integer hours: keep a single block (caller should prefer explicit split).
    return [hours];
  }
  switch (n) {
    case 1:
      return [1];
    case 2:
      return [1, 1];
    case 3:
      return [1, 1, 1];
    case 4:
      return [2, 1, 1];
    case 5:
      return [2, 2, 1];
    case 6:
      return [2, 2, 2];
    case 7:
      return [2, 2, 2, 1];
    case 8:
      return [2, 2, 2, 2];
    case 9:
      return [2, 2, 2, 2, 1];
    case 10:
      return [2, 2, 2, 2, 2];
    default: {
      // Fall back: as many 2s as possible, then 1s.
      const parts: number[] = [];
      let left = n;
      while (left >= 2) {
        parts.push(2);
        left -= 2;
      }
      if (left === 1) parts.push(1);
      return parts;
    }
  }
}

/** Parse patterns like "2+2+1", "2 + 1 + 1", "2x2+1" (x treated as +). */
export function parseSplitPattern(raw: string): number[] | null {
  const cleaned = raw
    .trim()
    .replace(/[×xX]/g, "+")
    .replace(/\s+/g, "");
  if (!/^\d+(?:\+\d+)+$/.test(cleaned) && !/^\d+$/.test(cleaned)) return null;
  const parts = cleaned.split("+").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p <= 0)) return null;
  return parts;
}

export function splitSum(split: number[]): number {
  return split.reduce((a, b) => a + b, 0);
}
