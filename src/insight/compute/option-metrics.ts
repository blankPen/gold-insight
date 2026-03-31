/**
 * Max Pain、PCR、内在价值合计、日度指标等
 */
import type { DailyMetrics } from './types'

// ============================================================================
// Core Calculations
// ============================================================================

/**
 * Calculate Max Pain (maximum pain point).
 *
 * 与 backend/server.py calculate_max_pain 一致：对每个候选结算价 P 累加 Call ITM 与 Put ITM 的买方损失，
 * 取总损失最小的 P（并列时保留先遍历到的行权价）。
 *
 * - Call loss: For all Strike < P, Call_OI * (P - Strike)
 * - Put loss:  For all Strike > P, Put_OI  * (Strike - P)
 */
export function calculateMaxPain(
  strikes: number[],
  stockCalls: number[],
  stockPuts: number[],
): number | null {
  if (
    strikes.length === 0 ||
    strikes.length !== stockCalls.length ||
    strikes.length !== stockPuts.length
  ) {
    return null
  }

  let minPain = Infinity
  let maxPainStrike = strikes[0]

  for (const potentialStrike of strikes) {
    let totalPain = 0

    // Call ITM loss: Strike < P → Call buyer loses (P - Strike) * OI
    for (let i = 0; i < strikes.length; i++) {
      if (strikes[i] < potentialStrike) {
        totalPain += stockCalls[i] * (potentialStrike - strikes[i])
      }
    }

    // Put ITM loss: Strike > P → Put buyer loses (Strike - P) * OI
    for (let i = 0; i < strikes.length; i++) {
      if (strikes[i] > potentialStrike) {
        totalPain += stockPuts[i] * (strikes[i] - potentialStrike)
      }
    }

    if (totalPain < minPain) {
      minPain = totalPain
      maxPainStrike = potentialStrike
    }
  }

  return maxPainStrike
}

/**
 * Calculate call option intrinsic value.
 * Intrinsic value = max(0, S - K)
 * Only valuable when spot price > strike price.
 */
export function calculateCallIntrinsicValue(S: number, strikes: number[]): number[] {
  return strikes.map((K) => Math.max(0, S - K))
}

/**
 * Calculate put option intrinsic value.
 * Intrinsic value = max(0, K - S)
 * Only valuable when strike price > spot price.
 */
export function calculatePutIntrinsicValue(S: number, strikes: number[]): number[] {
  return strikes.map((K) => Math.max(0, K - S))
}

/**
 * Calculate moneyness status for each strike.
 * @param S Spot price
 * @param strikes Array of strike prices
 * @returns Moneyness array: 'ITM' | 'ATM' | 'OTM'
 */
export function calculateMoneyness(S: number, strikes: number[]): ('ITM' | 'ATM' | 'OTM')[] {
  const TOLERANCE = 0.005 // 0.5% tolerance for ATM
  return strikes.map((K) => {
    const diff = (S - K) / K
    if (Math.abs(diff) <= TOLERANCE) return 'ATM'
    return diff > 0 ? 'ITM' : 'OTM'
  })
}

/**
 * Calculate Put/Call Ratio (PCR).
 * PCR = Put OI / Call OI
 * When Call is 0 and Put > 0, returns 999 (extreme bearish signal).
 */
export function calculatePCR(stockCalls: number[], stockPuts: number[]): number[] {
  if (stockCalls.length !== stockPuts.length) return []
  return stockCalls.map((call, i) => {
    const put = stockPuts[i]
    if (call > 0) return put / call
    return put > 0 ? 999 : 0
  })
}

/**
 * Calculate open interest change rate (%).
 * changeRate = Change / AtClose × 100%
 */
export function calculateChangeRate(changes: number[], atCloses: number[]): number[] {
  if (changes.length !== atCloses.length) return []
  return changes.map((change, i) => {
    const ac = atCloses[i]
    return ac > 0 ? (change / ac) * 100 : 0
  })
}

/**
 * Calculate Volume/Open Interest ratio.
 * ratio = TotalVolume / AtClose
 */
export function calculateVolumeRatio(volumes: number[], atCloses: number[]): number[] {
  if (volumes.length !== atCloses.length) return []
  return volumes.map((vol, i) => {
    const ac = atCloses[i]
    return ac > 0 ? vol / ac : 0
  })
}

/**
 * 与 `backend/options_iv_service.calculate_intrinsic_value` 同逻辑（总内在价值，美元）。
 *
 * IV(S) = Σ[Call_OI * max(S-K, 0) * 100] + Σ[Put_OI * max(K-S, 0) * 100]
 * COMEX 黄金期权 1 手 = 100 金衡盎司。
 */
export function calculateIntrinsicValue(
  strikes: number[],
  callOi: number[],
  putOi: number[],
  price: number,
): number {
  if (!strikes || strikes.length !== callOi.length || strikes.length !== putOi.length) {
    return 0
  }

  let totalIV = 0
  const CONTRACT_SIZE = 100 // 1 contract = 100 troy ounces

  for (let i = 0; i < strikes.length; i++) {
    const strike = typeof strikes[i] === 'number' ? strikes[i] : parseFloat(String(strikes[i]))
    const call = typeof callOi[i] === 'number' ? callOi[i] : parseFloat(String(callOi[i]))
    const put = typeof putOi[i] === 'number' ? putOi[i] : parseFloat(String(putOi[i]))

    if (isNaN(strike) || isNaN(call) || isNaN(put)) continue

    // Call intrinsic: max(S - K, 0) × OI × 100
    const callIntrinsic = Math.max(price - strike, 0) * call * CONTRACT_SIZE
    // Put intrinsic: max(K - S, 0) × OI × 100
    const putIntrinsic = Math.max(strike - price, 0) * put * CONTRACT_SIZE

    totalIV += callIntrinsic + putIntrinsic
  }

  return totalIV
}

