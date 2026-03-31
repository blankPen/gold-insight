/**
 * 期权洞察：优先当前 merge + 主力合约；失败则全量合约；再失败则按快照日期回退至最近一次可算出的 VOI。
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  MERGE_REL,
  mergeRootDefault,
  snapshotsRoot,
  toRepoRelative,
  type MergeStateFile,
} from './data-paths'
import { readJsonFile } from './merge-store'
import { goldOptionLastTradingDayYmd } from './cme-contract-calendar'
import {
  computeAll,
  type ComputeAllContractCore,
  type ComputeAllResult,
} from './compute/compute-all'

interface SnapshotManifest {
  run_id?: string
  created_at?: string
  cme_trade_date?: string
}

export interface InsightMetricsResolved {
  report: ComputeAllResult
  contract: ComputeAllContractCore | null
  insight_data_updated_at: string | null
  insight_voi_trade_date: string | null
  insight_stale_fallback: boolean
  insight_parsed_source: string | null
}

/**
 * 1) 主力合约且计算成功；2) 否则按 VOI 顺序第一个「仍在交易期内」且无 chart_error；
 * 3) 最后才退回任意无 chart_error（过期合约，仅作兜底）。
 */
function pickValidContract(report: ComputeAllResult): ComputeAllContractCore | null {
  const asOf = report.meta.as_of_chicago_ymd
  const byKey = new Map(report.contracts.map((c) => [c.contract, c]))

  const primary = report.meta.primary_contract
  if (primary) {
    const row = byKey.get(primary)
    if (row && !row.chart_error) {
      return row
    }
  }

  if (asOf) {
    for (const c of report.contracts) {
      const ltd = goldOptionLastTradingDayYmd(c.contract)
      const active = ltd == null || asOf <= ltd
      if (!active || c.chart_error) {
        continue
      }
      return c
    }
  }

  return report.contracts.find((c) => !c.chart_error) ?? null
}

function snapshotTradeDateSortKey(snapDir: string): string {
  const man = readJsonFile<SnapshotManifest>(path.join(snapDir, 'manifest.json'))
  if (man?.cme_trade_date && /^\d{8}$/.test(String(man.cme_trade_date))) {
    return String(man.cme_trade_date)
  }
  const name = path.basename(snapDir)
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    return m[1] + m[2] + m[3]
  }
  return '0'
}

/** 按 manifest.cme_trade_date（新→旧）尝试快照，避免仅因「同步文件夹日期新」却指向更旧 VOI 交易日 */
function listSnapshotDirsNewestVoiFirst(): string[] {
  const root = snapshotsRoot()
  if (!fs.existsSync(root)) {
    return []
  }
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => path.join(root, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'cme-voi-parsed.json')))
  return dirs.sort((a, b) => {
    const ka = snapshotTradeDateSortKey(a)
    const kb = snapshotTradeDateSortKey(b)
    const cmp = kb.localeCompare(ka)
    if (cmp !== 0) {
      return cmp
    }
    return path.basename(b).localeCompare(path.basename(a))
  })
}

function runCompute(
  spotPriceUsdPerOz: number,
  mergeRoot: string,
  extra: { contractMode: 'primary' | 'all'; cmeVoiParsedJsonPath?: string },
): ComputeAllResult | null {
  try {
    return computeAll({
      spotPriceUsdPerOz,
      mergeRoot,
      metal: 'gold',
      contractMode: extra.contractMode,
      cmeVoiParsedJsonPath: extra.cmeVoiParsedJsonPath,
    })
  } catch {
    return null
  }
}

/**
 * @param mergeRoot 已 resolve 的绝对路径
 */
export function resolveInsightMetrics(options: {
  spotPriceUsdPerOz: number
  mergeRoot: string
}): InsightMetricsResolved {
  const price = options.spotPriceUsdPerOz
  const mergeRoot = path.resolve(options.mergeRoot ?? mergeRootDefault())
  const mergeState = readJsonFile<MergeStateFile>(path.join(mergeRoot, MERGE_REL.state))

  let report: ComputeAllResult | undefined
  let contract: ComputeAllContractCore | null = null
  let insight_data_updated_at: string | null = mergeState?.updated_at ?? null
  let insight_voi_trade_date: string | null = mergeState?.cme_voi?.trade_date ?? null
  let insight_stale_fallback = false
  let insight_parsed_source: string | null = mergeState?.cme_voi?.parsed_json_path ?? null

  let r = runCompute(price, mergeRoot, { contractMode: 'primary' })
  if (r) {
    report = r
    contract = pickValidContract(r)
  }

  if (!contract) {
    r = runCompute(price, mergeRoot, { contractMode: 'all' })
    if (r) {
      report = r
      contract = pickValidContract(r)
    }
  }

  if (!contract) {
    for (const snapDir of listSnapshotDirsNewestVoiFirst()) {
      const parsedAbs = path.join(snapDir, 'cme-voi-parsed.json')
      if (!fs.existsSync(parsedAbs)) {
        continue
      }
      const rel = toRepoRelative(parsedAbs)
      r = runCompute(price, mergeRoot, {
        contractMode: 'all',
        cmeVoiParsedJsonPath: rel,
      })
      if (!r) {
        continue
      }
      const c = pickValidContract(r)
      if (c) {
        report = r
        contract = c
        insight_stale_fallback = true
        insight_parsed_source = rel
        const man = readJsonFile<SnapshotManifest>(path.join(snapDir, 'manifest.json'))
        insight_data_updated_at = man?.created_at ?? insight_data_updated_at
        insight_voi_trade_date = man?.cme_trade_date ?? insight_voi_trade_date
        break
      }
    }
  }

  if (!report) {
    throw new Error('未找到可用的 CME VOI 解析数据（merge 与 snapshots 均失败）')
  }

  return {
    report,
    contract,
    insight_data_updated_at,
    insight_voi_trade_date,
    insight_stale_fallback,
    insight_parsed_source,
  }
}
