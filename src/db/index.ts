import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
import type { Alert } from '../alert-engine';
import type { AIAnalysisResult } from '../ai/provider';

export type PricePoint = { price: number; timestamp: string };

export type Candle = {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

const MAX_PRICE_ROWS_FOR_CANDLES = 500_000;

export interface AnalysisLogRow {
  id: number;
  alert_type: string;
  alert_level: string;
  alert_title: string;
  alert_message: string;
  price: number;
  indicators: string | null;
  ai_analysis: string | null;
  ai_suggestion: string | null;
  ai_confidence: string | null;
  ai_raw: string | null;
  timestamp: string;
  created_at: string;
}

// 数据库文件路径
const DB_PATH = path.join(moduleDir, '../../data/gold-price.db');

// 初始化数据库
const db = new Database(DB_PATH);

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price REAL NOT NULL,
    timestamp TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_timestamp ON prices(timestamp);

  CREATE TABLE IF NOT EXISTS analysis_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_type TEXT NOT NULL,
    alert_level TEXT NOT NULL,
    alert_title TEXT NOT NULL,
    alert_message TEXT NOT NULL,
    price REAL NOT NULL,
    indicators TEXT,
    ai_analysis TEXT,
    ai_suggestion TEXT,
    ai_confidence TEXT,
    ai_raw TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_analysis_logs_ts ON analysis_logs(timestamp);
`);

// 过滤截止时间：2026-03-02 16:36:00 UTC+8
const CUTOFF_TIMESTAMP = '2026-03-02T08:36:00.000Z';

// 初始化种子数据（如果没有数据）
function initSeedData() {
  const count = db.prepare('SELECT COUNT(*) as count FROM prices').get() as { count: number };
  
  if (count.count === 0) {
    console.log('[DB] 初始化种子数据...');
    const now = Date.now();
    const stmt = db.prepare('INSERT INTO prices (price, timestamp) VALUES (?, ?)');
    
    const insertMany = db.transaction((points: PricePoint[]) => {
      for (const p of points) {
        stmt.run(p.price, p.timestamp);
      }
    });
    
    const seedHistory: PricePoint[] = [];
    // 生成最近 48 小时的数据，每小时一条
    for (let i = 0; i < 48; i++) {
      const ts = new Date(now - (47 - i) * 60 * 60 * 1000).toISOString();
      // 过滤掉 16:36 之前的数据
      if (ts < CUTOFF_TIMESTAMP) {
        continue;
      }
      // 模拟价格
      const price = 2000 + Math.sin(i / 3) * 10 + i * 0.5;
      seedHistory.push({ price: Number(price.toFixed(2)), timestamp: ts });
    }
    
    if (seedHistory.length > 0) {
      insertMany(seedHistory);
      console.log(`[DB] 已插入 ${seedHistory.length} 条种子数据`);
    }
  }
}

// 初始化
initSeedData();

// 获取最新价格
export async function getLatestPrice(): Promise<PricePoint> {
  const row = db.prepare('SELECT price, timestamp FROM prices ORDER BY timestamp DESC LIMIT 1').get() as PricePoint | undefined;
  return row || { price: 0, timestamp: new Date().toISOString() };
}

// 获取历史数据（返回最新的 N 条，按时间正序）
export async function getHistory(hours: number, limit: number): Promise<PricePoint[]> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT price, timestamp FROM (
      SELECT price, timestamp FROM prices
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
    ) sub ORDER BY timestamp ASC
  `).all(cutoff, limit) as PricePoint[];
  
  return rows;
}

/** 不早于 cutoffIso 的第一条报价（用于「今日开盘」等基准价） */
export function getFirstPriceAtOrAfter(cutoffIso: string): PricePoint | undefined {
  return db
    .prepare(
      `SELECT price, timestamp FROM prices
       WHERE timestamp >= ?
       ORDER BY timestamp ASC
       LIMIT 1`,
    )
    .get(cutoffIso) as PricePoint | undefined;
}

/** 严格早于 cutoffIso 的最后一条报价（用于「昨日收盘」等） */
export function getLastPriceBefore(cutoffIso: string): PricePoint | undefined {
  return db
    .prepare(
      `SELECT price, timestamp FROM prices
       WHERE timestamp < ?
       ORDER BY timestamp DESC
       LIMIT 1`,
    )
    .get(cutoffIso) as PricePoint | undefined;
}

