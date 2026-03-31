/**
 * Sync 模块：环境配置
 */
import * as fs from 'fs'
import * as path from 'path'

export function getConfig(): {
  COOKIE_CLOUD: any
  PROXY: string
  BYPASS_PROXY: string[]
  DATA_DIR: string
  COOKIE_CACHE_FILE: string
  FRED_API_KEY: string
} {
  return {
    COOKIE_CLOUD: {
      host: process.env.COOKIE_CLOUD_HOST || 'http://49.235.61.172:8088',
      uuid: process.env.COOKIE_CLOUD_UUID || 'nbPmHPYRNgCLtL3eyfSSbC',
      password: process.env.COOKIE_CLOUD_PASSWORD || 'ey2Tx5iU4ytJxDGapR8nuS',
    },
    PROXY: process.env.CME_PROXY || 'http://127.0.0.1:7890',
    // 绕过代理直连的域名
    BYPASS_PROXY: (process.env.BYPASS_PROXY || 'localhost,127.0.0.1')
      .split(',')
      .map(d => d.trim())
      .filter(Boolean),
    DATA_DIR: process.env.DATA_DIR || process.cwd(),
    COOKIE_CACHE_FILE: (() => {
      const p = path.resolve(process.cwd(), 'data', 'cme_cookies.json')
      const dir = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      return p
    })(),
    FRED_API_KEY: process.env.FRED_API_KEY || '8750bbd626a4c64bce1839cac7bc8f76',
  }
}
