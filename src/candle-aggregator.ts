import { getHistory } from './db';

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

const MAX_CANDLES = 200;
const CANDLE_INTERVAL_MS = 60_000; // 1 minute

export class CandleAggregator {
  private candles: Candle[] = [];
  private currentCandle: Candle | null = null;

  getCandles(): Candle[] {
    const result = [...this.candles];
    if (this.currentCandle) {
      result.push(this.currentCandle);
    }
    return result;
  }

  getCompletedCandles(): Candle[] {
    return [...this.candles];
  }

  /**
   * Backfill candles from database history on startup.
   * Groups price points into 1-minute OHLC bars.
   */
  async backfill(hours = 6): Promise<void> {
    const rows = await getHistory(hours, 50_000);
    if (!rows || rows.length === 0) return;

    const buckets = new Map<number, { prices: number[]; first: number; last: number }>();

    for (const row of rows) {
      const ts = new Date(row.timestamp).getTime();
      const bucket = Math.floor(ts / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
      let entry = buckets.get(bucket);
      if (!entry) {
        entry = { prices: [], first: ts, last: ts };
        buckets.set(bucket, entry);
      }
      entry.prices.push(row.price);
      if (ts < entry.first) entry.first = ts;
      if (ts > entry.last) entry.last = ts;
    }

    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
    for (const key of sortedKeys) {
      const entry = buckets.get(key)!;
      const p = entry.prices;
      this.candles.push({
        open: p[0],
        high: Math.max(...p),
        low: Math.min(...p),
        close: p[p.length - 1],
        timestamp: key,
      });
    }

    this.trimCandles();
    console.log(`[CandleAggregator] Backfilled ${this.candles.length} candles from ${hours}h history`);
  }

  /**
   * Feed a new tick price. Returns true if a candle was just completed.
   */
  onTick(price: number, timestampISO: string): boolean {
    const ts = new Date(timestampISO).getTime();
    const bucket = Math.floor(ts / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
    let candleCompleted = false;

    if (!this.currentCandle) {
      this.currentCandle = { open: price, high: price, low: price, close: price, timestamp: bucket };
      return false;
    }

    if (bucket > this.currentCandle.timestamp) {
      this.candles.push(this.currentCandle);
      this.trimCandles();
      candleCompleted = true;
      this.currentCandle = { open: price, high: price, low: price, close: price, timestamp: bucket };
    } else {
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
    }

    return candleCompleted;
  }

  private trimCandles(): void {
    if (this.candles.length > MAX_CANDLES) {
      this.candles = this.candles.slice(this.candles.length - MAX_CANDLES);
    }
  }
}
