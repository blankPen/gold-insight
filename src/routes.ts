import { FastifyInstance } from 'fastify'
import { getLatestPrice, getHistory, getStats24h, getStatsForHours, addAnalysisLog, getAnalysisLogs, getAnalysisLogsSince, getRecentAnalysisSummary } from './db'
import { monitor } from './monitor'
import { sendAlert } from './feishu'
import { Alert } from './alert-engine'
import { analyzeAlert } from './ai'

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
      const [latest, stats1h, stats4h, stats24h, history1h, history4h, history24h] = await Promise.all([
        getLatestPrice(),
        getStatsForHours(1),
        getStatsForHours(4),
        getStats24h(),
        getHistory(1, 500),
        getHistory(4, 500),
        getHistory(24, 500),
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
      reply.status(200).send({
        symbol: 'XAUUSD',
        currentPrice: price,
        timestamp: latest?.timestamp ?? new Date().toISOString(),
        '1h': { high: stats1h?.high24h ?? 0, low: stats1h?.low24h ?? 0, average: stats1h?.average24h ?? 0, updateCount: stats1h?.updateCount ?? 0, ...toChange(h1) },
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
          description: '多时间框架统计：1 小时 / 4 小时 / 24 小时。',
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
