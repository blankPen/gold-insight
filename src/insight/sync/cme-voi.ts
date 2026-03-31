/**
 * Sync 模块：CME VOI Excel 下载
 */
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getConfig } from './config'
import { browserHeaders } from './http'

export interface DownloadCMEVoiOptions {
  /** CME 报告日 YYYYMMDD */
  tradeDate: string
  /** 本地绝对或相对路径，目录需已存在 */
  outputPath: string
  reportType?: string
  productId?: string
}

/**
 * 下载 CME VOI xls 到指定路径（由上层负责解析 JSON 写入 merge）.
 */
export async function downloadCMEVoiXls(
  options: DownloadCMEVoiOptions,
): Promise<{ path: string; method: string }> {
  const reportType = options.reportType ?? 'P'
  const productId = options.productId ?? '437'
  const tradeDate = options.tradeDate
  const { PROXY } = getConfig()
  const url = `https://www.cmegroup.com/CmeWS/exp/voiProductDetailsViewExport.ctl?media=xls&tradeDate=${tradeDate}&reportType=${reportType}&productId=${productId}`

  const commonConfig = {
    responseType: 'stream' as const,
    proxy: false as const,
    timeout: 45000,
    headers: {
      ...browserHeaders('https://www.cmegroup.com/'),
      Accept: 'application/vnd.ms-excel,application/octet-stream,*/*',
    },
  }

  const proxyAgent = new HttpsProxyAgent(PROXY)
  let response: any
  let downloadMethod = 'proxy'
  try {
    console.log('Downloading CME data from:', url)
    response = await axios.get(url, {
      ...commonConfig,
      httpsAgent: proxyAgent,
    })
  } catch (proxyError) {
    throw new Error(
      `[CME] download failed. proxy(${PROXY})=${(proxyError as Error).message}`,
    )
  }

  const outputPath = path.resolve(options.outputPath)
  const outDir = path.dirname(outputPath)
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const writer = fs.createWriteStream(outputPath)
  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', () =>
      resolve({
        path: outputPath,
        method: downloadMethod,
      }),
    )
    writer.on('error', reject)
  })
}
