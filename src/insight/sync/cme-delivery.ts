/**
 * Sync 模块：CME Metals MTD 交割 PDF
 */
import * as fs from 'fs'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { createRequire } from 'node:module'
import { getConfig } from './config'
import type { CMEDeliveryRecord } from './types'

const nodeRequire = createRequire(import.meta.url)
const pdfParseBuffer = nodeRequire('pdf-parse') as (data: Buffer) => Promise<{ text: string }>

/** 与 backend/cme_delivery_service.py CME_DELIVERY_URLS 一致 */
const CME_DELIVERY_REPORT_URLS = {
  daily: 'https://www.cmegroup.com/delivery_reports/MetalsIssuesAndStopsReport.pdf',
  monthly:
    'https://www.cmegroup.com/delivery_reports/MetalsIssuesAndStopsMTDReport.pdf',
} as const

/** 与 backend/cme_delivery_service.py OZ_PER_CONTRACT 一致 */
const OZ_PER_CONTRACT_MAP: Record<string, number> = {
  'SILVER:STANDARD': 5000,
  'SILVER:MICRO': 1000,
  'GOLD:STANDARD': 100,
  'GOLD:MICRO': 10,
  'COPPER:STANDARD': 25000,
  'PALLADIUM:STANDARD': 100,
  'PLATINUM:STANDARD': 50,
  'ALUMINUM:STANDARD': 44000,
}

function ozPerContractFor(commodity: string, contractType: string): number {
  const v = OZ_PER_CONTRACT_MAP[`${commodity}:${contractType}`]
  if (v != null) {
    return v
  }
  return commodity === 'GOLD' ? 100 : 5000
}

function usMdYToIso(dateStr: string): string | null {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) {
    return null
  }
  const mm = m[1].padStart(2, '0')
  const dd = m[2].padStart(2, '0')
  return `${m[3]}-${mm}-${dd}`
}

/**
 * 解析 Metals MTD PDF 全文（逻辑对齐 backend/cme_delivery_service._parse_monthly_pdf）
 */
export function parseCmeMetalsMtdReportText(fullText: string): {
  run_date: string | null
  run_date_raw: string | null
  records: CMEDeliveryRecord[]
} {
  const runDateMatch = fullText.match(/RUN DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})/)
  const runDateRaw = runDateMatch ? runDateMatch[1].trim() : null
  const runDateIso = runDateRaw ? usMdYToIso(runDateRaw) : null

  const records: CMEDeliveryRecord[] = []
  const sections = fullText.split(/(?=CONTRACT:\s+)/)

  const dayPattern = /(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d,]+)\s+([\d,]+)/g

  for (const section of sections) {
    if (!section.includes('CONTRACT:')) {
      continue
    }

    const contractMatch = section.match(
      /CONTRACT:\s+([\s\S]+?)(?:FUTURES|INTENT DATE|$)/,
    )
    if (!contractMatch) {
      continue
    }

    const fullContractName = contractMatch[1].trim().replace(/\n/g, ' ')

    let commodity: string | null = null
    let contractType = 'STANDARD'
    const uName = fullContractName.toUpperCase()
    if (uName.includes('MICRO')) {
      contractType = 'MICRO'
    }
    if (uName.includes('SILVER')) {
      commodity = 'SILVER'
    } else if (uName.includes('GOLD')) {
      commodity = 'GOLD'
    } else if (uName.includes('COPPER')) {
      commodity = 'COPPER'
    } else if (uName.includes('PALLADIUM')) {
      commodity = 'PALLADIUM'
    } else if (uName.includes('PLATINUM')) {
      commodity = 'PLATINUM'
    } else if (uName.includes('ALUMINUM')) {
      commodity = 'ALUMINUM'
    }

    if (!commodity) {
      continue
    }

    const monthMatch = fullContractName.match(/(\w+ \d{4})/)
    const dataMonth = monthMatch ? monthMatch[1] : null

    const ozPer = ozPerContractFor(commodity, contractType)

    let match: RegExpExecArray | null
    dayPattern.lastIndex = 0
    while ((match = dayPattern.exec(section)) !== null) {
      const dateStr = match[1]
      const dailyTotal = Number.parseInt(match[2].replace(/,/g, ''), 10)
      const cumulative = Number.parseInt(match[3].replace(/,/g, ''), 10)
      const reportIso = usMdYToIso(dateStr)
      if (!reportIso) {
        continue
      }
      records.push({
        report_date: reportIso,
        commodity,
        contract_type: contractType,
        contract_name: fullContractName,
        daily_total: dailyTotal,
        cumulative,
        oz_per_contract: ozPer,
        daily_oz: dailyTotal * ozPer,
        cumulative_oz: cumulative * ozPer,
        data_month: dataMonth,
      })
    }
  }

  return {
    run_date: runDateIso,
    run_date_raw: runDateRaw,
    records,
  }
}

