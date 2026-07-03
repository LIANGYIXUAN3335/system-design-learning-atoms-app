/** Local calendar date as YYYY-MM-DD (day boundaries are the user's local midnight). */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return localDateStr(a) === localDateStr(b);
}

/** `from` + N local calendar days (DST-safe: Date normalizes the overflow). */
export function addLocalDays(from: Date, days: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
}

/** Whole local-calendar days from `from` to a YYYY-MM-DD date (negative = past). */
export function daysBetweenLocal(from: Date, targetDate: string): number {
  const [y, m, d] = targetDate.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}
