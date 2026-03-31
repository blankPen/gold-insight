/**
 * CME Excel 解析、合约发现
 */
import type { ContractData, CmeVoiParsedPayload } from './types'
import { getXLSX } from './xlsx'
import { normalizeText, parseNumeric } from './helpers'

/** Convert SheetJS worksheet to 2D array */
async function sheetToArray(ws: import('xlsx').WorkSheet): Promise<unknown[][]> {
  const X = await getXLSX()
  const range = ws['!ref']
  if (!range) return []
  const decoded = X.utils.decode_range(range)
  const rows: unknown[][] = []
  for (let R = decoded.s.r; R <= decoded.e.r; ++R) {
    const row: unknown[] = []
    for (let C = decoded.s.c; C <= decoded.e.c; ++C) {
      const addr = X.utils.encode_cell({ r: R, c: C })
      row.push(ws[addr]?.v ?? null)
    }
    rows.push(row)
  }
  return rows
}

/**
 * Find data block in grid (same rules as legacy Excel block).
 */
export function findDataBlockFromRows(
  arrayData: unknown[][],
  startKeyword: string,
): { headers: string[]; rows: unknown[][] } {
  const normKeyword = normalizeText(startKeyword)
  let startIndex = -1
  for (let i = 0; i < arrayData.length; i++) {
    if (normalizeText(arrayData[i]?.[0]) === normKeyword) {
      startIndex = i
      break
    }
  }
  if (startIndex === -1) return { headers: [], rows: [] }

  const headerRow = arrayData[startIndex + 1]
  const headers = headerRow.map((h) => String(h ?? '').trim())

  let endIndex = -1
  for (let i = startIndex + 2; i < arrayData.length; i++) {
    if (normalizeText(arrayData[i]?.[0]) === 'TOTALS') {
      endIndex = i
      break
    }
  }
  if (endIndex === -1) return { headers, rows: [] }

  const rows = arrayData.slice(startIndex + 2, endIndex)
  return { headers, rows }
}

function parseContractRows(block: { headers: string[]; rows: unknown[][] }): ContractData[] {
  const { headers, rows } = block
  const strikeIdx = headers.findIndex((h) => h.toUpperCase().trim() === 'STRIKE')
  const changeIdx = headers.findIndex((h) => h.toUpperCase().trim() === 'CHANGE')
  const atCloseIdx = headers.findIndex((h) => h.toUpperCase().trim() === 'AT CLOSE')
  const volumeIdx = headers.findIndex((h) => h.toUpperCase().trim() === 'TOTAL VOLUME')

  if (strikeIdx === -1 || atCloseIdx === -1) return []

  return rows
    .map((row) => {
      const strike = parseNumeric(row[strikeIdx])
      if (!strike || strike <= 0) return null

      return {
        strike,
        stockCall: parseNumeric(row[atCloseIdx]),
        stockPut: 0,
        changeCall: changeIdx >= 0 ? parseNumeric(row[changeIdx]) : 0,
        changePut: 0,
        volumeCall: volumeIdx >= 0 ? parseNumeric(row[volumeIdx]) : 0,
        volumePut: 0,
      }
    })
    .filter((r): r is ContractData => r !== null)
}

/**
 * Parse calls/puts from first-sheet grid (compute 阶段使用，不读 xls).
 */
export function parseCMEExcelFromRows(
  arrayData: unknown[][],
  contractKey: string,
): { calls: ContractData[]; puts: ContractData[] } {
  const normKey = normalizeText(contractKey)
  const callsKw = `${normKey} Calls`
  const putsKw = `${normKey} Puts`

  const callBlock = findDataBlockFromRows(arrayData, callsKw)
  const putBlock = findDataBlockFromRows(arrayData, putsKw)

  return {
    calls: parseContractRows(callBlock),
    puts: parseContractRows(putBlock),
  }
}

/**
 * Discover contracts from first-column markers (grid).
 */
