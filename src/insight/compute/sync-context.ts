/**
 * merge 产出 JSON → 计算用上下文
 */
import * as fs from 'fs'
import * as path from 'path'
import { MERGE_REL } from '../data-paths'
import type {
  CMEDeliveryData,
  CMEStocksData,
  ComexInventorySyncRow,
  FuturesSpotSyncRow,
  SyncComputeContext,
  SyncDeliveryRecordRow,
} from './types'

/**
 * 从 sync 的「期货现货数据」中取主力合约最新价（美元/盎司），用于期权 intrinsic / moneyness。
 */
export function spotPriceFromFuturesSync(
  rows: FuturesSpotSyncRow[],
  metal: 'gold' | 'silver' | 'copper' = 'gold',
): number {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0
  }
  const dmTarget: Record<typeof metal, string> = {
    gold: 'GC00Y',
    silver: 'SI00Y',
    copper: 'HG00Y',
  }
  const nameHint: Record<typeof metal, string> = {
    gold: '黄金',
    silver: '白银',
    copper: '铜',
  }
  const code = dmTarget[metal]
  const hint = nameHint[metal]
  const byDm = rows.find((r) => r.dm === code)
  if (byDm != null && typeof byDm.p === 'number' && !Number.isNaN(byDm.p)) {
    return byDm.p
  }
  const byName = rows.find(
    (r) => r.name != null && String(r.name).includes(hint),
  )
  if (byName != null && typeof byName.p === 'number' && !Number.isNaN(byName.p)) {
    return byName.p
  }
  return 0
}

/**
 * 将 syncCMEDelivery 写入的 JSON 汇总为 calculateCMEAnalysis 所需的 CMEDeliveryData（按最新 report_date 汇总各合约）。
 *
 * `deliveryHistoryDays` 对齐 backend/cme_analysis_service.get_delivery_history 的 LIMIT（默认 30）。
 */
export function cmDeliveryDataFromSyncPayload(
  payload: { run_date?: string | null; records?: SyncDeliveryRecordRow[] },
  commodity: string,
  deliveryHistoryDays: number = 30,
): CMEDeliveryData | null {
  const upper = commodity.toUpperCase()
  const recs = (payload.records ?? []).filter(
    (r) => String(r.commodity ?? '').toUpperCase() === upper,
  )
  if (recs.length === 0) {
    return null
  }

  const dates = [...new Set(recs.map((r) => r.report_date))].sort()
  const latestDate = dates[dates.length - 1]!
  const latestRows = recs.filter((r) => r.report_date === latestDate)

  const dailyOz = latestRows.reduce((s, r) => s + (r.daily_oz ?? 0), 0)
  const cumulativeOz = latestRows.reduce((s, r) => s + (r.cumulative_oz ?? 0), 0)

  const byType: Record<string, { daily_oz: number; cumulative_oz: number }> = {}
  for (const r of latestRows) {
    const t = r.contract_type || 'STANDARD'
    if (!byType[t]) {
      byType[t] = { daily_oz: 0, cumulative_oz: 0 }
    }
    byType[t].daily_oz += r.daily_oz ?? 0
    byType[t].cumulative_oz += r.cumulative_oz ?? 0
  }

  const contracts = latestRows.map((r) => ({
    name: r.contract_name,
    type: r.contract_type,
    daily_total: r.daily_total,
    cumulative: r.cumulative,
    daily_oz: r.daily_oz,
    cumulative_oz: r.cumulative_oz,
    month: r.data_month ?? '',
  }))

  const byDay = new Map<
    string,
    { daily_total: number; daily_oz: number; cumulative_oz: number }
  >()
  for (const r of recs) {
    const cur = byDay.get(r.report_date) ?? {
      daily_total: 0,
      daily_oz: 0,
      cumulative_oz: 0,
    }
    cur.daily_total += r.daily_total ?? 0
    cur.daily_oz += r.daily_oz ?? 0
    cur.cumulative_oz += r.cumulative_oz ?? 0
    byDay.set(r.report_date, cur)
  }

  const distinctDesc = [...byDay.keys()].sort((a, b) => b.localeCompare(a))
  const allowedDates = new Set(distinctDesc.slice(0, Math.max(1, deliveryHistoryDays)))

  const seriesRecords = [...byDay.entries()]
    .filter(([d]) => allowedDates.has(d))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, v]) => ({
      date: d,
      daily_total: v.daily_total,
      daily_oz: v.daily_oz,
      cumulative_oz: v.cumulative_oz,
    }))

  return {
    report_date: latestDate,
    daily_oz: dailyOz,
    cumulative_oz: cumulativeOz,
    by_type: byType,
    contracts,
    records: seriesRecords,
  }
}

