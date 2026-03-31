#!/usr/bin/env node
/**
 * index.ts — 数据同步与计算 CLI
 *
 *   npx tsx index.ts --sync [--merge-dir DIR] [--cme-trade-date YYYYMMDD]
 *   npx tsx index.ts --compute --spot <usd/oz> [--merge-dir DIR] [--file parsed.json]
 *   npx tsx index.ts --compute --spot 2650 --write-report ./out.json
 */
import * as path from 'path'
import * as fs from 'fs'
import { mergeRootDefault } from './data-paths'
import * as Sync from './sync'
import * as Compute from './compute'
import axios from 'axios'

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

interface CliArgs {
  sync: boolean
  compute: boolean
  /** CME VOI 预解析 JSON 路径（覆盖 _state） */
  file: string | null
  fredSeriesId: string | null
  delivery: string | null
  mergeDir: string | null
  cmeTradeDate: string | null
  metal: 'gold' | 'silver' | 'copper'
  /** 美元/盎司 */
  spot: number | null
  writeReport: string | null
  help: boolean
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    sync: false,
    compute: false,
    file: null,
    fredSeriesId: null,
    delivery: null,
    mergeDir: null,
    cmeTradeDate: null,
    metal: 'gold',
    spot: null,
    writeReport: null,
    help: false,
  }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sync':
        args.sync = true
        break
      case '--compute':
        args.compute = true
        break
      case '--file':
        args.file = argv[++i] ?? null
        break
      case '--fred':
        args.fredSeriesId = argv[++i] ?? 'DGS10'
        break
      case '--delivery':
        args.delivery = argv[++i] ?? 'GOLD'
        break
      case '--merge-dir':
        args.mergeDir = argv[++i] ?? null
        break
      case '--cme-trade-date':
        args.cmeTradeDate = argv[++i] ?? null
        break
      case '--spot':
      case '--gold-price': {
        const v = argv[++i]
        args.spot = v != null ? Number(v) : null
        break
      }
      case '--write-report':
        args.writeReport = argv[++i] ?? null
        break
      case '--metal': {
        const m = (argv[++i] ?? 'gold').toLowerCase()
        if (m === 'gold' || m === 'silver' || m === 'copper') {
          args.metal = m
        }
        break
      }
      case '-h':
      case '--help':
        args.help = true
        break
    }
  }
  return args
}

function printHelp(): void {
  console.log(`Usage: npx tsx index.ts [options]

Options:
  --sync                  全量同步 → data/snapshots/<YYYY-MM-DD> + data/merge
  --merge-dir <path>      merge 根目录（默认 ./data/merge）
  --cme-trade-date <YYYYMMDD>  CME VOI 报告日（默认 UTC 当日）

  --compute               基于 merge 与 CME VOI 预解析 JSON 计算（不落盘）
  --spot <number>         必填（美元/盎司）；别名 --gold-price
  --file <path>           CME VOI parsed.json，覆盖 merge/_state.json 中的路径
  --write-report <path>   将计算结果 JSON 写入指定路径
  --metal <gold|silver|copper>  品种（默认 gold）

  --fred <seriesId>       sync 时 FRED 序列（默认 DGS10）
  --delivery <GOLD|SILVER> sync 时 CME 交割 PDF 品种（默认 GOLD）
  -h, --help              帮助
`)
}

// ---------------------------------------------------------------------------
// 主逻辑
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  if (!args.sync && !args.compute) {
    console.error('请指定 --sync 或 --compute（或两者）')
    printHelp()
    process.exit(1)
  }

  const mergeRoot = args.mergeDir != null
    ? path.resolve(args.mergeDir)
    : mergeRootDefault()

  // const { DATA_DIR } = Sync.getConfig()
  // console.log(`\n[${now()}] 开始执行`)
  // console.log(`配置 DATA_DIR: ${DATA_DIR}，merge: ${mergeRoot}\n`)

  if (args.sync) {
    console.log('━━━ SYNC ━━━\n')
    const r = await Sync.syncAll()
    if (r.success) {
      console.log(`[sync] 完成`)
    } else {
      console.error('[sync] 失败:', r.error)
      process.exit(1)
    }
  }

  if (args.compute) {
    if (args.spot == null || Number.isNaN(args.spot)) {
      const response = await axios.get('http://49.235.61.172:3003/api/price')
      args.spot = response.data.price as number
    }

    let report: Compute.ComputeAllResult
    try {
      report = Compute.computeAll({
        spotPriceUsdPerOz: args.spot,
        metal: args.metal,
        mergeRoot,
        cmeVoiParsedJsonPath: args.file ?? undefined,
      })
    } catch (e) {
      console.error('[compute]', (e as Error).message)
      process.exit(1)
    }

    Compute.logComputeAllResult(report)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