/**
 * 与 `backend/options_iv_service.calculate_delta_iv` 同逻辑。
 * ΔIV = calculate_intrinsic_value(…, closing_price) - calculate_intrinsic_value(…, max_pain)。
 * 此处 IV 表示整链总内在价值（美元），非隐含波动率。
 */
export function calculateDeltaIV(
  snapshot: { x?: number[]; stock_call?: number[]; stock_put?: number[]; max_pain?: number },
  closingPrice: number,
  maxPain?: number,
): number | null {
  try {
    const strikes = snapshot.x ?? []
    const callOi = snapshot.stock_call ?? []
    const putOi = snapshot.stock_put ?? []

    if (strikes.length === 0 || callOi.length === 0 || putOi.length === 0) {
      return null
    }

    const mp = maxPain ?? snapshot.max_pain
    if (mp === null || mp === undefined) {
      return null
    }

    const ivAtClosing = calculateIntrinsicValue(strikes, callOi, putOi, closingPrice)
    const ivAtMaxPain = calculateIntrinsicValue(strikes, callOi, putOi, mp)

    return ivAtClosing - ivAtMaxPain
  } catch {
    return null
  }
}

/**
 * 与 `backend/options_iv_service.calculate_price_deviation_pct` 同逻辑。
 * deviation% = (closing_price - max_pain) / max_pain * 100
 */
export function calculatePriceDeviationPct(
  closingPrice: number,
  maxPain: number,
): number | null {
  if (!maxPain || maxPain === 0) return null
  return ((closingPrice - maxPain) / maxPain) * 100
}

/**
 * Calculate daily metrics from snapshot data.
 * 与 backend/options_service.calculate_daily_metrics 一致。
 */
export function calculateDailyMetrics(snapshot: {
  x?: number[]
  stock_call?: number[]
  stock_put?: number[]
  change_call?: number[]
  change_put?: number[]
  max_pain?: number
  volume_oi_ratio?: Array<{ volume_call?: number; volume_put?: number }>
}): DailyMetrics {
  const strikes = snapshot.x ?? []
  const stockCall = snapshot.stock_call ?? []
  const stockPut = snapshot.stock_put ?? []
  const changeCall = snapshot.change_call ?? []
  const changePut = snapshot.change_put ?? []

  const callOI = stockCall.reduce((a, b) => a + b, 0)
  const putOI = stockPut.reduce((a, b) => a + b, 0)
  const totalOI = callOI + putOI

  let totalVolume = 0
  if (snapshot.volume_oi_ratio) {
    for (const item of snapshot.volume_oi_ratio) {
      totalVolume += (item.volume_call ?? 0) + (item.volume_put ?? 0)
    }
  }

  const callChange = changeCall.reduce((a, b) => a + b, 0)
  const putChange = changePut.reduce((a, b) => a + b, 0)
  const totalChange = callChange + putChange

  const pcr = callOI > 0 ? putOI / callOI : null

  // Find key strikes
  let maxOIStrike: number | null = null
  let maxNetCallStrike: number | null = null
  let minNetCallStrike: number | null = null

  if (strikes.length === stockCall.length && strikes.length === stockPut.length) {
    // Max total OI strike
    let maxTotalOI = -1
    for (let i = 0; i < strikes.length; i++) {
      const totalAtStrike = stockCall[i] + stockPut[i]
      if (totalAtStrike > maxTotalOI) {
        maxTotalOI = totalAtStrike
        maxOIStrike = strikes[i]
      }
    }

    // Max/min net call change strike
    if (
      strikes.length === changeCall.length &&
      strikes.length === changePut.length
    ) {
      let maxNetCallChange = -Infinity
      let minNetCallChange = Infinity

      for (let i = 0; i < strikes.length; i++) {
        const netCallChange = changeCall[i] - changePut[i]
        if (netCallChange > maxNetCallChange) {
          maxNetCallChange = netCallChange
          maxNetCallStrike = strikes[i]
        }
        if (netCallChange < minNetCallChange) {
          minNetCallChange = netCallChange
          minNetCallStrike = strikes[i]
        }
      }
    }
  }

  return {
    total_oi: Math.round(totalOI),
    total_volume: Math.round(totalVolume),
    total_change: Math.round(totalChange),
    call_oi: Math.round(callOI),
    put_oi: Math.round(putOI),
    call_change: Math.round(callChange),
    put_change: Math.round(putChange),
    max_pain: snapshot.max_pain ?? null,
    // 与 Python 一致：float(pcr)，不做人为截断
    pcr: pcr !== null ? pcr : null,
    max_oi_strike: maxOIStrike,
    max_net_call_strike: maxNetCallStrike,
    min_net_call_strike: minNetCallStrike,
  }
}
