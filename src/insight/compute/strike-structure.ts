/**
 * Delta 中性 / Gamma 加权 / 净 Delta 零（启发式）
 */

/**
 * 用 Call/Put OI 差在行权价间变号点插值，近似「净敞口中性」价位（启发式）。
 *
 * 与 backend/barchart_options_service._calculate_delta_neutral_value（|Delta|×OI 加权）不同：
 * 后者需要链上 Delta；本函数在无 Greeks 时供 CLI 使用。
 */
export function calculateDeltaNeutralStrike(
  strikes: number[],
  stockCalls: number[],
  stockPuts: number[],
  spotPrice: number,
): number | null {
  if (
    strikes.length === 0 ||
    strikes.length !== stockCalls.length ||
    strikes.length !== stockPuts.length
  ) {
    return null
  }

  // Simple approximation: find strike where net OI (call - put) changes sign
  let netOI = 0
  let lastNetOI = 0
  let lastStrike = strikes[0]

  for (let i = 0; i < strikes.length; i++) {
    netOI = stockCalls[i] - stockPuts[i]

    if (i > 0 && netOI * lastNetOI <= 0) {
      // Sign change: interpolate
      const ratio = Math.abs(lastNetOI) / (Math.abs(lastNetOI) + Math.abs(netOI))
      return lastStrike + ratio * (strikes[i] - lastStrike)
    }

    lastNetOI = netOI
    lastStrike = strikes[i]
  }

  // No sign change, return ATM
  return spotPrice
}

/**
 * Calculate gamma-weighted strike (strike with maximum total gamma exposure).
 *
 * Gamma is highest near ATM (S ≈ K). This approximates gamma exposure
 * by weighting OI at each strike.
 *
 * Note: True gamma calculation requires Black-Scholes. This uses OI as proxy.
 */
export function calculateGammaWeightedStrike(
  strikes: number[],
  stockCalls: number[],
  stockPuts: number[],
  spotPrice: number,
): number | null {
  if (
    strikes.length === 0 ||
    strikes.length !== stockCalls.length ||
    strikes.length !== stockPuts.length
  ) {
    return null
  }

  // Weight by proximity to spot price (proxy for gamma)
  let maxWeight = 0
  let gammaStrike = strikes[0]

  for (let i = 0; i < strikes.length; i++) {
    const distance = Math.abs(strikes[i] - spotPrice)
    const weight = (stockCalls[i] + stockPuts[i]) / (distance + 1)

    if (weight > maxWeight) {
      maxWeight = weight
      gammaStrike = strikes[i]
    }
  }

  return gammaStrike
}

/**
 * Calculate net delta zero (strike where cumulative call OI ≈ cumulative put OI).
 *
 * This is a rough approximation of where the market is delta-neutral.
 */
export function calculateNetDeltaZeroStrike(
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

  // Sort by strike ascending
  const sorted = strikes
    .map((s, i) => ({ strike: s, call: stockCalls[i], put: stockPuts[i] }))
    .sort((a, b) => a.strike - b.strike)

  let cumCall = 0
  let cumPut = 0

  for (const item of sorted) {
    cumCall += item.call
    cumPut += item.put
  }

  // Total: each side should be ~50% for delta neutral
  const total = cumCall + cumPut
  if (total === 0) return null

  const callRatio = cumCall / total
  // If call ratio is between 0.45 and 0.55, market is roughly delta neutral
  if (callRatio >= 0.45 && callRatio <= 0.55) {
    // Return ATM-like strike (closest to median)
    return strikes[Math.floor(strikes.length / 2)]
  }

  return null
}
