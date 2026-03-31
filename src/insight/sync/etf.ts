/**
 * Sync 模块：ETF 持仓（金十）
 */
import * as https from 'https'
import type { ETFHoldRow, SyncDateRangeParams } from './types'

export async function syncETFGoldHold(
  params?: SyncDateRangeParams,
): Promise<ETFHoldRow[]> {
  return syncETFData('1', params)
}

/**
 * Fetch iShares Silver Trust (SLV) holdings data.
 */
export async function syncETFSilverHold(
  params?: SyncDateRangeParams,
): Promise<ETFHoldRow[]> {
  return syncETFData('2', params)
}

async function syncETFData(
  attrId: string,
  params?: SyncDateRangeParams,
): Promise<ETFHoldRow[]> {
  const { limit_days, start_date, end_date } = params ?? {}
  let targetStartDate: string | null = null
  if (limit_days !== undefined && limit_days > 0) {
    const d = new Date()
    d.setDate(d.getDate() - limit_days)
    targetStartDate = d.toISOString().split('T')[0]
  } else if (start_date) {
    targetStartDate = start_date
  }

  const end = end_date || new Date().toISOString().split('T')[0]
  const ts = Date.now()
  const queryParams = new URLSearchParams({
    category: 'etf',
    attr_id: attrId,
    max_date: end,
    _: String(ts),
  })
  if (targetStartDate) queryParams.set('min_date', targetStartDate)

  const data = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'datacenter-api.jin10.com',
        path: `/reports/list_v2?${queryParams.toString()}`,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
          'x-app-id': 'rU6QIu7JHe2gOUeR',
          'x-csrf-token': 'x-csrf-token',
          'x-version': '1.0.0',
        },
      },
      (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
        let body = ''
        res.on('data', (chunk: Buffer) => (body += chunk))
        res.on('end', () => resolve(body))
      },
    )
    req.on('error', reject)
    req.end()
  })
  const json = JSON.parse(data)
  const values: unknown[][] = json.data?.values ?? []
  return values.map((row) => ({
    商品: attrId === '1' ? '黄金' : '白银',
    日期: String(row[0] ?? ''),
    总库存: parseFloat(String(row[1] ?? 0)),
    '增持/减持': parseFloat(String(row[2] ?? 0)),
    总价值: parseFloat(String(row[3] ?? 0)),
  }))
}
