/**
 * Excel / 数值小工具
 */
/** Normalize cell text (trim spaces, uppercase) */
export function normalizeText(value: unknown): string {
  const s = String(value ?? '')
  return s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

/** Parse numeric value, tolerating comma separators */
export function parseNumeric(value: unknown): number {
  if (value === null || value === undefined) return 0
  const s = String(value).trim()
  const n = parseFloat(s.replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}
