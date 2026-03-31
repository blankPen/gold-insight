/**
 * SheetJS 动态加载
 */
let XLSX: typeof import('xlsx') | null = null

export async function getXLSX(): Promise<typeof import('xlsx')> {
  if (!XLSX) {
    XLSX = (await import('xlsx')).default
  }
  return XLSX
}
