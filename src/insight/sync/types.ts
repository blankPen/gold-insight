/**
 * Sync 模块：类型定义
 */

/** Date range query params */
export interface SyncDateRangeParams {
  limit_days?: number
  start_date?: string
  end_date?: string
}

/** EastMoney futures spot response */
export interface FuturesSpotRow {
  dm: string   // Code
  name: string // Name
  p: number    // Latest price
  zde: number  // Change amount
  zdf: number  // Change percent
  o: number    // Open
  h: number    // High
  l: number    // Low
  zjsj: number // Previous settle
  vol: number  // Volume
  ccl: number  // Open interest
  wp: number   // Bid
  np: number   // Ask
}

/** ETF hold row */
export interface ETFHoldRow {
  商品: string
  日期: string
  总库存: number
  '增持/减持': number
  总价值: number
}

/** COMEX inventory row */
export interface COMEXInventoryRow {
  序号: number
  日期: string
  'COMEX库存量-吨': number
  'COMEX库存量-盎司': number
}

/** FRED observation */
export interface FREDObservation {
  date: string
  value: number | null
}

/** COT commitment of traders row */
export interface COTRow {
  trade_date: string
  symbol: string
  producer_long: number
  producer_short: number
  swap_long: number
  swap_short: number
  managed_money_long: number
  managed_money_short: number
  other_long: number
  other_short: number
}

/** CME Metals MTD 交割通知单条记录（与 backend/cme_delivery_service.py 解析字段对齐） */
export interface CMEDeliveryRecord {
  report_date: string
  commodity: string
  contract_type: string
  contract_name: string
  daily_total: number
  cumulative: number
  oz_per_contract: number
  daily_oz: number
  cumulative_oz: number
  data_month: string | null
}
