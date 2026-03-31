/**
 * Black-Scholes、Greeks、隐含波动率
 */
import type { Greeks, IVResult } from './types'

// ============================================================================
// Black-Scholes Model
// ============================================================================

/** Standard normal CDF (Abramowitz and Stegun approximation) */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly =
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
  const cdf = 1 - pdf * poly
  return x >= 0 ? cdf : 1 - cdf
}

/** Standard normal PDF */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** d1 = [ln(S/K) + (r + σ²/2)·T] / (σ·√T) */
function calcD1(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return NaN
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
}

/** Calculate Call option price using Black-Scholes */
export function blackScholesCall(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
): number {
  if (T <= 0) return Math.max(S - K, 0)
  if (sigma <= 0) return Math.max(S - K * Math.exp(-r * T), 0)
  const d1 = calcD1(S, K, T, r, sigma)
  const d2 = d1 - sigma * Math.sqrt(T)
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
}

/** Calculate Put option price using Black-Scholes */
export function blackScholesPut(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
): number {
  if (T <= 0) return Math.max(K - S, 0)
  if (sigma <= 0) return Math.max(K * Math.exp(-r * T) - S, 0)
  const d1 = calcD1(S, K, T, r, sigma)
  const d2 = d1 - sigma * Math.sqrt(T)
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1)
}

/** Calculate option Greeks */
export function calculateGreeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean,
): Greeks {
  if (T <= 0 || sigma <= 0) {
    return { delta: isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, vega: 0, theta: 0 }
  }

  const d1 = calcD1(S, K, T, r, sigma)
  const d2 = d1 - sigma * Math.sqrt(T)

  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1
  const gamma = normPdf(d1) / (S * sigma * Math.sqrt(T))
  const vega = (S * normPdf(d1) * Math.sqrt(T)) / 100 // 1% vol change

  // Theta
  const term1 = (-S * normPdf(d1) * sigma) / (2 * Math.sqrt(T))
  const term2 = isCall
    ? -r * K * Math.exp(-r * T) * normCdf(d2)
    : r * K * Math.exp(-r * T) * normCdf(-d2)
  const theta = (term1 + term2) / 365 // Per day

  return { delta, gamma, vega, theta }
}

/**
 * Calculate Implied Volatility (IV) using Brent's method.
 *
 * Searches for σ ∈ [0.001, 5.0] that makes Black-Scholes price equal market price.
 *
 * @param S Spot price
 * @param K Strike price
 * @param T Time to expiry (years)
 * @param marketPrice Market price of the option
 * @param optionType 'call' or 'put'
 * @param r Risk-free rate (default 0.05)
 * @returns IV value, or null if calculation fails
 */
export function calculateIV(
  S: number,
  K: number,
  T: number,
  marketPrice: number,
  optionType: 'call' | 'put' = 'call',
  r: number = 0.05,
): IVResult {
  if (T <= 0 || marketPrice <= 0) {
    return { iv: null, success: false, error: 'Invalid input: T or marketPrice <= 0' }
  }

  // Intrinsic value boundary check
  const intrinsic = optionType === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0)
  if (marketPrice < intrinsic * 0.99) {
    return { iv: null, success: false, error: 'Market price below intrinsic value' }
  }

  const priceFn = (sigma: number): number =>
    optionType === 'call'
      ? blackScholesCall(S, K, T, r, sigma)
      : blackScholesPut(S, K, T, r, sigma)

  const objective = (sigma: number): number => priceFn(sigma) - marketPrice

  // Brent's method
  const SIGMA_MIN = 0.001
  const SIGMA_MAX = 5.0
  const TOLERANCE = 1e-6
  const MAX_ITER = 100

  let a = SIGMA_MIN
  let b = SIGMA_MAX
  let fa = objective(a)
  let fb = objective(b)

  if (fa * fb > 0) {
    return { iv: null, success: false, error: 'No sign change in IV range' }
  }

  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (Math.abs(fb) < TOLERANCE) {
      return { iv: b, success: true }
    }

    let c = a
    let fc = fa
    let d = b - a
    let e = d

    let m: number, s: number, p: number, q: number, tol: number

    if (Math.abs(fc) < Math.abs(fb)) {
      a = b; b = c; c = a
      fa = fb; fb = fc; fc = fa
    }

    m = 0.5 * (c - b)
    tol = TOLERANCE + 4 * Math.abs(b)

    if (Math.abs(m) <= tol || fb === 0) {
      return { iv: b, success: true }
    }

    if (Math.abs(e) < tol || Math.abs(fa) <= Math.abs(fb)) {
      m = Math.sign(m) * Math.max(Math.abs(m), tol)
      d = m
    } else {
      s = b
      if (a !== c && fa !== fc) {
        const t1 = fa * fb
        const t2 = fa * fc
        p = (t2 - t1) * fb
        q = (fa - fb) * (fc - fb)
        if (q !== 0) {
          p = p / q
          q = (a - b) * q
          s = b + (Math.abs(p) < Math.abs(0.5 * q) ? p : Math.sign(p) * Math.abs(q / 2))
        }
      }
      if (Math.abs(s - b) < Math.abs(m) || Math.abs(s) < tol) {
        m = Math.sign(m) * Math.max(Math.abs(m), tol)
        d = m
      } else {
        d = s - b
        e = s - b
      }
    }

    a = b
    fa = fb
    if (Math.abs(d) > tol) {
      b = b + d
    } else {
      b = b + Math.sign(m) * tol
    }

    fb = objective(b)

    if (fb * fc > 0) {
      a = c; fa = fc
      c = b; fc = fb
    }
  }

  return { iv: b, success: false, error: 'Brent method did not converge' }
}

/**
 * Calculate volatility surface (IV for all strikes at a given expiry).
 */
export function calculateVolatilitySurface(
  S: number,
  strikes: number[],
  T: number,
  marketPrices: number[],
  optionTypes: ('call' | 'put')[],
  r: number = 0.05,
): IVResult[] {
  return strikes.map((K, i) =>
    calculateIV(S, K, T, marketPrices[i], optionTypes[i] ?? 'call', r),
  )
}
