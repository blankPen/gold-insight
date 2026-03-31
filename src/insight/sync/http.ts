/**
 * Sync 模块：HTTP 辅助（axios、浏览器头）
 */
import axios from 'axios'
import * as https from 'https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getConfig } from './config'

function shouldBypassProxy(url: string): boolean {
  const { BYPASS_PROXY } = getConfig()
  try {
    const hostname = new URL(url).hostname
    return BYPASS_PROXY.some((d) => {
      if (d.startsWith('*.')) {
        const suffix = d.slice(2)
        return hostname === suffix || hostname.endsWith('.' + suffix)
      }
      return hostname === d || hostname.endsWith('.' + d)
    })
  } catch {
    return false
  }
}

/** 标准 browser-like headers（用于欺骗大多数反爬机制）*/
export function browserHeaders(referer = 'https://www.google.com'): Record<string, string> {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': referer,
    'Origin': referer.replace('/index.html', ''),
  }
}

/** 通用 HTTP GET（自动处理绕过代理、browser headers、JSON 解析）*/
export async function httpGet<T = any>(
  url: string,
  options: {
    headers?: Record<string, string>
    useBrowserHeaders?: boolean
    referer?: string
    useProxy?: boolean
  } = {},
): Promise<T> {
  const { useBrowserHeaders = false, referer = 'https://www.google.com', headers = {} } = options
  const mergedHeaders = useBrowserHeaders
    ? { ...browserHeaders(referer), ...headers }
    : headers

  // 默认使用代理，通过 shouldBypassProxy 决定是否绕过
  return _doHttpGet<T>(url, mergedHeaders, options.useProxy)
}

async function _doHttpGet<T = string>(url: string, headers: Record<string, string>, useProxy = false): Promise<T> {
  const { PROXY } = getConfig()
  const proxyAgent = useProxy ? new HttpsProxyAgent(PROXY) : undefined;
  const response = await axios.get(url, {
    ...headers,
    httpsAgent: proxyAgent,
  })
  return response.data as unknown as T
}

/** 通用 HTTP POST */
export async function httpPost<T = string>(
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const data = await new Promise<string>((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let result = ''
        res.on('data', (chunk: Buffer) => (result += chunk))
        res.on('end', () => resolve(result))
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
  return data as unknown as T
}
