/**
 * 基于 merge/ 与 CME VOI 预解析 JSON 的整包计算（不在此读 xls）
 */
import * as fs from 'fs'
import * as path from 'path'
import { MERGE_REL, mergeRootDefault, type MergeStateFile } from '../data-paths'
import { readJsonFile } from '../merge-store'
import type { ChartData, CMEAnalysisResult, DailyMetrics } from './types'
import { calculateCMEAnalysis } from './cme-analysis'
import { computeChartDataFromPayload } from './chart'
import {
  calculateDeltaNeutralStrike,
  calculateGammaWeightedStrike,
  calculateNetDeltaZeroStrike,
} from './strike-structure'
import { discoverContractsFromPayload, parseCmeVoiParsedJson } from './excel-parse'
import { loadMergeComputeContext } from './sync-context'
import {
  formatChicagoYmd,
  selectPrimaryGoldOptionContract,
} from '../cme-contract-calendar'

export interface ComputeAllOptions {
  spotPriceUsdPerOz: number
  metal?: 'gold' | 'silver' | 'copper'
  /** 覆盖 merge/_state 中的 parsed_json_path */
  cmeVoiParsedJsonPath?: string
  mergeRoot?: string
  /** all: 每个识别到的合约；primary: 仅当前芝加哥业务日下仍有效的最近月合约 */
  contractMode?: 'all' | 'primary'
  /** 覆盖「当前」芝加哥日，用于测试；默认今天 */
  primaryAsOfChicagoYmd?: string
}

export interface ComputeAllContractCore {
  contract: string
  spot_price: number
  max_pain: number | null
  intrinsic_call_at_max_pain: number | null
  intrinsic_put_at_max_pain: number | null
  atm_strike: number | null
  intrinsic_call_at_atm: number | null
  intrinsic_put_at_atm: number | null
  delta_neutral_strike: number | null
  gamma_weighted_strike: number | null
  net_delta_zero_strike: number | null
  intrinsic_value_total_usd_at_spot: number | null
  intrinsic_value_total_usd_at_max_pain: number | null
  delta_iv: number | null
  price_deviation_pct: number | null
  daily: DailyMetrics | null
  chart_error?: string
}

export interface ComputeAllCmeSummary {
  commodity: string
  metrics: CMEAnalysisResult['metrics']
  insights: CMEAnalysisResult['insights']
}

export interface ComputeAllResult {
  meta: {
    generated_at: string
    merge_root: string
    metal: string
    spot_price_input: number
    cme_voi_parsed_json: string
    cme_xls?: string
    primary_contract?: string
    primary_contract_ltd?: string
    primary_pick_warning?: string
    contract_mode?: 'all' | 'primary'
    as_of_chicago_ymd?: string
  }
  cme_delivery_summary: ComputeAllCmeSummary | null
  warnings: string[]
  contracts_discovered: string[]
  contracts: ComputeAllContractCore[]
  total_ms: number
}

