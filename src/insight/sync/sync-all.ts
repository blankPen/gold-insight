/**
 * Sync 模块：一键同步入口（委托 sync-pipeline）
 */
import { runFullSync } from './sync-pipeline'

export async function syncAll(options: {
  cme?: boolean
  futures?: boolean
  etf?: boolean
  comex?: boolean
  cot?: boolean
  fred?: boolean
  delivery?: boolean
  mergeRoot?: string
  cmeTradeDate?: string
  fredSeriesId?: string
  deliveryCommodity?: string
} = {}): Promise<Record<string, unknown>> {
  const {
    cme = true,
    futures = true,
    etf = true,
    comex = true,
    cot = false,
    fred = false,
    delivery = false,
    mergeRoot,
    cmeTradeDate,
    fredSeriesId = 'DGS10',
    deliveryCommodity = 'GOLD',
  } = options

  try {
    const r = await runFullSync({
      cme,
      futures,
      etf,
      comex,
      cot,
      fred,
      delivery,
      mergeRoot,
      cmeTradeDate,
      fredSeriesId,
      deliveryCommodity,
    })
    return { success: true, ...r }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
