/**
 * 期权计算：类型定义
 */

export interface ContractData {
  /** Strike price (USD) */
  strike: number
  /** Call open interest (At Close) */
  stockCall: number
  /** Put open interest (At Close) */
  stockPut: number
  /** Call open interest change */
  changeCall: number
  /** Put open interest change */
  changePut: number
  /** Call daily volume */
  volumeCall: number
  /** Put daily volume */
  volumePut: number
}

export interface ChartData {
  contract: string
  /** Spot price (USD/oz), used for intrinsic value calculation */
  spotPrice: number
  strikes: number[]
  stockCall: number[]
  stockPut: number[]
  changeCall: number[]
  changePut: number[]
  /** 各行权价 Call/Put 日成交量（与 backend/options_service.calculate_daily_metrics 的 volume_oi_ratio 一致） */
  volumeCall: number[]
  volumePut: number[]
  maxPain: number | null
  pcr: number[]
  changeRateCall: number[]
  changeRatePut: number[]
  volumeRatioCall: number[]
  volumeRatioPut: number[]
  /** Call intrinsic value = max(0, S - K) */
  intrinsicCall: number[]
  /** Put intrinsic value = max(0, K - S) */
  intrinsicPut: number[]
  /** Moneyness: 'ITM' | 'ATM' | 'OTM' */
  moneyness: ('ITM' | 'ATM' | 'OTM')[]
  /** 与 Python options_service.calculate_daily_metrics 一致 */
  dailyMetrics: DailyMetrics
  /**
   * 全市场按持仓加权的总内在价值（美元），与 options_iv_service.calculate_intrinsic_value 一致（每手×100 盎司）。
   * 标的价格取现货/收盘价。
   */
  intrinsicValueTotalUsdAtSpot: number | null
  /** 同上，标的价格取 max_pain */
  intrinsicValueTotalUsdAtMaxPain: number | null
  /** options_iv_service.calculate_delta_iv = 上两者之差（美元），非隐含波动率 */
  deltaIv: number | null
  /** options_iv_service.calculate_price_deviation_pct */
  priceDeviationPct: number | null
}

export interface KeyMetrics {
  maxPain: number | null
  totalOI: number
  totalVolume: number
  totalChange: number
  /** 与 options_service.calculate_daily_metrics 一致 */
  dailyMetrics: DailyMetrics
  deltaIv: number | null
  priceDeviationPct: number | null
  topStockCall: ContractData[]
  topStockPut: ContractData[]
  topChangeCall: ContractData[]
  topChangePut: ContractData[]
}

export interface Greeks {
  delta: number
  gamma: number
  vega: number
  theta: number
}

export interface IVResult {
  iv: number | null
  success: boolean
  error?: string
}

export interface VolatilityResult {
  callPrice: number
  putPrice: number
  callDelta: number
  putDelta: number
  gamma: number
  vega: number
  theta: number
}

/** Date range query params */
export interface DateRangeParams {
  limit_days?: number
  start_date?: string
  end_date?: string
}

/** Daily metrics result */
export interface DailyMetrics {
  total_oi: number
  total_volume: number
  total_change: number
  call_oi: number
  put_oi: number
  call_change: number
  put_change: number
  max_pain: number | null
  pcr: number | null
  max_oi_strike: number | null
  max_net_call_strike: number | null
  min_net_call_strike: number | null
}

/** CME delivery data */
export interface CMEDeliveryData {
  report_date: string
  daily_oz: number
  cumulative_oz: number
  by_type: Record<string, { daily_oz: number; cumulative_oz: number }>
  contracts: Array<{
    name: string
    type: string
    daily_total: number
    cumulative: number
    daily_oz: number
    cumulative_oz: number
    month: string
  }>
  records: Array<{
    date: string
    daily_total: number
    daily_oz: number
    cumulative_oz: number
  }>
}

/** CME warehouse stocks data */
export interface CMEStocksData {
  activity_date: string
  report_date: string | null
  registered: number
  eligible: number
  combined: number
  net_change: number
  registered_change: number
  records: Array<{
    date: string
    registered: number
    eligible: number
    combined: number
    net_change: number
  }>
  depositories: unknown[]
}

/** CME combined analysis result */
export interface CMEAnalysisResult {
  commodity: string
  delivery: CMEDeliveryData | null
  stocks: CMEStocksData | null
  metrics: {
    consumption_rate: number
    supply_demand_gap: number
    coverage_ratio: number
    outflow_rate: number
    daily_delivery_oz: number
  }
  insights: Array<{
    type: 'warning' | 'info' | 'success' | 'bullish' | 'bearish'
    title: string
    message: string
  }>
}

/** 期货现货 sync 行（期货现货数据.json） */
export interface FuturesSpotSyncRow {
  dm?: string
  name?: string
  p?: number
}

/** CME 交割 sync 行（CME 交割数据.json → records） */
export interface SyncDeliveryRecordRow {
  report_date: string
  commodity: string
  contract_type: string
  contract_name: string
  daily_total: number
  cumulative: number
  daily_oz: number
  cumulative_oz: number
  data_month?: string | null
}

/** COMEX 库存 sync 行（COMEX 库存*.json） */
export interface ComexInventorySyncRow {
  日期: string
  'COMEX库存量-吨': number
  'COMEX库存量-盎司': number
}

export interface SyncComputeContext {
  /** merge 根目录（data/merge） */
  mergeRoot: string
  metal: 'gold' | 'silver' | 'copper'
  /** 由调用方传入的现货价（美元/盎司），不从文件推断 */
  spotPrice: number
  delivery: CMEDeliveryData | null
  stocks: CMEStocksData | null
}

/** sync 阶段从 CME VOI xls 导出，供 compute 阶段只读 JSON（不再解析 xls） */
export interface CmeVoiParsedPayload {
  version: number
  sheetName: string
  sheetRows: unknown[][]
  trade_date?: string
  source_xls?: string
}
