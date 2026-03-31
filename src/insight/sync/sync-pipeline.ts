/**
 * 一次完整 sync：snapshots/<YYYY-MM-DD> 原始文件 + merge/ 合并 + _state
 */
import * as path from 'path'
import {
  makeSnapshotRunId,
  mergePath,
  mergeRootDefault,
  MERGE_REL,
  snapshotRunDir,
  toRepoRelative,
  type MergeStateFile,
} from '../data-paths'
import {
  ensureDir,
  mergeComexOrEtfRows,
  mergeCotRows,
  mergeDeliveryRecords,
  mergeFredObservations,
  mergeKlineRows,
  readJsonFile,
  writeJsonFile,
} from '../merge-store'
import { exportCmeVoiParsedFromXls } from '../compute/excel-parse'
import { downloadCMEVoiXls } from './cme-voi'
import { syncCOMEXInventory } from './comex'
import { syncCOT } from './cot'
import { syncCMEDelivery } from './cme-delivery'
import { syncETFGoldHold, syncETFSilverHold } from './etf'
import { syncFRED } from './fred'
import { syncFuturesHist, syncFuturesSpot } from './futures'
import type { CMEDeliveryRecord } from './types'

export interface RunFullSyncOptions {
  mergeRoot?: string
  /** CME VOI 报告日 YYYYMMDD，默认 UTC 当日 */
  cmeTradeDate?: string
  fredSeriesId?: string
  deliveryCommodity?: string
  cme?: boolean
  futures?: boolean
  etf?: boolean
  comex?: boolean
  cot?: boolean
  fred?: boolean
  delivery?: boolean
}

