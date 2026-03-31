/**
 * Sync 模块：东方财富期货现货 / K 线
 */
import type { FuturesSpotRow, SyncDateRangeParams } from './types'
import { httpGet } from './http'

/**
 * Fetch EastMoney COMEX precious metals futures spot data.
 * Data source: https://futsseapi.eastmoney.com/list/COMEX
 */
export async function syncFuturesSpot(
  metals?: string[],
  main_contract_only: boolean = true,
): Promise<FuturesSpotRow[]> {

  const targetMetals = metals ?? ['GC', 'SI', 'HG']
  const url = new URL('https://futsseapi.eastmoney.com/list/COMEX')
  url.searchParams.set('orderBy', 'vol')
  url.searchParams.set('sort', 'desc')
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('pageIndex', '0')
  url.searchParams.set('token', '58b2fa8f54638b60b87d69b31969089c')
  url.searchParams.set('field', 'dm,sc,name,p,zsjd,zde,zdf,f152,o,h,l,zjsj,vol,wp,np,ccl')

  const parsed: any = await httpGet(url.toString(), { useBrowserHeaders: true, referer: 'https://quote.eastmoney.com/' })
  const list: Array<Record<string, unknown>> = parsed.list ?? []
  // Filter by metal code prefix
  let filtered = list.filter((item) => {
    const dm = String(item.dm ?? '')
    const prefix = dm.slice(0, 2).toUpperCase()
    return targetMetals.map((m) => m.toUpperCase()).includes(prefix)
  })

  // Filter main contract (00Y suffix)
  if (main_contract_only) {
    filtered = filtered.filter((item) => {
      const dm = String(item.dm ?? '')
      return dm.endsWith('00Y')
    })
  }

  return filtered as unknown as FuturesSpotRow[]
}

/**
 * Fetch EastMoney international futures historical data.
 * Data source: https://push2his.eastmoney.com/api/qt/stock/kline/get
 */
export async function syncFuturesHist(
  symbol: string = 'GC00Y',
  klt: number = 101,
  fqt: number = 1,
): Promise<Array<{
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  openInterest: number
}>> {
  try {
    // Determine market code based on symbol
    const marketCodes: Record<string, string> = {
      GC: '101', SI: '101', HG: '101', QI: '101', QO: '101', MGC: '101', LTH: '101',
      CL: '102', NG: '102', RB: '102', HO: '102', PA: '102', PL: '102', QM: '102',
    }
    const secid = `${marketCodes[symbol] || '101'}.${symbol}`

    const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get')
    url.searchParams.set('secid', secid)
    url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
    url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')
    url.searchParams.set('klt', String(klt))
    url.searchParams.set('fqt', String(fqt))
    url.searchParams.set('beg', '0')
    url.searchParams.set('end', '20500101')
    url.searchParams.set('lmt', '1000000')

    const json = await httpGet(url.toString(), { useBrowserHeaders: true, referer: 'https://quote.eastmoney.com/' })

    const klines: string[][] = json.data.klines ?? []

    return klines.map((k) => {
      return {
        date: k[0],
        open: parseFloat(k[1]) || 0,
        close: parseFloat(k[2]) || 0,
        high: parseFloat(k[3]) || 0,
        low: parseFloat(k[4]) || 0,
        volume: parseFloat(k[5]) || 0,
        openInterest: parseFloat(k[6]) || 0,
      }
    })
  } catch (e) {
    // push2his.eastmoney.com is only accessible from within China.
    console.warn(`[syncFuturesHist] Failed: ${(e as Error).message}. This API requires a China-based proxy.`)
    return []
  }
}
