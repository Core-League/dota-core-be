/**
 * Shared comment helpers used by sponsor matching, prize resolution, and prize
 * grouping. Kept in one place so all three normalize identically.
 */

/** Lowercase, trim, and collapse internal whitespace — the grouping/match key. */
export function normalizeComment(comment: string): string {
  return comment.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Extract the team name from a prize comment of the form `"Подарок <name>"`
 * (case-insensitive). Returns `null` when the comment is not a prize comment.
 */
export function parsePrizeName(
  comment: string | null | undefined,
): string | null {
  if (!comment) return null;
  const match = comment.trim().match(/^подарунок\s+.*?(\S+)$/i);
  return match ? match[1].trim() : null;
}

/** True when the comment looks like a prize payout. */
export function isPrizeComment(comment: string | null | undefined): boolean {
  return parsePrizeName(comment) !== null;
}
