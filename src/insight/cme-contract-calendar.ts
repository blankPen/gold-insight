/**
 * CME COMEX Gold Options (OG)：近月合约最后交易日 = 期权**合约月份**的**前一个自然月**的 **26 日**
 *（与挂牌一致，例如 MAR 26 → 2/26，APR 26 → 3/26，MAY 26 → 4/26）。
 */

const MONTH_MAP: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
}

/** America/Chicago calendar date YYYY-MM-DD */
export function formatChicagoYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function parseContractKey(key: string): { year: number; monthIndex: number } | null {
  const m = key.trim().match(/^([A-Z]{3})\s+(\d{2})$/i)
  if (!m) return null
  const mon = m[1]!.toUpperCase()
  const yy = parseInt(m[2]!, 10)
  const monthIndex = MONTH_MAP[mon]
  if (monthIndex === undefined || !Number.isFinite(yy)) return null
  const year = 2000 + yy
  return { year, monthIndex }
}

/**
 * 最后交易日 YYYY-MM-DD（与芝加哥日历比较 asOf 时用字符串即可）。
 */
export function goldOptionLastTradingDayYmd(contractKey: string): string | null {
  const parsed = parseContractKey(contractKey)
  if (!parsed) return null
  const { year, monthIndex } = parsed
  let ltdYear = year
  let ltdMonth0 = monthIndex - 1
  if (ltdMonth0 < 0) {
    ltdMonth0 = 11
    ltdYear -= 1
  }
  const mm = String(ltdMonth0 + 1).padStart(2, '0')
  return `${ltdYear}-${mm}-26`
}

export interface PrimaryContractPick {
  primary: string | null
  primary_ltd: string | null
  warning?: string
}

/**
 * Contracts still trade on their LTD (asOf <= ltd). Day after LTD, roll to next listed month.
 */
export function selectPrimaryGoldOptionContract(
  discoveredSorted: string[],
  asOfChicagoYmd: string,
): PrimaryContractPick {
  if (discoveredSorted.length === 0) {
    return { primary: null, primary_ltd: null, warning: 'no_contracts_discovered' }
  }

  const ltdMap = new Map<string, string>()
  for (const c of discoveredSorted) {
    const ltd = goldOptionLastTradingDayYmd(c)
    if (ltd) ltdMap.set(c, ltd)
  }

  const active = discoveredSorted.filter((c) => {
    const ltd = ltdMap.get(c)
    if (!ltd) return true
    return asOfChicagoYmd <= ltd
  })

  if (active.length > 0) {
    const primary = active[0]!
    return {
      primary,
      primary_ltd: ltdMap.get(primary) ?? null,
    }
  }

  const fallback = discoveredSorted[discoveredSorted.length - 1]!
  return {
    primary: fallback,
    primary_ltd: ltdMap.get(fallback) ?? null,
    warning: 'all_listed_contracts_past_ltd_using_latest_discovery_fallback',
  }
}
