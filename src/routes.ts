import path from 'path'
import { FastifyInstance } from 'fastify'
import {
  getLatestPrice,
  getHistory,
  getStats24h,
  getStatsForHours,
  getStatsSince,
  addAnalysisLog,
  getAnalysisLogs,
  getAnalysisLogsSince,
  getRecentAnalysisSummary,
  getPricePointsSince,
  getFirstPriceAtOrAfter,
  getLastPriceBefore,
  aggregateCandles,
} from './db'
import { monitor } from './monitor'
import { sendAlert } from './feishu'
import { Alert } from './alert-engine'
import { analyzeAlert } from './ai'
import config from './config'
import { MERGE_REL, mergeRootDefault, type MergeStateFile } from './insight/data-paths'
import { goldOptionLastTradingDayYmd } from './insight/cme-contract-calendar'
import { resolveInsightMetrics } from './insight/resolve-insight-metrics'
import { readJsonFile } from './insight/merge-store'
import { getMergeSeriesBundle, parseMergeSeriesKindsParam } from './insight-merge-api'

/** 上海时区当日 00:00 对应的 UTC 时间（ISO 字符串） */
function shanghaiMidnightUtcIso(reference: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return new Date(`${y}-${m}-${d}T00:00:00+08:00`).toISOString()
}

