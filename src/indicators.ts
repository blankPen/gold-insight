import { Candle } from './candle-aggregator';

// ── SMA ────────────────────────────────────────────────────────────────────────

export function sma(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((sum, c) => sum + c.close, 0) / period;
}

// ── EMA ────────────────────────────────────────────────────────────────────────

export function emaArray(candles: Candle[], period: number): number[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const results: number[] = [];

  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  results.push(ema);

  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    results.push(ema);
  }
  return results;
}

export function ema(candles: Candle[], period: number): number | null {
  const arr = emaArray(candles, period);
  return arr.length > 0 ? arr[arr.length - 1] : null;
}

// ── RSI ────────────────────────────────────────────────────────────────────────

export function rsi(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD ───────────────────────────────────────────────────────────────────────

export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export function macd(
  candles: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult | null {
  if (candles.length < slowPeriod + signalPeriod) return null;

  const fastEMA = emaArray(candles, fastPeriod);
  const slowEMA = emaArray(candles, slowPeriod);

  // Align arrays: slowEMA starts at index 0 corresponding to candle[slowPeriod-1],
  // fastEMA starts at index 0 corresponding to candle[fastPeriod-1].
  // We need to compute MACD line from the point where both exist.
  const offset = slowPeriod - fastPeriod;
  const macdValues: number[] = [];
  for (let i = 0; i < slowEMA.length; i++) {
    macdValues.push(fastEMA[i + offset] - slowEMA[i]);
  }

  if (macdValues.length < signalPeriod) return null;

  // Signal line is EMA of MACD values
  const k = 2 / (signalPeriod + 1);
  let signal = macdValues.slice(0, signalPeriod).reduce((s, v) => s + v, 0) / signalPeriod;
  for (let i = signalPeriod; i < macdValues.length; i++) {
    signal = macdValues[i] * k + signal * (1 - k);
  }

  const lastMacd = macdValues[macdValues.length - 1];
  return {
    macdLine: lastMacd,
    signalLine: signal,
    histogram: lastMacd - signal,
  };
}

/**
 * Returns the previous MACD result (one bar before current) for crossover detection.
 */
export function macdPrev(
  candles: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult | null {
  if (candles.length < 2) return null;
  return macd(candles.slice(0, -1), fastPeriod, slowPeriod, signalPeriod);
}

// ── Bollinger Bands ────────────────────────────────────────────────────────────

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

export function bollingerBands(candles: Candle[], period = 20, multiplier = 2): BollingerBands | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const closes = slice.map(c => c.close);
  const mean = closes.reduce((s, v) => s + v, 0) / period;
  const variance = closes.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: mean + multiplier * stdDev,
    middle: mean,
    lower: mean - multiplier * stdDev,
  };
}

// ── Pivot Points ───────────────────────────────────────────────────────────────

export interface PivotPoints {
  pp: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

/**
 * Classic pivot points based on the most recent N candles' aggregate high/low/close.
 */
export function pivotPoints(candles: Candle[], lookback = 60): PivotPoints | null {
  if (candles.length === 0) return null;
  const slice = candles.slice(-lookback);
  const high = Math.max(...slice.map(c => c.high));
  const low = Math.min(...slice.map(c => c.low));
  const close = slice[slice.length - 1].close;

  const pp = (high + low + close) / 3;
  return {
    pp,
    r1: 2 * pp - low,
    r2: pp + (high - low),
    s1: 2 * pp - high,
    s2: pp - (high - low),
  };
}

// ── All indicators snapshot ────────────────────────────────────────────────────

export interface IndicatorSnapshot {
  price: number;
  sma20: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: MACDResult | null;
  macdPrev: MACDResult | null;
  bollingerBands: BollingerBands | null;
  pivotPoints: PivotPoints | null;
}

export function computeAll(candles: Candle[]): IndicatorSnapshot {
  const price = candles.length > 0 ? candles[candles.length - 1].close : 0;
  return {
    price,
    sma20: sma(candles, 20),
    ema12: ema(candles, 12),
    ema26: ema(candles, 26),
    rsi14: rsi(candles, 14),
    macd: macd(candles),
    macdPrev: macdPrev(candles),
    bollingerBands: bollingerBands(candles),
    pivotPoints: pivotPoints(candles),
  };
}