function nearestStrikeIndex(strikes: number[], target: number): number {
  if (strikes.length === 0) {
    return -1
  }
  let best = 0
  let bestD = Math.abs(strikes[0]! - target)
  for (let i = 1; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - target)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function strikeIndexForMaxPain(
  strikes: number[],
  maxPain: number | null,
): number {
  if (strikes.length === 0 || maxPain == null) {
    return -1
  }
  const exact = strikes.indexOf(maxPain)
  if (exact >= 0) {
    return exact
  }
  return nearestStrikeIndex(strikes, maxPain)
}

function buildContractCoreFromChart(
  contractKey: string,
  chart: ChartData,
  deltaNeutral: number | null,
  gammaWeighted: number | null,
  netDeltaZero: number | null,
): ComputeAllContractCore {
  const { strikes, spotPrice, maxPain, intrinsicCall, intrinsicPut } = chart
  const iMp = strikeIndexForMaxPain(strikes, maxPain)
  const iAtm = nearestStrikeIndex(strikes, spotPrice)

  return {
    contract: contractKey,
    spot_price: spotPrice,
    max_pain: maxPain,
    intrinsic_call_at_max_pain:
      iMp >= 0 ? intrinsicCall[iMp] ?? null : null,
    intrinsic_put_at_max_pain:
      iMp >= 0 ? intrinsicPut[iMp] ?? null : null,
    atm_strike: iAtm >= 0 ? strikes[iAtm] ?? null : null,
    intrinsic_call_at_atm:
      iAtm >= 0 ? intrinsicCall[iAtm] ?? null : null,
    intrinsic_put_at_atm:
      iAtm >= 0 ? intrinsicPut[iAtm] ?? null : null,
    delta_neutral_strike: deltaNeutral,
    gamma_weighted_strike: gammaWeighted,
    net_delta_zero_strike: netDeltaZero,
    intrinsic_value_total_usd_at_spot: chart.intrinsicValueTotalUsdAtSpot,
    intrinsic_value_total_usd_at_max_pain: chart.intrinsicValueTotalUsdAtMaxPain,
    delta_iv: chart.deltaIv,
    price_deviation_pct: chart.priceDeviationPct,
    daily: chart.dailyMetrics,
  }
}

export function computeAll(options: ComputeAllOptions): ComputeAllResult {
  const tAll = Date.now()
  const mergeRoot = path.resolve(options.mergeRoot ?? mergeRootDefault())
  const metal = options.metal ?? 'gold'
  const spot = options.spotPriceUsdPerOz

  let relParsed = options.cmeVoiParsedJsonPath
  const state = readJsonFile<MergeStateFile>(
    path.join(mergeRoot, MERGE_REL.state),
  )
  if (!relParsed) {
    relParsed = state?.cme_voi?.parsed_json_path
  }
  if (!relParsed) {
    throw new Error(
      '未找到 CME VOI 解析 JSON：请先执行 --sync 或传入 cmeVoiParsedJsonPath',
    )
  }

  const absParsed = path.resolve(process.cwd(), relParsed)
  if (!fs.existsSync(absParsed)) {
    throw new Error(`CME VOI 解析 JSON 不存在: ${absParsed}`)
  }

  const payload = parseCmeVoiParsedJson(fs.readFileSync(absParsed, 'utf8'))
  if (payload == null) {
    throw new Error(`无效的 CME VOI JSON: ${absParsed}`)
  }

  const ctx = loadMergeComputeContext(mergeRoot, metal, spot)
  const warnings: string[] = []

  let cmeDeliveryInventory: CMEAnalysisResult | null = null
  if (ctx.delivery && ctx.stocks) {
    const commodity =
      metal === 'gold' ? 'GOLD' : metal === 'silver' ? 'SILVER' : 'COPPER'
    cmeDeliveryInventory = calculateCMEAnalysis(
      ctx.delivery,
      ctx.stocks,
      commodity,
    )
  } else {
    warnings.push(
      '交割或 COMEX merge 数据缺失，cme_delivery_summary 为 null；请执行带 delivery/comex 的 sync',
    )
  }

  const contractsDiscovered = discoverContractsFromPayload(payload)
  if (contractsDiscovered.length === 0) {
    warnings.push(
      '未从解析 JSON 识别到期权合约（可能为空 VOI 或 tradeDate 非交易日）。',
    )
  }

  const contractMode = options.contractMode ?? 'all'
  const asOfChicagoYmd =
    options.primaryAsOfChicagoYmd ?? formatChicagoYmd(new Date())
  let primaryPick = selectPrimaryGoldOptionContract(
    contractsDiscovered,
    asOfChicagoYmd,
  )
  let contractsToCompute =
    contractMode === 'primary' && primaryPick.primary
      ? [primaryPick.primary]
      : [...contractsDiscovered]

  if (contractMode === 'primary' && contractsDiscovered.length > 0 && !primaryPick.primary) {
    contractsToCompute = [...contractsDiscovered]
    warnings.push('primary_contract_pick_failed_computing_all_discovered')
  }

  if (primaryPick.warning) {
    warnings.push(primaryPick.warning)
  }

  const reportContracts: ComputeAllContractCore[] = []

  for (const contractKey of contractsToCompute) {
    const emptyCore = (
      partial: Partial<ComputeAllContractCore>,
    ): ComputeAllContractCore => ({
      contract: contractKey,
      spot_price: spot,
      max_pain: null,
      intrinsic_call_at_max_pain: null,
      intrinsic_put_at_max_pain: null,
      atm_strike: null,
      intrinsic_call_at_atm: null,
      intrinsic_put_at_atm: null,
      delta_neutral_strike: null,
      gamma_weighted_strike: null,
      net_delta_zero_strike: null,
      intrinsic_value_total_usd_at_spot: null,
      intrinsic_value_total_usd_at_max_pain: null,
      delta_iv: null,
      price_deviation_pct: null,
      daily: null,
      ...partial,
    })

    let chart: ChartData
    try {
      chart = computeChartDataFromPayload(payload, contractKey, spot)
    } catch (err) {
      reportContracts.push(emptyCore({ chart_error: String(err) }))
      continue
    }

    const { strikes, stockCall: sc, stockPut: sp } = chart
    const dns = calculateDeltaNeutralStrike(strikes, sc, sp, spot)
    const gws = calculateGammaWeightedStrike(strikes, sc, sp, spot)
    const ndz = calculateNetDeltaZeroStrike(strikes, sc, sp)

    reportContracts.push(
      buildContractCoreFromChart(contractKey, chart, dns, gws, ndz),
    )
  }

  const cmeDeliverySummary: ComputeAllCmeSummary | null =
    cmeDeliveryInventory == null
      ? null
      : {
          commodity: cmeDeliveryInventory.commodity,
          metrics: cmeDeliveryInventory.metrics,
          insights: cmeDeliveryInventory.insights,
        }

  return {
    meta: {
      generated_at: new Date().toISOString(),
      merge_root: mergeRoot,
      metal,
      spot_price_input: spot,
      cme_voi_parsed_json: relParsed,
      cme_xls: state?.cme_voi?.xls_path,
      primary_contract: primaryPick.primary ?? undefined,
      primary_contract_ltd: primaryPick.primary_ltd ?? undefined,
      primary_pick_warning: primaryPick.warning,
      contract_mode: contractMode,
      as_of_chicago_ymd: asOfChicagoYmd,
    },
    cme_delivery_summary: cmeDeliverySummary,
    warnings,
    contracts_discovered: contractsDiscovered,
    contracts: reportContracts,
    total_ms: Date.now() - tAll,
  }
}

function fmtMetric(n: number | null | undefined, frac = 4): string {
  if (n == null || Number.isNaN(n)) {
    return '—'
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(frac)
}

const METAL_ZH: Record<string, string> = {
  gold: '黄金',
  silver: '白银',
  copper: '铜',
}

/** 控制台：中文说明 + 本次 report 实际数值 */
export function logComputeAllResult(report: ComputeAllResult): void {
  const { meta, cme_delivery_summary: cme, warnings, contracts_discovered: discovered, contracts, total_ms } =
    report

  console.log('\n━━━━━━━━ 计算结果（中文说明 + 数据）━━━━━━━━')

  console.log('\n【元数据】')
  console.log(`  生成时间（generated_at）：${meta.generated_at}`)
  console.log(`  merge 根目录（merge_root）：${meta.merge_root}`)
  console.log(`  CME VOI JSON（cme_voi_parsed_json）：${meta.cme_voi_parsed_json}`)
  if (meta.cme_xls) {
    console.log(`  原始 xls 路径（cme_xls）：${meta.cme_xls}`)
  }
  console.log(
    `  品种（metal）：${meta.metal}（${METAL_ZH[meta.metal] ?? meta.metal}）`,
  )
  console.log(
    `  现货价入参（spot_price_input，美元/盎司）：${fmtMetric(meta.spot_price_input, 2)}`,
  )
  console.log(`  总耗时（total_ms）：${total_ms} ms`)

  console.log('\n【提示与合约列表】')
  if (warnings.length === 0) {
    console.log('  warnings：（无）')
  } else {
    warnings.forEach((w, i) => console.log(`  warnings[${i}]：${w}`))
  }
  console.log(
    `  识别到的到期合约（contracts_discovered，共 ${discovered.length} 个）：${discovered.join('、')}`,
  )

  console.log('\n【交割与库存联动摘要 cme_delivery_summary】')
  if (cme == null) {
    console.log('  （无数据）')
  } else {
    const m = cme.metrics
    const strs = [
      `品种（commodity）：${cme.commodity}`,
      `消耗率 consumption_rate（%）：${fmtMetric(m.consumption_rate, 2)}`,
      `供需缺口 supply_demand_gap：${fmtMetric(m.supply_demand_gap, 2)}`,
      `覆盖率 coverage_ratio（%）：${fmtMetric(m.coverage_ratio, 2)}`,
      `库存净流出率 outflow_rate（%）：${fmtMetric(m.outflow_rate, 3)}`,
      `当日交割盎司 daily_delivery_oz：${m.daily_delivery_oz}`,
      `可读结论（insights）：`,
      cme.insights.map((ins, i) => {
        return `    [${i + 1}] ${ins.title}（${ins.type}）：${ins.message}`
      }).join('\n'),
    ]
    console.log(strs.join('\n'))
  }

  console.log('\n【按到期合约的核心期权指标 contracts】')
  const rows = []
  for (const row of contracts) {
    if (row.chart_error) {
      continue
    }

    const d = row.daily
    const obj: Record<string, unknown> = {
      '现货价': fmtMetric(row.spot_price, 2),
      '最大痛苦价值': fmtMetric(row.max_pain, 0),
      '现货相对最大痛苦偏离（%）': fmtMetric(row.price_deviation_pct, 4),
      '在最大痛苦行权价上的内在价值-Call': fmtMetric(row.intrinsic_call_at_max_pain, 2),
      '在最大痛苦行权价上的内在价值-Put': fmtMetric(row.intrinsic_put_at_max_pain, 2),
      '最接近现货的行权价': fmtMetric(row.atm_strike, 0),
      'Delta 中性行权价': fmtMetric(row.delta_neutral_strike, 2),
      'Gamma 加权中心': fmtMetric(row.gamma_weighted_strike, 2),
      '净Delta为零行权价': fmtMetric(row.net_delta_zero_strike, 0),
      '现货价下总内在价值（百万美元）': fmtMetric(row.intrinsic_value_total_usd_at_spot! / 1e6, 2),
      'MaxPain 价下总内在价值（百万美元）': fmtMetric(
        row.intrinsic_value_total_usd_at_max_pain! / 1e6,
        2,
      ),
      '总内在价值差（百万美元）': fmtMetric(row.delta_iv! / 1e6, 2),
    }
    if (d) {
      obj.daily = {
        '总持仓': d.total_oi,
        '总成交量': d.total_volume,
        '持仓总变动': d.total_change,
        'Call 持仓': d.call_oi,
        'Put 持仓': d.put_oi,
        'Call 变动': d.call_change,
        'Put 变动': d.put_change,
      }
    }

    rows.push({
      合约: row.contract,
      ...obj,
    })
  }
  console.log(rows)
}
