/**
 * 期权链图表数据与 KeyMetrics 聚合入口
 */
import type { ChartData, CmeVoiParsedPayload, ContractData, KeyMetrics } from './types'
import { parseCMEExcel, parseCMEExcelFromPayload } from './excel-parse'
import {
  calculateMaxPain,
  calculatePCR,
  calculateChangeRate,
  calculateVolumeRatio,
  calculateDailyMetrics,
  calculateCallIntrinsicValue,
  calculatePutIntrinsicValue,
  calculateMoneyness,
  calculateIntrinsicValue,
  calculatePriceDeviationPct,
} from './option-metrics'

function buildChartDataFromCallsPuts(
  contractKey: string,
  spotPrice: number,
  calls: ContractData[],
  puts: ContractData[],
): ChartData {
  const strikeMap = new Map<number, ContractData>()

  for (const c of calls) {
    strikeMap.set(c.strike, { ...c, stockPut: 0, changePut: 0, volumePut: 0 })
  }
  for (const p of puts) {
    const existing = strikeMap.get(p.strike)
    if (existing) {
      existing.stockPut = p.stockCall
      existing.changePut = p.changeCall
      existing.volumePut = p.volumeCall
    } else {
      strikeMap.set(p.strike, {
        strike: p.strike,
        stockCall: 0,
        stockPut: p.stockCall,
        changeCall: 0,
        changePut: p.changeCall,
        volumeCall: 0,
        volumePut: p.volumeCall,
      })
    }
  }

  const sorted = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike)

  const strikes = sorted.map((r) => r.strike)
  const stockCalls = sorted.map((r) => r.stockCall)
  const stockPuts = sorted.map((r) => r.stockPut)
  const changeCalls = sorted.map((r) => r.changeCall)
  const changePuts = sorted.map((r) => r.changePut)
  const volumeCalls = sorted.map((r) => r.volumeCall)
  const volumePuts = sorted.map((r) => r.volumePut)

  const maxPain = calculateMaxPain(strikes, stockCalls, stockPuts)
  const pcr = calculatePCR(stockCalls, stockPuts)
  const changeRateCall = calculateChangeRate(changeCalls, stockCalls)
  const changeRatePut = calculateChangeRate(changePuts, stockPuts)
  const volumeRatioCall = calculateVolumeRatio(volumeCalls, stockCalls)
  const volumeRatioPut = calculateVolumeRatio(volumePuts, stockPuts)

  const volumeOiRatio = sorted.map((r) => ({
    volume_call: r.volumeCall,
    volume_put: r.volumePut,
  }))
  const dailyMetrics = calculateDailyMetrics({
    x: strikes,
    stock_call: stockCalls,
    stock_put: stockPuts,
    change_call: changeCalls,
    change_put: changePuts,
    max_pain: maxPain ?? undefined,
    volume_oi_ratio: volumeOiRatio,
  })

  const lensOk =
    strikes.length > 0 &&
    stockCalls.length === strikes.length &&
    stockPuts.length === strikes.length

  let intrinsicValueTotalUsdAtSpot: number | null = null
  let intrinsicValueTotalUsdAtMaxPain: number | null = null
  let deltaIv: number | null = null
  let priceDeviationPct: number | null = null

  if (lensOk) {
    intrinsicValueTotalUsdAtSpot = calculateIntrinsicValue(
      strikes,
      stockCalls,
      stockPuts,
      spotPrice,
    )
    if (maxPain != null && !Number.isNaN(maxPain)) {
      intrinsicValueTotalUsdAtMaxPain = calculateIntrinsicValue(
        strikes,
        stockCalls,
        stockPuts,
        maxPain,
      )
      deltaIv =
        intrinsicValueTotalUsdAtSpot - intrinsicValueTotalUsdAtMaxPain
    }
  }

  if (maxPain != null && maxPain !== 0 && !Number.isNaN(maxPain)) {
    priceDeviationPct = calculatePriceDeviationPct(spotPrice, maxPain)
  }

  const intrinsicCall = calculateCallIntrinsicValue(spotPrice, strikes)
  const intrinsicPut = calculatePutIntrinsicValue(spotPrice, strikes)
  const moneyness = calculateMoneyness(spotPrice, strikes)

  return {
    contract: contractKey,
    spotPrice,
    strikes,
    stockCall: stockCalls,
    stockPut: stockPuts,
    changeCall: changeCalls,
    changePut: changePuts,
    volumeCall: volumeCalls,
    volumePut: volumePuts,
    maxPain,
    pcr,
    changeRateCall,
    changeRatePut,
    volumeRatioCall,
    volumeRatioPut,
    intrinsicCall,
    intrinsicPut,
    moneyness,
    dailyMetrics,
    intrinsicValueTotalUsdAtSpot,
    intrinsicValueTotalUsdAtMaxPain,
    deltaIv,
    priceDeviationPct,
  }
}