export function discoverContractsFromRows(arrayData: unknown[][]): string[] {
  const contractKeys = new Set<string>()

  for (const row of arrayData) {
    const cell = String(row[0] ?? '').trim()
    const match = cell.match(/^([A-Z]{3})\s+(\d{2})\s+CALLS?$/i)
    if (match) {
      contractKeys.add(`${match[1].toUpperCase()} ${match[2]}`)
    }
  }

  const monthMap: Record<string, number> = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  }

  return Array.from(contractKeys)
    .map((k) => {
      const parts = k.split(' ')
      const year = 2000 + parseInt(parts[1]!, 10)
      const month = monthMap[parts[0]!] || 0
      return { key: k, year, month }
    })
    .filter((x) => x.year > 0 && x.month > 0)
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((x) => x.key)
}

export function discoverContractsFromPayload(payload: CmeVoiParsedPayload): string[] {
  return discoverContractsFromRows(payload.sheetRows)
}

export function parseCMEExcelFromPayload(
  payload: CmeVoiParsedPayload,
  contractKey: string,
): { calls: ContractData[]; puts: ContractData[] } {
  return parseCMEExcelFromRows(payload.sheetRows, contractKey)
}

/**
 * sync 阶段：从已落盘的 xls 导出网格 JSON（仅此处在 compute 模块内读 xls）。
 */
export async function exportCmeVoiParsedFromXls(
  xlsPath: string,
  meta?: { trade_date?: string; source_xls?: string },
): Promise<CmeVoiParsedPayload> {
  const X = await getXLSX()
  const workbook = X.readFile(xlsPath)
  const sheetName = workbook.SheetNames[0]!
  const ws = workbook.Sheets[sheetName]
  const sheetRows = await sheetToArray(ws)
  return {
    version: 1,
    sheetName,
    sheetRows,
    trade_date: meta?.trade_date,
    source_xls: meta?.source_xls,
  }
}

function isCmeVoiPayload(v: unknown): v is CmeVoiParsedPayload {
  if (v == null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.version === 1 &&
    typeof o.sheetName === 'string' &&
    Array.isArray(o.sheetRows)
  )
}

export function parseCmeVoiParsedJson(text: string): CmeVoiParsedPayload | null {
  try {
    const v = JSON.parse(text) as unknown
    return isCmeVoiPayload(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Parse CME Excel data from file (sync 导出 / 遗留路径).
 */
export async function parseCMEExcel(
  filePath: string,
  contractKey: string,
): Promise<{ calls: ContractData[]; puts: ContractData[] }> {
  const X = await getXLSX()
  const workbook = X.readFile(filePath)
  const sheetName = workbook.SheetNames[0]!
  const ws = workbook.Sheets[sheetName]
  const arrayData = await sheetToArray(ws)
  return parseCMEExcelFromRows(arrayData, contractKey)
}

/**
 * Parse data date from Excel filename.
 */
export function parseDataDateFromFilename(filename: string): Date | null {
  const patterns = [
    /_(\d{8})\./,
    /_(\d{4}-\d{2}-\d{2})\./,
  ]

  for (const pattern of patterns) {
    const match = filename.match(pattern)
    if (match) {
      const fmt = pattern.source.includes('yyyy-mm-dd') ? '%Y-%m-%d' : '%Y%m%d'
      try {
        const dateStr = match[1]!
        if (fmt === '%Y%m%d') {
          const y = parseInt(dateStr.slice(0, 4), 10)
          const m = parseInt(dateStr.slice(4, 6), 10) - 1
          const d = parseInt(dateStr.slice(6, 8), 10)
          return new Date(y, m, d)
        } else {
          const [y, mo, d] = dateStr.split('-').map(Number)
          return new Date(y!, mo! - 1, d!)
        }
      } catch {
        // ignore
      }
    }
  }

  try {
    const fs = require('fs') as typeof import('fs')
    const stats = fs.statSync(filename)
    return new Date(stats.mtime)
  } catch {
    return new Date()
  }
}

/**
 * Discover all contracts from Excel file.
 */
export async function discoverContracts(filePath: string): Promise<string[]> {
  const X = await getXLSX()
  const workbook = X.readFile(filePath)
  const ws = workbook.Sheets[workbook.SheetNames[0]!]
  const arrayData = await sheetToArray(ws)
  return discoverContractsFromRows(arrayData)
}
