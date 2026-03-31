/**
 * data/snapshots 与 data/merge 路径约定（相对 process.cwd()）
 */
import * as path from 'path'

/** 快照子目录名：本地日期 `YYYY-MM-DD`（不含时分秒）；同日多次 sync 写入同一目录并覆盖当日文件 */
export function makeSnapshotRunId(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function snapshotsRoot(): string {
  return path.join(process.cwd(), 'data', 'snapshots')
}

export function snapshotRunDir(runId: string): string {
  return path.join(snapshotsRoot(), runId)
}

export function mergeRootDefault(): string {
  return path.join(process.cwd(), 'data', 'merge')
}

/** 相对 cwd 的正斜杠路径，便于写入 _state.json */
export function toRepoRelative(absPath: string): string {
  const rel = path.relative(process.cwd(), path.resolve(absPath))
  return rel.split(path.sep).join('/')
}

export function mergePath(mergeRoot: string, ...segments: string[]): string {
  return path.join(mergeRoot, ...segments)
}

export const MERGE_REL = {
  state: '_state.json',
  futuresSpot: path.join('futures', 'spot-latest.json'),
  futuresKlineDir: path.join('futures', 'kline'),
  comexGold: path.join('comex', 'gold-inventory.json'),
  comexSilver: path.join('comex', 'silver-inventory.json'),
  etfGold: path.join('etf', 'gold-holdings.json'),
  etfSilver: path.join('etf', 'silver-holdings.json'),
  cotDir: 'cot',
  fredDir: 'fred',
  deliveryRecords: path.join('cme-delivery', 'records.json'),
  cmeVoiParsed: path.join('cme-voi', 'parsed.json'),
} as const

export interface MergeStateFile {
  last_snapshot_id: string
  updated_at: string
  cme_voi?: {
    xls_path: string
    parsed_json_path: string
    trade_date: string
  }
}
