/**
 * Sync 模块：CFTC COT 持仓
 */
import * as zlib from 'zlib'
import type { COTRow } from './types'

/**
 * Fetch COT (Commitment of Traders) data from CFTC.
 * Downloads ZIP from CFTC website, extracts and parses CSV.
 *
 * @param year Target year
 * @param commodityKey Commodity key in COT config (e.g. 'GOLD', 'SILVER')
 */
export async function syncCOT(
  year: number = new Date().getFullYear(),
  commodityKey: string = 'GOLD',
): Promise<COTRow[]> {

  const url = `https://www.cftc.gov/files/dea/history/fut_disagg_txt_${year}.zip`

  // CFTC blocks Node.js https.get() directly (403). Use curl via child_process.
  const { execSync } = await import('child_process')
  const tmpPath = `/tmp/cot_${year}.zip`
  try {
    execSync(`curl -s -o "${tmpPath}" "${url}"`, { stdio: 'pipe' })
  } catch (e) {
    throw new Error(`COT download failed: ${(e as Error).message}`)
  }
  const response = await import('fs').then(m => m.default.readFileSync(tmpPath))

  // Decompress ZIP manually (simple approach without node-stream-zip)
  const { default: { readFileSync } } = await import('fs')
  // Use Node's built-in to parse ZIP
  // ZIP format: [local file header] + [file data] + [central directory]
  // Find the first .txt file in the ZIP
  const str = response.toString('binary')
  const txtMatch = str.match(/([\w-]+\.txt)\0/g)
  if (!txtMatch) {
    // Fallback: try to extract differently
    const entries = parseZipEntries(response)
    const txtEntry = entries.find((e) => e.filename.endsWith('.txt'))
    if (!txtEntry) throw new Error('No .txt file found in COT ZIP')

    const content = response.slice(txtEntry.headerOffset, txtEntry.headerOffset + txtEntry.compressedSize)
    const decompressed = zlib.inflateRawSync(content)
    const csvText = decompressed.toString('utf8')
    return parseCOTCSV(csvText, commodityKey)
  }

  return []
}

function parseZipEntries(buf: Buffer): Array<{ filename: string; headerOffset: number; compressedSize: number }> {
  const entries: Array<{ filename: string; headerOffset: number; compressedSize: number }> = []
  let offset = 0

  // Find local file headers (signature: 0x04034b50)
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset)
    if (sig === 0x04034b50) {
      const nameLen = buf.readUInt16LE(offset + 26)
      const extraLen = buf.readUInt16LE(offset + 28)
      const compressedSize = buf.readUInt32LE(offset + 18)
      const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf8')
      entries.push({ filename: name, headerOffset: offset + 30 + nameLen + extraLen, compressedSize })
      offset += 30 + nameLen + extraLen + compressedSize
    } else {
      offset++
    }
  }

  return entries
}

function parseCOTCSV(csvText: string, commodityKey: string): COTRow[] {
  const lines = csvText.split('\n')
  if (lines.length < 2) return []

  // CSV header - use actual CFTC field names from fut_disagg_txt format
  const header = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
  const nameIdx = header.indexOf('Market_and_Exchange_Names')
  const dateIdx = header.indexOf('Report_Date_as_YYYY-MM-DD')
  const prodLongIdx = header.indexOf('Prod_Merc_Positions_Long_All')
  const prodShortIdx = header.indexOf('Prod_Merc_Positions_Short_All')
  const swapLongIdx = header.indexOf('Swap_Positions_Long_All')
  const swapShortIdx = header.indexOf('Swap__Positions_Short_All')
  const mmLongIdx = header.indexOf('M_Money_Positions_Long_All')
  const mmShortIdx = header.indexOf('M_Money_Positions_Short_All')
  const otherLongIdx = header.indexOf('Other_Rept_Positions_Long_All')
  const otherShortIdx = header.indexOf('Other_Rept_Positions_Short_All')

  const result: COTRow[] = []
  const key = commodityKey.toUpperCase()

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 10) continue

    const marketName = (cols[nameIdx] || '').toUpperCase()

    // Match by market name containing the commodity key (e.g., "GOLD - COMMODITY EXCHANGE INC.")
    if (!marketName.includes(key)) continue

    result.push({
      trade_date: cols[dateIdx] || '',
      symbol: marketName,
      producer_long: parseFloat(cols[prodLongIdx]) || 0,
      producer_short: parseFloat(cols[prodShortIdx]) || 0,
      swap_long: parseFloat(cols[swapLongIdx]) || 0,
      swap_short: parseFloat(cols[swapShortIdx]) || 0,
      managed_money_long: parseFloat(cols[mmLongIdx]) || 0,
      managed_money_short: parseFloat(cols[mmShortIdx]) || 0,
      other_long: parseFloat(cols[otherLongIdx]) || 0,
      other_short: parseFloat(cols[otherShortIdx]) || 0,
    })
  }

  return result
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())

  return result
}
