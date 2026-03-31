import * as fs from 'fs'
import * as path from 'path'
import { MERGE_REL, mergeRootDefault, type MergeStateFile } from './insight/data-paths'
import { readJsonFile } from './insight/merge-store'

export type MergeSeriesKind =
  | 'etf_gold'
  | 'etf_silver'
  | 'comex_gold'
  | 'comex_silver'
  | 'fred_dgs10'
  | 'gc_kline'

export interface MergeSeriesPayload {
  kind: MergeSeriesKind
  available: boolean
  labels: string[]
  series: { name: string; data: number[] }[]
  error?: string
}

export interface MergeSeriesBundle {
  merge_state?: { last_snapshot_id?: string; updated_at?: string }
  items: MergeSeriesPayload[]
}

interface ETFHoldRow {
  商品?: string
  日期?: string
  总库存?: number
  '增持/减持'?: number
  总价值?: number
}

interface ComexRow {
  日期?: string
  'COMEX库存量-吨'?: number
  'COMEX库存量-盎司'?: number
}

interface FredRow {
  date?: string
  value?: number | null
}

interface KlineRow {
  date?: string
  open?: number
  close?: number
  high?: number
  low?: number
}

function safeReadJson<T>(abs: string): T | null {
  try {
    if (!fs.existsSync(abs)) return null
    const t = fs.readFileSync(abs, 'utf8')
    return JSON.parse(t) as T
  } catch {
    return null
  }
}

function normalizeDateLabel(raw: string | undefined): string {
  if (!raw) return ''
  const s = String(raw).trim()
  if (s.length >= 10) return s.slice(0, 10)
  return s
}

function sliceLimit<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows
  return rows.slice(-limit)
}

function buildEtfSeries(
  kind: 'etf_gold' | 'etf_silver',
  abs: string,
  limit: number,
): MergeSeriesPayload {
  const rows = safeReadJson<ETFHoldRow[]>(abs)
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return { kind, available: false, labels: [], series: [] }
  }
  const sorted = [...rows].sort((a, b) =>
    normalizeDateLabel(a.日期).localeCompare(normalizeDateLabel(b.日期)),
  )
  const part = sliceLimit(sorted, limit)
  return {
    kind,
    available: true,
    labels: part.map((r) => normalizeDateLabel(r.日期)),
    series: [
      { name: 'total_holdings', data: part.map((r) => Number(r.总库存) || 0) },
      { name: 'change', data: part.map((r) => Number(r['增持/减持']) || 0) },
    ],
  }
}

function buildComexSeries(
  kind: MergeSeriesKind,
  abs: string,
  limit: number,
): MergeSeriesPayload {
  const rows = safeReadJson<ComexRow[]>(abs)
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return { kind, available: false, labels: [], series: [] }
  }
  const sorted = [...rows].sort((a, b) =>
    normalizeDateLabel(a.日期).localeCompare(normalizeDateLabel(b.日期)),
  )
  const part = sliceLimit(sorted, limit)
  return {
    kind,
    available: true,
    labels: part.map((r) => normalizeDateLabel(r.日期)),
    series: [
      { name: 'tons', data: part.map((r) => Number(r['COMEX库存量-吨']) || 0) },
      { name: 'ounces', data: part.map((r) => Number(r['COMEX库存量-盎司']) || 0) },
    ],
  }
}

function buildFredSeries(abs: string, limit: number): MergeSeriesPayload {
  const rows = safeReadJson<FredRow[]>(abs)
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return { kind: 'fred_dgs10', available: false, labels: [], series: [] }
  }
  const sorted = [...rows].sort((a, b) =>
    String(a.date ?? '').localeCompare(String(b.date ?? '')),
  )
  const part = sliceLimit(sorted, limit)
  return {
    kind: 'fred_dgs10',
    available: true,
    labels: part.map((r) => String(r.date ?? '')),
    series: [{ name: 'value', data: part.map((r) => (r.value == null ? NaN : Number(r.value))) }],
  }
}

function buildGcKlineSeries(abs: string, limit: number): MergeSeriesPayload {
  const rows = safeReadJson<KlineRow[]>(abs)
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return { kind: 'gc_kline', available: false, labels: [], series: [] }
  }
  const sorted = [...rows].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
  const part = sliceLimit(sorted, limit)
  return {
    kind: 'gc_kline',
    available: true,
    labels: part.map((r) => String(r.date ?? '')),
    series: [
      { name: 'close', data: part.map((r) => Number(r.close) || 0) },
      { name: 'open', data: part.map((r) => Number(r.open) || 0) },
      { name: 'high', data: part.map((r) => Number(r.high) || 0) },
      { name: 'low', data: part.map((r) => Number(r.low) || 0) },
    ],
  }
}

export function getMergeSeriesBundle(
  kinds: MergeSeriesKind[],
  limit: number,
  mergeRoot?: string,
): MergeSeriesBundle {
  const root = mergeRoot ? path.resolve(mergeRoot) : mergeRootDefault()
  const statePath = path.join(root, MERGE_REL.state)
  const state = readJsonFile<MergeStateFile>(statePath)
  const items: MergeSeriesPayload[] = []

  for (const kind of kinds) {
    if (kind === 'etf_gold') {
      items.push(buildEtfSeries('etf_gold', path.join(root, MERGE_REL.etfGold), limit))
      continue
    }
    if (kind === 'etf_silver') {
      items.push(buildEtfSeries('etf_silver', path.join(root, MERGE_REL.etfSilver), limit))
      continue
    }
    if (kind === 'comex_gold') {
      items.push(buildComexSeries('comex_gold', path.join(root, MERGE_REL.comexGold), limit))
      continue
    }
    if (kind === 'comex_silver') {
      items.push(
        buildComexSeries('comex_silver', path.join(root, MERGE_REL.comexSilver), limit),
      )
      continue
    }
    if (kind === 'fred_dgs10') {
      items.push(buildFredSeries(path.join(root, MERGE_REL.fredDir, 'DGS10.json'), limit))
      continue
    }
    if (kind === 'gc_kline') {
      items.push(
        buildGcKlineSeries(path.join(root, MERGE_REL.futuresKlineDir, 'GC00Y.json'), limit),
      )
      continue
    }
  }

  return {
    merge_state: state
      ? {
          last_snapshot_id: state.last_snapshot_id,
          updated_at: state.updated_at,
        }
      : undefined,
    items,
  }
}

export function parseMergeSeriesKindsParam(param: string | undefined): MergeSeriesKind[] {
  const all: MergeSeriesKind[] = [
    'etf_gold',
    'etf_silver',
    'comex_gold',
    'comex_silver',
    'fred_dgs10',
    'gc_kline',
  ]
  if (!param || !param.trim()) return all
  const set = new Set<MergeSeriesKind>()
  for (const p of param.split(',')) {
    const k = p.trim() as MergeSeriesKind
    if (all.includes(k)) set.add(k)
  }
  return set.size > 0 ? Array.from(set) : all
}