function validateCmeTradeDate(tradeDate?: string): string {
  let today = new Date()
  let date = tradeDate ? new Date(tradeDate) : new Date()
  // 如果是今天，则往前推到最近的一个交易日
  if (date.toISOString().slice(0, 10).replace(/-/g, '') === today.toISOString().slice(0, 10).replace(/-/g, '')) {
    date.setDate(date.getDate() - 1)
  }

  // 这里要过滤周六周天，如果是周末，则往前推到最近的一个交易日
  const day = date.getDay()
  if (day === 0) {
    date.setDate(date.getDate() - 2)
  } else if (day === 6) {
    date.setDate(date.getDate() - 1)
  }
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function writeRawSnapshot(snapDir: string, name: string, data: unknown): void {
  const rawDir = path.join(snapDir, 'raw')
  ensureDir(rawDir)
  writeJsonFile(path.join(rawDir, name), data)
}

export async function runFullSync(
  options: RunFullSyncOptions = {},
): Promise<{ runId: string; mergeRoot: string }> {
  const mergeRoot = options.mergeRoot ?? mergeRootDefault()
  const runId = makeSnapshotRunId()
  const snapDir = snapshotRunDir(runId)
  ensureDir(snapDir)


  const cmeTradeDate = validateCmeTradeDate(options.cmeTradeDate)

  console.log(`[sync] cmeTradeDate=${cmeTradeDate}`)

  const fredSeriesId = options.fredSeriesId ?? 'DGS10'

  const SyncFuncs = {
    futures: async () => {
      const spot = await syncFuturesSpot()
      writeRawSnapshot(snapDir, 'futures-spot.json', spot)
      writeJsonFile(mergePath(mergeRoot, MERGE_REL.futuresSpot), spot)
      const hist = await syncFuturesHist('GC00Y')
      writeRawSnapshot(snapDir, 'futures-kline-GC00Y.json', hist)
      const kPath = mergePath(mergeRoot, MERGE_REL.futuresKlineDir, 'GC00Y.json')
      const prevK = readJsonFile<Array<{ date: string }>>(kPath) ?? []
      writeJsonFile(kPath, mergeKlineRows(prevK, hist))
    },
    gold_etf: async () => {
      const eg = await syncETFGoldHold({ limit_days: 365 })
      writeRawSnapshot(snapDir, 'etf-gold.json', eg)
      const p = mergePath(mergeRoot, MERGE_REL.etfGold)
      const prev = readJsonFile<typeof eg>(p) ?? []
      writeJsonFile(p, mergeComexOrEtfRows(prev, eg))
    },
    silver_etf: async () => {
      const es = await syncETFSilverHold({ limit_days: 365 })
      writeRawSnapshot(snapDir, 'etf-silver.json', es)
      const p = mergePath(mergeRoot, MERGE_REL.etfSilver)
      const prev = readJsonFile<typeof es>(p) ?? []
      writeJsonFile(p, mergeComexOrEtfRows(prev, es))
    },
    comex_gold: async () => {
      const cg = await syncCOMEXInventory('黄金', { limit_days: 365 })
      writeRawSnapshot(snapDir, 'comex-gold.json', cg)
      const p = mergePath(mergeRoot, MERGE_REL.comexGold)
      const prev = readJsonFile<typeof cg>(p) ?? []
      writeJsonFile(p, mergeComexOrEtfRows(prev, cg))
    },
    comex_silver: async () => {
      const cs = await syncCOMEXInventory('白银', { limit_days: 365 })
      writeRawSnapshot(snapDir, 'comex-silver.json', cs)
      const p = mergePath(mergeRoot, MERGE_REL.comexSilver)
      const prev = readJsonFile<typeof cs>(p) ?? []
      writeJsonFile(p, mergeComexOrEtfRows(prev, cs))
    },
    gold_cot: async () => {
      const year = new Date().getFullYear()
      const cotRows = await syncCOT(year, 'GOLD')
      writeRawSnapshot(snapDir, `cot-GOLD-${year}.json`, cotRows)
      const cp = mergePath(mergeRoot, MERGE_REL.cotDir, 'GOLD.json')
      ensureDir(path.dirname(cp))
      const prevC = readJsonFile<typeof cotRows>(cp) ?? []
      writeJsonFile(cp, mergeCotRows(prevC, cotRows))
    },
    silver_cot: async () => {
      const year = new Date().getFullYear()
      const cotRows = await syncCOT(year, 'SILVER')
      writeRawSnapshot(snapDir, `cot-SILVER-${year}.json`, cotRows)
      const cp = mergePath(mergeRoot, MERGE_REL.cotDir, 'SILVER.json')
      ensureDir(path.dirname(cp))
      const prevC = readJsonFile<typeof cotRows>(cp) ?? []
      writeJsonFile(cp, mergeCotRows(prevC, cotRows))
    },
    fred: async () => {
      const fred = await syncFRED(fredSeriesId)
      writeRawSnapshot(snapDir, `fred-${fredSeriesId}.json`, fred)
      const fp = mergePath(mergeRoot, MERGE_REL.fredDir, `${fredSeriesId}.json`)
      ensureDir(path.dirname(fp))
      const prevF = readJsonFile<typeof fred>(fp) ?? []
      writeJsonFile(fp, mergeFredObservations(prevF, fred))
    },
    gold_delivery: async () => {
      const deliveryCommodity = 'GOLD'
      const del = await syncCMEDelivery(deliveryCommodity)
      writeRawSnapshot(snapDir, `cme-delivery-${deliveryCommodity}.json`, del)
      if (del?.records?.length) {
        const dp = mergePath(mergeRoot, MERGE_REL.deliveryRecords)
        const prevD = readJsonFile<{ records: CMEDeliveryRecord[] }>(dp)
        const prevRecs = prevD?.records ?? []
        const mergedRecs = mergeDeliveryRecords(prevRecs, del.records)
        writeJsonFile(dp, {
          run_date: del.run_date,
          run_date_raw: del.run_date_raw,
          source_url: del.source_url,
          records: mergedRecs,
        })
      }
    },
    silver_delivery: async () => {
      const deliveryCommodity = 'SILVER'
      const del = await syncCMEDelivery(deliveryCommodity)
      writeRawSnapshot(snapDir, `cme-delivery-${deliveryCommodity}.json`, del)
      if (del?.records?.length) {
        const dp = mergePath(mergeRoot, MERGE_REL.deliveryRecords)
        const prevD = readJsonFile<{ records: CMEDeliveryRecord[] }>(dp)
        const prevRecs = prevD?.records ?? []
        const mergedRecs = mergeDeliveryRecords(prevRecs, del.records)
        writeJsonFile(dp, {
          run_date: del.run_date,
          run_date_raw: del.run_date_raw,
          source_url: del.source_url,
          records: mergedRecs,
        })
      }
    },
    cme_voi: async () => {

      let cmeXlsRel = ''
      let cmeParsedRel = ''

      const xlsName = `cme-voi-${cmeTradeDate}.xls`
      const xlsAbs = path.join(snapDir, xlsName)
      await downloadCMEVoiXls({ tradeDate: cmeTradeDate, outputPath: xlsAbs })

      cmeXlsRel = toRepoRelative(xlsAbs)

      let parsedPayload
      try {
        parsedPayload = await exportCmeVoiParsedFromXls(xlsAbs, {
          trade_date: cmeTradeDate,
          source_xls: cmeXlsRel,
        })
      } catch (e) {
        console.error('[sync] CME VOI xls 解析失败:', e)
        process.exitCode = 1
        throw e
      }

      const parsedAbs = mergePath(mergeRoot, MERGE_REL.cmeVoiParsed)
      ensureDir(path.dirname(parsedAbs))
      writeJsonFile(parsedAbs, parsedPayload)
      cmeParsedRel = toRepoRelative(parsedAbs)

      writeJsonFile(path.join(snapDir, 'cme-voi-parsed.json'), parsedPayload)

      writeJsonFile(path.join(snapDir, 'manifest.json'), {
        run_id: runId,
        created_at: new Date().toISOString(),
        cme_trade_date: cmeTradeDate,
        files: { cme_xls: cmeXlsRel, cme_parsed_merge: cmeParsedRel },
      })

      return {
        cmeXlsRel,
        cmeParsedRel,
      }
    }
  };
  // }

  await SyncFuncs.futures();
  await SyncFuncs.gold_etf();
  await SyncFuncs.silver_etf();
  await SyncFuncs.comex_gold();
  await SyncFuncs.comex_silver();
  await SyncFuncs.gold_cot();
  await SyncFuncs.silver_cot();
  await SyncFuncs.fred();
  await SyncFuncs.gold_delivery();
  await SyncFuncs.silver_delivery();
  const { cmeXlsRel, cmeParsedRel } = await SyncFuncs.cme_voi();

  const prevState = readJsonFile<MergeStateFile>(
    mergePath(mergeRoot, MERGE_REL.state),
  )
  const state: MergeStateFile = {
    last_snapshot_id: runId,
    updated_at: new Date().toISOString(),
  }
  if (cmeXlsRel && cmeParsedRel) {
    state.cme_voi = {
      xls_path: cmeXlsRel,
      parsed_json_path: cmeParsedRel,
      trade_date: cmeTradeDate,
    }
  } else if (prevState?.cme_voi) {
    state.cme_voi = prevState.cme_voi
  }
  writeJsonFile(mergePath(mergeRoot, MERGE_REL.state), state)

  console.log(`[sync] runId=${runId} snapshot=${snapDir}`)
  return { runId, mergeRoot }
}
