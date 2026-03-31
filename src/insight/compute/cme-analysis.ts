/**
 * CME 交割 + 库存 联动分析
 */
import type {
  CMEDeliveryData,
  CMEAnalysisResult,
  CMEStocksData,
} from './types'

const OZ_PER_CONTRACT: Record<string, number> = {
  SILVER: 5000,
  GOLD: 100,
  COPPER: 25000,
}

/**
 * Calculate CME combined analysis (delivery + warehouse stocks).
 */
export function calculateCMEAnalysis(
  delivery: CMEDeliveryData | null,
  stocks: CMEStocksData | null,
  commodity: string = 'GOLD',
): CMEAnalysisResult {
  const result: CMEAnalysisResult = {
    commodity: commodity.toUpperCase(),
    delivery,
    stocks,
    metrics: {
      consumption_rate: 0,
      supply_demand_gap: 0,
      coverage_ratio: 0,
      outflow_rate: 0,
      daily_delivery_oz: 0,
    },
    insights: [],
  }

  if (!delivery || !stocks) return result

  const registered = stocks.registered ?? 0
  const cumulativeOz = delivery.cumulative_oz ?? 0
  const netChange = stocks.net_change ?? 0
  const dailyOz = delivery.daily_oz ?? 0

  const consumptionRate = registered > 0 ? (cumulativeOz / registered) * 100 : 0
  const supplyDemandGap = netChange - dailyOz
  const coverageRatio = cumulativeOz > 0 ? registered / cumulativeOz : 0
  const outflowRate = stocks.combined > 0 ? (netChange / stocks.combined) * 100 : 0

  result.metrics = {
    consumption_rate: Math.round(consumptionRate * 100) / 100,
    supply_demand_gap: supplyDemandGap,
    coverage_ratio: Math.round(coverageRatio * 100) / 100,
    outflow_rate: Math.round(outflowRate * 1000) / 1000,
    daily_delivery_oz: dailyOz,
  }

  if (consumptionRate > 30) {
    result.insights.push({
      type: 'warning',
      title: '交割消耗率偏高',
      message: `月累计交割已消耗注册仓单的 ${consumptionRate.toFixed(1)}%，交割需求强劲`,
    })
  } else if (consumptionRate > 15) {
    result.insights.push({
      type: 'info',
      title: '交割活动正常',
      message: `交割消耗率 ${consumptionRate.toFixed(1)}%，处于正常水平`,
    })
  } else {
    result.insights.push({
      type: 'success',
      title: '仓单充足',
      message: `交割消耗率 ${consumptionRate.toFixed(1)}% 偏低，注册仓单储备充足`,
    })
  }

  if (netChange < 0 && dailyOz > 0) {
    result.insights.push({
      type: 'bearish',
      title: '实物需求强劲',
      message: '库存净流出 + 交割活跃，实物市场需求旺盛，对价格形成支撑',
    })
  } else if (netChange > 0) {
    result.insights.push({
      type: 'bullish',
      title: '供应增加',
      message: '库存净流入，实物供应增加',
    })
  }

  if (supplyDemandGap < 0) {
    result.insights.push({
      type: 'info',
      title: '存在非交割出库',
      message: '库存变动超过交割量，可能存在ETF赎回或实物转移',
    })
  }

  return result
}
