/** Market outcome is separate from position direction and the active design palette. */
export type MarketTone = 'positive' | 'negative' | 'neutral' | 'pending';
export function pnlTone(value: number | string | null | undefined, isOpen = false): MarketTone {
  if (isOpen) return 'pending';
  if (value === null || value === undefined || value === '') return 'neutral';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'neutral';
  return amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'neutral';
}
/** Adds + only to genuine gains, preserves the formatter's currency/number conventions. */
export function signedMoney(value: number, formatted: string): string {
  return Number.isFinite(value) && value > 0 ? '+' + formatted : formatted;
}