export async function registerRoutes(app: FastifyInstance) {
  app.get('/', async (_request, reply) => {
    return reply.redirect('/public/index.html')
  })

  app.get('/api/price', async (request, reply) => {
    try {
      const latest = await getLatestPrice()
      const history24 = await getHistory(24, 1)
      const oldPoint = Array.isArray(history24) ? history24[0] : undefined

      const price = latest?.price ?? 0
      const timestamp = latest?.timestamp ?? new Date().toISOString()
      const oldPrice = oldPoint?.price ?? price
      const change = price - oldPrice
      const changePercent = oldPrice ? (change / oldPrice) * 100 : 0

      reply.status(200).send({ price, timestamp, change, changePercent })
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/history', async (request, reply) => {
    try {
      const q = request.query as { hours?: string; limit?: string }
      const hours = Number(q?.hours ?? 24)
      const limit = Number(q?.limit ?? 100)

      const data = await getHistory(hours, limit)
      const count = Array.isArray(data) ? data.length : 0
      reply.status(200).send({ data: data ?? [], count })
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/history/candles', async (request, reply) => {
    try {
      const q = request.query as { interval?: string; hours?: string; unit?: string }
      const rawUnit = String(q?.unit ?? 'minute').toLowerCase()
      const unit: 'minute' | 'second' =
        rawUnit === 'second' || rawUnit === 'sec' || rawUnit === 's' ? 'second' : 'minute'
      const interval = Number(q?.interval ?? 1)

      if (unit === 'second') {
        if (![1].includes(interval)) {
          reply.code(400).send({ error: 'for unit=second, interval must be 1 (1-second buckets)' })
          return
        }
        const maxH = 24
        let hours = Number(q?.hours ?? 6)
        if (!Number.isFinite(hours) || hours < 1) {
          hours = 6
        }
        hours = Math.min(Math.max(1, Math.floor(hours)), maxH)
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
        const points = getPricePointsSince(cutoff, 500_000)
        const candles = aggregateCandles(points, interval)
        reply
          .status(200)
          .send({ unit, interval, hours, count: candles.length, candles })
        return
      }

      if (![1, 5, 60].includes(interval)) {
        reply.code(400).send({ error: 'interval must be 1, 5, or 60 (minutes)' })
        return
      }
      const caps: Record<number, number> = { 1: 72, 5: 168, 60: 720 }
      const maxH = caps[interval] ?? 72
      let hours = Number(q?.hours ?? (interval === 1 ? 24 : interval === 5 ? 72 : 168))
      if (!Number.isFinite(hours) || hours < 1) {
        hours = interval === 1 ? 24 : interval === 5 ? 72 : 168
      }
      hours = Math.min(Math.max(1, Math.floor(hours)), maxH)
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
      const points = getPricePointsSince(cutoff, 500_000)
      const candles = aggregateCandles(points, interval * 60)
      reply.status(200).send({ unit: 'minute' as const, interval, hours, count: candles.length, candles })
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/insight/metrics', async (request, reply) => {
    try {
      const latest = await getLatestPrice()
      const price = latest?.price ?? 0
      if (price <= 0) {
        reply.code(503).send({ error: '暂无有效现货价', spot: latest })
        return
      }
      const mergeRoot = config.insightMergeRoot
        ? path.resolve(config.insightMergeRoot)
        : mergeRootDefault()
      const mergeState = readJsonFile<MergeStateFile>(
        path.join(mergeRoot, MERGE_REL.state),
      )
      const resolved = resolveInsightMetrics({
        spotPriceUsdPerOz: price,
        mergeRoot,
      })
      const { report, contract: row } = resolved
      const primaryKey = report.meta.primary_contract
      const primaryLtd =
        primaryKey != null ? goldOptionLastTradingDayYmd(primaryKey) : null
      const contractOut =
        row == null
          ? null
          : {
              ...row,
              ltd_ymd: goldOptionLastTradingDayYmd(row.contract),
            }
      reply.status(200).send({
        spot: { price, timestamp: latest.timestamp },
        meta: {
          generated_at: report.meta.generated_at,
          cme_voi_trade_date:
            resolved.insight_voi_trade_date ?? mergeState?.cme_voi?.trade_date,
          primary_contract: primaryKey,
          primary_contract_ltd: primaryLtd,
          primary_pick_warning: report.meta.primary_pick_warning,
          as_of_chicago_ymd: report.meta.as_of_chicago_ymd,
          contract_mode: report.meta.contract_mode,
          insight_data_updated_at: resolved.insight_data_updated_at,
          insight_voi_trade_date: resolved.insight_voi_trade_date,
          insight_stale_fallback: resolved.insight_stale_fallback,
          insight_parsed_source: resolved.insight_parsed_source,
        },
        warnings: report.warnings,
        contract: contractOut,
        cme_delivery_summary: report.cme_delivery_summary
          ? {
              commodity: report.cme_delivery_summary.commodity,
              metrics: report.cme_delivery_summary.metrics,
            }
          : null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      request.log?.error(err)
      if (msg.includes('VOI') || msg.includes('parsed')) {
        reply.code(503).send({ error: msg, hint: '请先执行 insight sync 生成 merge 与 CME VOI JSON' })
        return
      }
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/insight/merge-series', async (request, reply) => {
    try {
      const q = request.query as { kinds?: string; limit?: string }
      const kinds = parseMergeSeriesKindsParam(q?.kinds)
      let limit = Number(q?.limit ?? 365)
      if (!Number.isFinite(limit) || limit < 1) limit = 365
      limit = Math.min(Math.floor(limit), 2000)
      const mergeRoot = config.insightMergeRoot
        ? path.resolve(config.insightMergeRoot)
        : mergeRootDefault()
      const bundle = getMergeSeriesBundle(kinds, limit, mergeRoot)
      reply.status(200).send(bundle)
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/stats', async (request, reply) => {
    try {
      const stats = await getStats24h();
      const result = {
        high24h: stats?.high24h ?? 0,
        low24h: stats?.low24h ?? 0,
        average24h: stats?.average24h ?? 0,
        updateCount: stats?.updateCount ?? 0,
      };
      reply.status(200).send(result)
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/summary', async (request, reply) => {
    try {
      const [latest, stats24, history24] = await Promise.all([
        getLatestPrice(),
        getStats24h(),
        getHistory(24, 200),
      ])
      const price = latest?.price ?? 0
      const timestamp = latest?.timestamp ?? new Date().toISOString()
      const data = Array.isArray(history24) ? history24 : []
      const first = data[0]
      const change = first != null ? price - first.price : 0
      const changePercent = first?.price ? (change / first.price) * 100 : 0
      reply.status(200).send({
        symbol: 'XAUUSD',
        price,
        timestamp,
        change24h: change,
        changePercent24h: changePercent,
        high24h: stats24?.high24h ?? 0,
        low24h: stats24?.low24h ?? 0,
        average24h: stats24?.average24h ?? 0,
        updateCount24h: stats24?.updateCount ?? 0,
        recentPoints: data.slice(-20).map((p: { price: number; timestamp: string }) => ({ price: p.price, timestamp: p.timestamp })),
      })
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/analytics', async (request, reply) => {
    try {
      const dayStartIso = shanghaiMidnightUtcIso()
      const [latest, stats1h, stats4h, stats24h, history1h, history4h, history24h, todayStats] = await Promise.all([
        getLatestPrice(),
        getStatsForHours(1),
        getStatsForHours(4),
        getStats24h(),
        getHistory(1, 500),
        getHistory(4, 500),
        getHistory(24, 500),
        getStatsSince(dayStartIso),
      ])
      const price = latest?.price ?? 0
      const toChange = (points: { price: number }[]) => {
        const p0 = points[0]?.price
        if (p0 == null || p0 === 0) return { change: 0, changePercent: 0 }
        const ch = price - p0
        return { change: ch, changePercent: (ch / p0) * 100 }
      }
      const h1 = Array.isArray(history1h) ? history1h : []
      const h4 = Array.isArray(history4h) ? history4h : []
      const h24 = Array.isArray(history24h) ? history24h : []
      const dayOpen = getFirstPriceAtOrAfter(dayStartIso)
      const todayBase = dayOpen?.price
      const yestRow = getLastPriceBefore(dayStartIso)
      const yesterdayClose = yestRow?.price != null && yestRow.price > 0 ? yestRow.price : null
      const todayChange =
        todayBase != null && todayBase !== 0 ? { change: price - todayBase, changePercent: ((price - todayBase) / todayBase) * 100 } : { change: 0, changePercent: 0 }
      const hasTodayRange = todayStats.updateCount > 0
      reply.status(200).send({
        symbol: 'XAUUSD',
        currentPrice: price,
        timestamp: latest?.timestamp ?? new Date().toISOString(),
        today: {
          dayStart: dayStartIso,
          open: todayBase ?? null,
          baselinePrice: todayBase ?? null,
          yesterdayClose,
          high: hasTodayRange ? todayStats.high : null,
          low: hasTodayRange ? todayStats.low : null,
          hasBaseline: todayBase != null && todayBase !== 0,
          ...todayChange,
        },
        '1h': {
          high: stats1h?.high24h ?? 0,
          low: stats1h?.low24h ?? 0,
          average: stats1h?.average24h ?? 0,
          updateCount: stats1h?.updateCount ?? 0,
          hasBaseline: h1.length > 0,
          ...toChange(h1),
        },
        '4h': { high: stats4h?.high24h ?? 0, low: stats4h?.low24h ?? 0, average: stats4h?.average24h ?? 0, updateCount: stats4h?.updateCount ?? 0, ...toChange(h4) },
        '24h': { high: stats24h?.high24h ?? 0, low: stats24h?.low24h ?? 0, average: stats24h?.average24h ?? 0, updateCount: stats24h?.updateCount ?? 0, ...toChange(h24) },
      })
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/ai/snapshot', async (request, reply) => {
    try {
      const [latest, stats24, history24] = await Promise.all([
        getLatestPrice(),
        getStats24h(),
        getHistory(24, 100),
      ])
      const price = latest?.price ?? 0
      const timestamp = latest?.timestamp ?? new Date().toISOString()
      const high = stats24?.high24h ?? 0
      const low = stats24?.low24h ?? 0
      const avg = stats24?.average24h ?? 0
      const data = Array.isArray(history24) ? history24 : []
      const first = data[0]
      const change = first != null ? price - first.price : 0
      const changePercent = first?.price ? (change / first.price) * 100 : 0
      const summaryText =
        `黄金(XAUUSD)现货当前价格 ${price} USD，最近更新于 ${timestamp}。` +
        `24小时最高 ${high}，最低 ${low}，均价约 ${avg.toFixed(2)}。` +
        (first != null
          ? `24小时涨跌 ${change >= 0 ? '+' : ''}${change.toFixed(2)}（${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%）。`
          : '暂无24小时涨跌数据。')
      reply.status(200).send({
        summary: summaryText,
        data: {
          symbol: 'XAUUSD',
          price,
          timestamp,
          high24h: high,
          low24h: low,
          average24h: avg,
          change24h: change,
          changePercent24h: changePercent,
          updateCount24h: stats24?.updateCount ?? 0,
        },
      })
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ error: 'Internal Server Error' })
    }
  })

  app.get('/api/health', async (request, reply) => {
    try {
      const latest = await getLatestPrice()
      const ts = latest?.timestamp ? new Date(latest.timestamp).getTime() : 0
      const ageSeconds = ts ? Math.floor((Date.now() - ts) / 1000) : null
      const isStale = ageSeconds != null && ageSeconds > 300
      reply.status(200).send({
        status: 'ok',
        dataAgeSeconds: ageSeconds,
        lastUpdate: latest?.timestamp ?? null,
        isStale,
        message: isStale ? '数据可能已陈旧，请谨慎用于投资决策。' : '数据在 5 分钟内已更新，可用于分析。',
      })
    } catch (err) {
      request.log?.error(err)
      reply.code(500).send({ status: 'error', error: 'Health check failed' })
    }
  })

  app.get('/api/indicators', async (request, reply) => {
    try {
      const snapshot = monitor.getLatestSnapshot();
      if (!snapshot) {
        reply.status(200).send({ status: 'waiting', message: '指标计算尚未就绪，等待足够的K线数据' });
        return;
      }
      reply.status(200).send({
        price: snapshot.price,
        sma20: snapshot.sma20,
        ema12: snapshot.ema12,
        ema26: snapshot.ema26,
        rsi14: snapshot.rsi14,
        macd: snapshot.macd,
        bollingerBands: snapshot.bollingerBands,
        pivotPoints: snapshot.pivotPoints,
      });
    } catch (err) {
      request.log?.error(err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  })

  app.get('/api/alerts/history', async (request, reply) => {
    try {
      const alerts = monitor.getAlertHistory();
      reply.status(200).send({ alerts, count: alerts.length });
    } catch (err) {
      request.log?.error(err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  })

  app.get('/api/analysis-logs', async (request, reply) => {
    try {
      const q = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Number(q?.limit ?? 50), 200);
      const offset = Number(q?.offset ?? 0);
      const logs = getAnalysisLogs(limit, offset);
      reply.status(200).send({ logs, count: logs.length });
    } catch (err) {
      request.log?.error(err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  })

  app.get('/api/analysis-logs/latest', async (request, reply) => {
    try {
      const q = request.query as { since_id?: string; limit?: string };
      const sinceId = Number(q?.since_id ?? 0);
      const limit = Math.min(Number(q?.limit ?? 50), 200);
      const logs = sinceId > 0
        ? getAnalysisLogsSince(sinceId, limit)
        : getAnalysisLogs(limit, 0);
      reply.status(200).send({ logs, count: logs.length });
    } catch (err) {
      request.log?.error(err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  })

  app.post('/api/alerts/push-now', async (request, reply) => {
    try {
      const latest = await getLatestPrice();
      const stats = await getStats24h();
      const price = latest?.price ?? 0;

      const alert: Alert = {
        type: 'price_surge',
        level: 'info',
        title: '手动推送 — 实时行情快照',
        message: `当前金价 $${price.toFixed(2)}\n24小时最高 $${stats?.high24h?.toFixed(2) ?? '--'} / 最低 $${stats?.low24h?.toFixed(2) ?? '--'}`,
        price,
        timestamp: new Date().toISOString(),
        indicators: {},
      };

      let aiResult = null;
      try {
        const historyContext = getRecentAnalysisSummary();
        aiResult = await analyzeAlert({
          alert,
          stats24h: stats ? { high24h: stats.high24h, low24h: stats.low24h, average24h: stats.average24h } : undefined,
          historyContext: historyContext || undefined,
        });
      } catch {
        // AI analysis optional
      }

      try {
        addAnalysisLog(alert, aiResult);
      } catch {
        // DB write optional
      }

      const ok = await sendAlert(alert, aiResult);
      reply.status(200).send({
        success: ok,
        message: ok ? '推送成功' : '推送失败，请检查飞书配置',
        aiAnalysis: aiResult ?? undefined,
      });
    } catch (err) {
      request.log?.error(err);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  })

  app.get('/api/docs', async (_request, reply) => {
    reply.status(200).send({
      name: '黄金实时价格 API (XAUUSD)',
      baseUrl: 'http://49.235.61.172:3003',
      description: '用于 AI 或程序获取黄金现货实时数据，便于投资分析。所有接口均为 GET，返回 JSON（除 /events 为 SSE）。',
      endpoints: [
        {
          method: 'GET',
          path: '/api/price',
          description: '当前价格、时间戳、相对 24 小时前的涨跌额与涨跌幅。',
        },
        {
          method: 'GET',
          path: '/api/history',
          description: '历史价格序列，按时间正序。',
          params: [
            { name: 'hours', type: 'number', required: false, default: 24 },
            { name: 'limit', type: 'number', required: false, default: 100 },
          ],
        },
        {
          method: 'GET',
          path: '/api/history/candles',
          description:
            'K 线聚合：默认 unit=minute 时 interval=1|5|60（分钟）；unit=second 时 interval=1（秒级分桶），hours≤24。',
          params: [
            { name: 'unit', type: 'string', required: false, default: 'minute' },
            { name: 'interval', type: 'number', required: false, default: 1 },
            { name: 'hours', type: 'number', required: false },
          ],
        },
        {
          method: 'GET',
          path: '/api/insight/metrics',
          description: '实时金价 + CME VOI 主力期权合约指标（需先 sync merge）。',
        },
        {
          method: 'GET',
          path: '/api/insight/merge-series',
          description: 'ETF/COMEX 等 merge 时序，供图表使用。',
          params: [
            { name: 'kinds', type: 'string', required: false },
            { name: 'limit', type: 'number', required: false, default: 365 },
          ],
        },
        {
          method: 'GET',
          path: '/api/stats',
          description: '过去 24 小时的统计：最高价、最低价、均价、更新次数。',
        },
        {
          method: 'GET',
          path: '/api/summary',
          description: '综合摘要：当前价、24h 统计、24h 涨跌、近期 20 个价格点。',
        },
        {
          method: 'GET',
          path: '/api/analytics',
          description:
            '多时间框架统计；today 含上海自然日开盘/最高/最低（与今日涨幅同一口径）及 1h/4h/24h。',
        },
        {
          method: 'GET',
          path: '/api/ai/snapshot',
          description: 'AI 友好快照：summary 为自然语言摘要。',
        },
        {
          method: 'GET',
          path: '/api/health',
          description: '数据新鲜度与服务健康状态。',
        },
        {
          method: 'GET',
          path: '/api/alerts/history',
          description: '最近的告警记录。',
        },
        {
          method: 'POST',
          path: '/api/alerts/push-now',
          description: '手动推送一条告警到飞书。',
        },
      ],
    })
  })

}

export default registerRoutes