async function downloadCmeDeliveryPdfBuffer(
  reportType: keyof typeof CME_DELIVERY_REPORT_URLS = 'monthly',
): Promise<Buffer | null> {
  const url = CME_DELIVERY_REPORT_URLS[reportType]
  const { PROXY } = getConfig()
  const proxyAgent = new HttpsProxyAgent(PROXY)
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      httpsAgent: proxyAgent,
      proxy: false,
    })
    return Buffer.from(response.data)
  } catch (e) {
    console.warn(`[CME Delivery] PDF 下载失败: ${(e as Error).message}`)
    return null
  }
}

/**
 * 下载并解析 CME Metals Issues and Stops MTD 报告 PDF（与 backend/cme_delivery_service.download_monthly_data 数据源与解析一致）。
 * @param commodity 仅保留该品种记录（如 GOLD、SILVER）；传 ALL 则返回全部品种
 */
export async function syncCMEDelivery(
  commodity: string = 'GOLD',
  options: { reportType?: keyof typeof CME_DELIVERY_REPORT_URLS; useProxy?: boolean } = {},
): Promise<{
  run_date: string | null
  run_date_raw: string | null
  source_url: string
  records: CMEDeliveryRecord[]
} | null> {
  const reportType = options.reportType ?? 'monthly'
  const sourceUrl = CME_DELIVERY_REPORT_URLS[reportType]

  const pdfBuf = await downloadCmeDeliveryPdfBuffer(reportType)
  if (!pdfBuf) {
    return null
  }

  let fullText: string
  try {
    const parsed = await pdfParseBuffer(pdfBuf)
    fullText = parsed.text || ''
  } catch (e) {
    console.warn(`[CME Delivery] PDF 解析失败: ${(e as Error).message}`)
    return null
  }

  const { run_date, run_date_raw, records: allRecords } =
    parseCmeMetalsMtdReportText(fullText)

  if (allRecords.length === 0) {
    console.warn('[CME Delivery] 解析结果无有效行数据')
    return null
  }

  const upper = commodity.toUpperCase()
  const records =
    upper === 'ALL'
      ? allRecords
      : allRecords.filter((r) => r.commodity === upper)

  if (records.length === 0) {
    console.warn(
      `[CME Delivery] PDF 已解析 ${allRecords.length} 条，但无品种 ${upper} 记录`,
    )
  }

  // MTD PDF 偶发重复区块，与 DB upsert 语义对齐：同键只保留一条
  const deduped = dedupeCmeDeliveryRecords(records)

  return {
    run_date,
    run_date_raw,
    source_url: sourceUrl,
    records: deduped,
  }
}

function dedupeCmeDeliveryRecords(
  records: CMEDeliveryRecord[],
): CMEDeliveryRecord[] {
  const map = new Map<string, CMEDeliveryRecord>()
  for (const r of records) {
    const k = `${r.report_date}\0${r.commodity}\0${r.contract_type}\0${r.contract_name}`
    map.set(k, r)
  }
  return [...map.values()].sort(
    (a, b) =>
      a.report_date.localeCompare(b.report_date) ||
      a.contract_name.localeCompare(b.contract_name),
  )
}
