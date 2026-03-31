/**
 * merge 目录 JSON 读写与按主键合并
 */
import * as fs from 'fs'
import * as path from 'path'
import type { CMEDeliveryRecord } from './sync/types'

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

export function mergeByKey<T>(
  existing: T[],
  incoming: T[],
  keyOf: (row: T) => string,
): T[] {
  const map = new Map<string, T>()
  for (const row of existing) {
    map.set(keyOf(row), row)
  }
  for (const row of incoming) {
    map.set(keyOf(row), row)
  }
  return [...map.values()]
}

export function mergeKlineRows(
  existing: Array<{ date: string }>,
  incoming: Array<{ date: string }>,
): Array<{ date: string }> {
  return mergeByKey(existing, incoming, (r) => r.date).sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}

export function mergeComexOrEtfRows<T extends { 日期: string }>(
  existing: T[],
  incoming: T[],
): T[] {
  return mergeByKey(existing, incoming, (r) => String(r.日期)).sort((a, b) =>
    String(a.日期).localeCompare(String(b.日期)),
  )
}

export function mergeFredObservations(
  existing: Array<{ date: string; value: number | null }>,
  incoming: Array<{ date: string; value: number | null }>,
): Array<{ date: string; value: number | null }> {
  return mergeByKey(existing, incoming, (r) => r.date).sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}

export function mergeCotRows<
  T extends { trade_date: string; symbol: string },
>(existing: T[], incoming: T[]): T[] {
  return mergeByKey(
    existing,
    incoming,
    (r) => `${r.trade_date}\0${r.symbol}`,
  ).sort((a, b) =>
    a.trade_date.localeCompare(b.trade_date) || a.symbol.localeCompare(b.symbol),
  )
}

function deliveryKey(r: CMEDeliveryRecord): string {
  return `${r.report_date}\0${r.commodity}\0${r.contract_type}\0${r.contract_name}`
}

export function mergeDeliveryRecords(
  existing: CMEDeliveryRecord[],
  incoming: CMEDeliveryRecord[],
): CMEDeliveryRecord[] {
  return mergeByKey(existing, incoming, deliveryKey).sort(
    (a, b) =>
      a.report_date.localeCompare(b.report_date) ||
      a.contract_name.localeCompare(b.contract_name),
  )
}
