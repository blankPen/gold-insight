/**
 * Sync 模块：COMEX 库存（东方财富）
 */
import * as https from 'https'
import type { COMEXInventoryRow, SyncDateRangeParams } from './types'

/**
 * Fetch COMEX warehouse stocks/inventory data.
 * Data source: EastMoney datacenter API
 */
export async function syncCOMEXInventory(
  symbol: '黄金' | '白银' = '黄金',
  params?: SyncDateRangeParams,
): Promise<COMEXInventoryRow[]> {
  const { limit_days, start_date, end_date } = params ?? {}

  let end = end_date || new Date().toISOString().split('T')[0]
  let begin = start_date || ''
  if (limit_days && !start_date) {
    const d = new Date()
    d.setDate(d.getDate() - limit_days)
    begin = d.toISOString().split('T')[0]
  }

  const commodityCode = symbol === '黄金' ? '202' : '203'

  const symbolMap: Record<string, string> = {
    '黄金': 'EMI00069026',
    '白银': 'EMI00069027',
  }
  const indicatorId = symbolMap[symbol] || 'EMI00069026'

  const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get')
  url.searchParams.set('reportName', 'RPT_FUTUOPT_GOLDSIL')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('pageNumber', '1')
  url.searchParams.set('pageSize', '500')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('sortColumns', 'REPORT_DATE')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('filter', `(INDICATOR_ID1="${indicatorId}")(@STORAGE_TON!="NULL")`)

  const data = await new Promise<string>((resolve, reject) => {
    https.get(url.toString(), (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.on('data', (chunk: Buffer) => (body += chunk))
      res.on('end', () => resolve(body))
    }).on('error', reject)
  })

  const json = JSON.parse(data)
  const items: Array<Record<string, unknown>> = json.result?.data ?? []

  return items.map((item, idx) => ({
    序号: idx + 1,
    日期: String(item.REPORT_DATE ?? ''),
    'COMEX库存量-吨': parseFloat(String(item.STORAGE_TON ?? 0)),
    'COMEX库存量-盎司': parseFloat(String(item.STORAGE_OUNCE ?? 0)),
  }))
}