/**
 * 将 syncCOMEXInventory 的 JSON 转为 CMEStocksData（东方财富仅提供总盎司，registered/combined 同值，eligible=0）。
 */
export function cmeStocksDataFromComexRows(
  rows: ComexInventorySyncRow[],
): CMEStocksData | null {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null
  }
  const sorted = [...rows].sort((a, b) =>
    String(a.日期).localeCompare(String(b.日期)),
  )
  const latest = sorted[sorted.length - 1]!
  const prev = sorted.length > 1 ? sorted[sorted.length - 2]! : null
  const registered = latest['COMEX库存量-盎司'] ?? 0
  const prevReg = prev ? (prev['COMEX库存量-盎司'] ?? 0) : registered
  const netChange = registered - prevReg

  const records = sorted.map((row, i) => {
    const comb = row['COMEX库存量-盎司'] ?? 0
    const prevComb =
      i > 0 ? sorted[i - 1]!['COMEX库存量-盎司'] ?? 0 : comb
    return {
      date: String(row.日期),
      registered: comb,
      eligible: 0,
      combined: comb,
      net_change: comb - prevComb,
    }
  })

  return {
    activity_date: String(latest.日期),
    report_date: String(latest.日期),
    registered,
    eligible: 0,
    combined: registered,
    net_change: netChange,
    registered_change: netChange,
    records,
    depositories: [],
  }
}

function readJsonFileIfExists(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * 从 `data/merge` 加载交割汇总、COMEX 库存；现货价仅使用入参。
 */
export function loadMergeComputeContext(
  mergeRoot: string,
  metal: 'gold' | 'silver' | 'copper' = 'gold',
  spotPriceUsdPerOz: number,
): SyncComputeContext {
  const deliveryRaw = readJsonFileIfExists(
    path.join(mergeRoot, MERGE_REL.deliveryRecords),
  ) as { run_date?: string | null; records?: SyncDeliveryRecordRow[] } | null
  const commodity =
    metal === 'gold' ? 'GOLD' : metal === 'silver' ? 'SILVER' : 'COPPER'
  const delivery =
    deliveryRaw && typeof deliveryRaw === 'object'
      ? cmDeliveryDataFromSyncPayload(deliveryRaw, commodity)
      : null

  const comexRel =
    metal === 'silver' ? MERGE_REL.comexSilver : MERGE_REL.comexGold
  const comexRaw = readJsonFileIfExists(path.join(mergeRoot, comexRel))
  const comexRows = Array.isArray(comexRaw)
    ? (comexRaw as ComexInventorySyncRow[])
    : null
  const stocks =
    comexRows && comexRows.length > 0
      ? cmeStocksDataFromComexRows(comexRows)
      : null

  return {
    mergeRoot,
    metal,
    spotPrice: spotPriceUsdPerOz,
    delivery,
    stocks,
  }
}

/**
 * @deprecated 使用 loadMergeComputeContext；若仍需旧版按日目录中文文件名，可传该目录并配合 spot 覆盖。
 */
export function loadSyncComputeContext(
  dataDir: string,
  metal: 'gold' | 'silver' | 'copper' = 'gold',
  spotPriceOverride?: number,
): SyncComputeContext {
  const futuresRaw = readJsonFileIfExists(
    path.join(dataDir, '期货现货数据.json'),
  )
  const futures = Array.isArray(futuresRaw)
    ? (futuresRaw as FuturesSpotSyncRow[])
    : []
  const spotPrice =
    spotPriceOverride ?? spotPriceFromFuturesSync(futures, metal)

  const deliveryRaw = readJsonFileIfExists(
    path.join(dataDir, 'CME 交割数据.json'),
  ) as { run_date?: string | null; records?: SyncDeliveryRecordRow[] } | null
  const commodity =
    metal === 'gold' ? 'GOLD' : metal === 'silver' ? 'SILVER' : 'COPPER'
  const delivery =
    deliveryRaw && typeof deliveryRaw === 'object'
      ? cmDeliveryDataFromSyncPayload(deliveryRaw, commodity)
      : null

  const comexName =
    metal === 'silver'
      ? 'COMEX 库存 白银.json'
      : 'COMEX 库存.json'
  let comexRaw = readJsonFileIfExists(path.join(dataDir, comexName))
  if (metal === 'silver' && comexRaw == null) {
    comexRaw = null
  }
  const comexRows = Array.isArray(comexRaw)
    ? (comexRaw as ComexInventorySyncRow[])
    : null
  const stocks =
    comexRows && comexRows.length > 0
      ? cmeStocksDataFromComexRows(comexRows)
      : null

  return {
    mergeRoot: dataDir,
    metal,
    spotPrice,
    delivery,
    stocks,
  }
}
