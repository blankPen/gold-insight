import { priceEmitter } from './scraper';
import { CandleAggregator } from './candle-aggregator';
import { computeAll, IndicatorSnapshot } from './indicators';
import { AlertEngine, Alert } from './alert-engine';
import { sendAlert } from './feishu';
import { analyzeAlert, AIAnalysisContext } from './ai';
import { getStats24h, addAnalysisLog, getRecentAnalysisSummary } from './db';
import config from './config';

export class Monitor {
  private aggregator = new CandleAggregator();
  private alertEngine = new AlertEngine();
  private latestSnapshot: IndicatorSnapshot | null = null;
  private started = false;
  private candlesSinceLastAnalysis = 0;
  private analysisRunning = false;

  getLatestSnapshot(): IndicatorSnapshot | null {
    return this.latestSnapshot;
  }

  getAlertHistory(): Alert[] {
    return this.alertEngine.getAlertHistory();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.aggregator.backfill(6);

    priceEmitter.on('price', (data: { price: number; timestamp: string }) => {
      this.onPriceTick(data.price, data.timestamp);
    });

    console.log(`[Monitor] Started — periodic analysis every ${config.analysisIntervalMinutes} min`);
  }

  private onPriceTick(price: number, timestamp: string): void {
    this.alertEngine.recordPrice(price);

    const candleCompleted = this.aggregator.onTick(price, timestamp);

    const candles = this.aggregator.getCandles();
    if (candles.length >= 2) {
      this.latestSnapshot = computeAll(candles);
    }

    if (candleCompleted) {
      this.candlesSinceLastAnalysis++;

      const alerts = this.alertEngine.evaluate();
      for (const alert of alerts) {
        this.dispatchAlertToFeishu(alert);
      }

      if (this.candlesSinceLastAnalysis >= config.analysisIntervalMinutes) {
        this.candlesSinceLastAnalysis = 0;
        this.runPeriodicAnalysis(price, timestamp);
      }
    }
  }

  private buildIndicatorsCtx(): AIAnalysisContext['indicators'] | undefined {
    const snap = this.latestSnapshot;
    if (!snap) return undefined;
    return {
      sma20: snap.sma20,
      ema12: snap.ema12,
      ema26: snap.ema26,
      rsi14: snap.rsi14,
      macd: snap.macd,
      bollingerBands: snap.bollingerBands,
      pivotPoints: snap.pivotPoints ? { pp: snap.pivotPoints.pp, r1: snap.pivotPoints.r1, s1: snap.pivotPoints.s1 } : null,
    };
  }

  private async runPeriodicAnalysis(price: number, timestamp: string): Promise<void> {
    if (this.analysisRunning) return;
    this.analysisRunning = true;

    try {
      const stats = await getStats24h();
      const historyContext = getRecentAnalysisSummary();

      const change1h = stats ? price - stats.low24h : 0;
      const rangeDesc = stats
        ? `24h 区间 $${stats.low24h.toFixed(2)} ~ $${stats.high24h.toFixed(2)}`
        : '暂无24h统计';

      const alert: Alert = {
        type: 'periodic_analysis',
        level: 'info',
        title: '定时行情分析',
        message: `当前金价 $${price.toFixed(2)}，${rangeDesc}`,
        price,
        timestamp,
        indicators: {},
      };

      let aiResult = null;
      try {
        aiResult = await analyzeAlert({
          alert,
          stats24h: stats ? { high24h: stats.high24h, low24h: stats.low24h, average24h: stats.average24h } : undefined,
          historyContext: historyContext || undefined,
          indicators: this.buildIndicatorsCtx(),
        });
        if (aiResult) {
          console.log(`[Monitor] Periodic analysis done (confidence: ${aiResult.confidence})`);
        }
      } catch (aiErr) {
        console.warn('[Monitor] Periodic AI analysis failed:', aiErr);
      }

      try {
        addAnalysisLog(alert, aiResult);
      } catch (dbErr) {
        console.warn('[Monitor] Failed to save periodic analysis log:', dbErr);
      }
    } catch (err) {
      console.error('[Monitor] Periodic analysis error:', err);
    } finally {
      this.analysisRunning = false;
    }
  }

  /** Alert-triggered analysis: save to DB AND push to Feishu */
  private async dispatchAlertToFeishu(alert: Alert): Promise<void> {
    console.log(`[Monitor] Alert triggered: ${alert.title} (${alert.level})`);
    let aiResult = null;
    try {
      try {
        const stats = await getStats24h();
        const historyContext = getRecentAnalysisSummary();
        aiResult = await analyzeAlert({
          alert,
          stats24h: stats ? { high24h: stats.high24h, low24h: stats.low24h, average24h: stats.average24h } : undefined,
          historyContext: historyContext || undefined,
          indicators: this.buildIndicatorsCtx(),
        });
        if (aiResult) {
          console.log(`[Monitor] AI analysis done (confidence: ${aiResult.confidence})`);
        }
      } catch (aiErr) {
        console.warn('[Monitor] AI analysis failed, sending without:', aiErr);
      }

      try {
        addAnalysisLog(alert, aiResult);
      } catch (dbErr) {
        console.warn('[Monitor] Failed to save analysis log:', dbErr);
      }

      await sendAlert(alert, aiResult);
    } catch (err) {
      console.error('[Monitor] Failed to dispatch alert to feishu:', err);
    }
  }

  stop(): void {
    this.started = false;
    priceEmitter.removeAllListeners('price');
    console.log('[Monitor] Stopped');
  }
}

export const monitor = new Monitor();