/** 时间窗内按时间正序的 tick，上限 maxRows（防 OOM） */
export function getPricePointsSince(cutoffIso: string, maxRows: number): PricePoint[] {
  const cap = Math.min(Math.max(1, maxRows), MAX_PRICE_ROWS_FOR_CANDLES);
  return db
    .prepare(
      `SELECT price, timestamp FROM prices
       WHERE timestamp >= ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(cutoffIso, cap) as PricePoint[];
}

/**
 * 将有序 tick 聚合为 K 线；bucket 以 UTC epoch 秒对齐 bucketSeconds。
 */
export function aggregateCandles(points: PricePoint[], bucketSeconds: number): Candle[] {
  if (points.length === 0 || bucketSeconds < 1) {
    return [];
  }
  const bucketSec = bucketSeconds;
  const buckets = new Map<
    number,
    { open: number; high: number; low: number; close: number }
  >();

  for (const p of points) {
    const sec = Math.floor(new Date(p.timestamp).getTime() / 1000);
    const bucketStart = Math.floor(sec / bucketSec) * bucketSec;
    const price = p.price;
    const prev = buckets.get(bucketStart);
    if (prev == null) {
      buckets.set(bucketStart, {
        open: price,
        high: price,
        low: price,
        close: price,
      });
    } else {
      prev.high = Math.max(prev.high, price);
      prev.low = Math.min(prev.low, price);
      prev.close = price;
    }
  }

  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  return keys.map((k) => {
    const b = buckets.get(k)!;
    return {
      t: new Date(k * 1000).toISOString(),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    };
  });
}

// 获取24小时统计
export async function getStats24h(): Promise<{ high24h: number; low24h: number; average24h: number; updateCount: number }> {
  return getStatsForHours(24);
}

// 获取指定小时内的统计（供多时间框架分析）
export async function getStatsForHours(hours: number): Promise<{ high24h: number; low24h: number; average24h: number; updateCount: number }> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT price FROM prices WHERE timestamp >= ?
  `).all(cutoff) as { price: number }[];

  const prices = rows.map(r => r.price);

  if (prices.length === 0) {
    return { high24h: 0, low24h: 0, average24h: 0, updateCount: 0 };
  }

  return {
    high24h: Math.max(...prices),
    low24h: Math.min(...prices),
    average24h: prices.reduce((a, b) => a + b, 0) / prices.length,
    updateCount: prices.length
  };
}

/** 自 cutoffIso（含）起的最高价、最低价等（用于上海自然日「今日」） */
export async function getStatsSince(cutoffIso: string): Promise<{ high: number; low: number; average: number; updateCount: number }> {
  const rows = db.prepare(`SELECT price FROM prices WHERE timestamp >= ?`).all(cutoffIso) as { price: number }[];
  const prices = rows.map((r) => r.price);
  if (prices.length === 0) {
    return { high: 0, low: 0, average: 0, updateCount: 0 };
  }
  return {
    high: Math.max(...prices),
    low: Math.min(...prices),
    average: prices.reduce((a, b) => a + b, 0) / prices.length,
    updateCount: prices.length,
  };
}

// 添加新价格（供 scraper 调用）
export function addPrice(price: number, timestamp: string): void {
  db.prepare('INSERT INTO prices (price, timestamp) VALUES (?, ?)').run(price, timestamp);
}

// ── analysis_logs 操作 ────────────────────────────────────────────────

export function addAnalysisLog(alert: Alert, aiResult: AIAnalysisResult | null): void {
  db.prepare(`
    INSERT INTO analysis_logs
      (alert_type, alert_level, alert_title, alert_message, price, indicators,
       ai_analysis, ai_suggestion, ai_confidence, ai_raw, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    alert.type,
    alert.level,
    alert.title,
    alert.message,
    alert.price,
    JSON.stringify(alert.indicators),
    aiResult?.enhancedMessage ?? null,
    aiResult?.suggestion ?? null,
    aiResult?.confidence ?? null,
    aiResult?.raw ?? null,
    alert.timestamp,
  );
}

export function getAnalysisLogs(limit = 50, offset = 0): AnalysisLogRow[] {
  return db.prepare(`
    SELECT * FROM analysis_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as AnalysisLogRow[];
}

export function getAnalysisLogsSince(sinceId: number, limit = 50): AnalysisLogRow[] {
  return db.prepare(`
    SELECT * FROM analysis_logs WHERE id > ? ORDER BY id ASC LIMIT ?
  `).all(sinceId, limit) as AnalysisLogRow[];
}

const MAX_SUMMARY_CHARS = 800;

export function getRecentAnalysisSummary(): string {
  const recent = db.prepare(`
    SELECT alert_type, alert_level, alert_title, price, ai_analysis, ai_suggestion, ai_confidence, timestamp
    FROM analysis_logs ORDER BY timestamp DESC LIMIT 20
  `).all() as Pick<AnalysisLogRow, 'alert_type' | 'alert_level' | 'alert_title' | 'price' | 'ai_analysis' | 'ai_suggestion' | 'ai_confidence' | 'timestamp'>[];

  if (recent.length === 0) return '';

  const parts: string[] = [];

  for (let i = 0; i < recent.length; i++) {
    const r = recent[i];
    if (i < 5) {
      let entry = `[${r.timestamp}] ${r.alert_title} | 价格$${r.price.toFixed(2)}`;
      if (r.ai_analysis) entry += ` | AI(${r.ai_confidence}): ${r.ai_analysis}`;
      if (r.ai_suggestion) entry += ` | 建议: ${r.ai_suggestion}`;
      parts.push(entry);
    } else {
      parts.push(`[${r.timestamp}] ${r.alert_type} $${r.price.toFixed(2)} (${r.ai_confidence ?? 'N/A'})`);
    }
  }

  let summary = parts.join('\n');
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS) + '…(已截断)';
  }
  return summary;
}

// 关闭数据库
export function closeDb(): void {
  db.close();
}

export default {
  getLatestPrice, getHistory, getStats24h, getStatsForHours, getStatsSince, addPrice,
  addAnalysisLog, getAnalysisLogs, getAnalysisLogsSince, getRecentAnalysisSummary,
  getPricePointsSince, getFirstPriceAtOrAfter, getLastPriceBefore, aggregateCandles,
};