/**
 * Parse and compute all chart data from Excel file.
 */
export async function computeChartData(
  filePath: string,
  contractKey: string,
  spotPrice: number = 0,
): Promise<ChartData> {
  const { calls, puts } = await parseCMEExcel(filePath, contractKey)
  return buildChartDataFromCallsPuts(contractKey, spotPrice, calls, puts)
}

/**
 * 从 sync 产出的 CME VOI JSON 计算图表（compute 阶段不读 xls）.
 */
export function computeChartDataFromPayload(
  payload: CmeVoiParsedPayload,
  contractKey: string,
  spotPrice: number = 0,
): ChartData {
  const { calls, puts } = parseCMEExcelFromPayload(payload, contractKey)
  return buildChartDataFromCallsPuts(contractKey, spotPrice, calls, puts)
}

/**
 * Calculate key metrics (Top N OI / change).
 */
export async function computeKeyMetrics(
  filePath: string,
  contractKey: string,
  topN: number = 5,
  spotPrice: number = 0,
): Promise<KeyMetrics> {
  const chartData = await computeChartData(filePath, contractKey, spotPrice)

  const rows: ContractData[] = chartData.strikes.map((strike, i) => ({
    strike,
    stockCall: chartData.stockCall[i],
    stockPut: chartData.stockPut[i],
    changeCall: chartData.changeCall[i],
    changePut: chartData.changePut[i],
    volumeCall: chartData.volumeCall[i] ?? 0,
    volumePut: chartData.volumePut[i] ?? 0,
  }))

  const sortedByCall = [...rows].sort((a, b) => b.stockCall - a.stockCall)
  const sortedByPut = [...rows].sort((a, b) => b.stockPut - a.stockPut)
  const sortedByChangeCall = [...rows].sort((a, b) => Math.abs(b.changeCall) - Math.abs(a.changeCall))
  const sortedByChangePut = [...rows].sort((a, b) => Math.abs(b.changePut) - Math.abs(a.changePut))

  const totalOI =
    chartData.stockCall.reduce((a, b) => a + b, 0) +
    chartData.stockPut.reduce((a, b) => a + b, 0)
  const totalChange =
    chartData.changeCall.reduce((a, b) => a + b, 0) +
    chartData.changePut.reduce((a, b) => a + b, 0)
  const totalVolume = chartData.dailyMetrics.total_volume

  return {
    maxPain: chartData.maxPain,
    totalOI,
    totalVolume,
    totalChange,
    dailyMetrics: chartData.dailyMetrics,
    deltaIv: chartData.deltaIv,
    priceDeviationPct: chartData.priceDeviationPct,
    topStockCall: sortedByCall.slice(0, topN),
    topStockPut: sortedByPut.slice(0, topN),
    topChangeCall: sortedByChangeCall.slice(0, topN),
    topChangePut: sortedByChangePut.slice(0, topN),
  }
}
