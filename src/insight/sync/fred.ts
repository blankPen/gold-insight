/**
 * Sync 模块：FRED 宏观序列
 */
import * as https from 'https'
import { getConfig } from './config'
import type { FREDObservation, SyncDateRangeParams } from './types'

/**
 * Fetch data from FRED (Federal Reserve Economic Data) API.
 *
 * @param seriesId FRED series ID (e.g. 'DGS10', 'DTWEXBGS')
 * @param params Optional date range params
 * @param apiKey FRED API key (optional, uses env FRED_API_KEY if not provided)
 */
export async function syncFRED(
  seriesId: string,
  params?: SyncDateRangeParams & { api_key?: string },
): Promise<FREDObservation[]> {
  const { limit_days, start_date, end_date, api_key } = params ?? {}

  const key = api_key || getConfig().FRED_API_KEY
  if (!key) {
    throw new Error('FRED API key not configured. Set FRED_API_KEY env variable.')
  }

  let observationStart = start_date || ''
  let observationEnd = end_date || ''

  if (limit_days && !start_date) {
    const d = new Date()
    d.setDate(d.getDate() - limit_days)
    observationStart = d.toISOString().split('T')[0]
  }
  if (!end_date) {
    observationEnd = new Date().toISOString().split('T')[0]
  }

  const url = new URL('https://api.stlouisfed.org/fred/series/observations')
  url.searchParams.set('series_id', seriesId)
  url.searchParams.set('api_key', key)
  url.searchParams.set('file_type', 'json')
  if (observationStart) url.searchParams.set('observation_start', observationStart)
  if (observationEnd) url.searchParams.set('observation_end', observationEnd)

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
  const observations: Array<{ date: string; value: string }> = json.observations ?? []

  return observations.map((obs) => ({
    date: obs.date,
    value: obs.value === '.' ? null : parseFloat(obs.value),
  }))
}
