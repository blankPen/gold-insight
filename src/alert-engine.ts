import config from './config';

export type AlertType = 'price_surge' | 'price_drop' | 'periodic_analysis';
export type AlertLevel = 'info' | 'warning' | 'critical';

export interface Alert {
  type: AlertType;
  level: AlertLevel;
  title: string;
  message: string;
  price: number;
  timestamp: string;
  indicators: Record<string, number>;
}

export interface PriceChangeRule {
  windowMinutes: number;
  thresholdPercent: number;
}

export class AlertEngine {
  private priceHistory: { price: number; ts: number }[] = [];
  private alertHistory: Alert[] = [];
  private maxAlertHistory = 100;
  private lastAlertTime = new Map<string, number>();

  getAlertHistory(): Alert[] {
    return [...this.alertHistory];
  }

  recordPrice(price: number): void {
    this.priceHistory.push({ price, ts: Date.now() });

    const maxWindowMs = Math.max(
      ...config.alertRules.priceChangeRules.map(r => r.windowMinutes),
    ) * 60_000;
    const cutoff = Date.now() - maxWindowMs - 60_000;
    while (this.priceHistory.length > 0 && this.priceHistory[0].ts < cutoff) {
      this.priceHistory.shift();
    }
  }

  evaluate(): Alert[] {
    const now = Date.now();
    const triggered: Alert[] = [];
    const ts = new Date().toISOString();

    if (this.priceHistory.length < 2) return [];

    const currentPrice = this.priceHistory[this.priceHistory.length - 1].price;

    for (const rule of config.alertRules.priceChangeRules) {
      const windowMs = rule.windowMinutes * 60_000;
      const cutoff = now - windowMs;
      const pricesInWindow = this.priceHistory.filter(p => p.ts >= cutoff);

      if (pricesInWindow.length === 0) continue;

      const oldPrice = pricesInWindow[0].price;
      if (oldPrice <= 0) continue;

      const changePercent = ((currentPrice - oldPrice) / oldPrice) * 100;
      const absChange = Math.abs(changePercent);

      if (absChange < rule.thresholdPercent) continue;

      const windowLabel = formatWindow(rule.windowMinutes);
      const priceDiff = currentPrice - oldPrice;
      const isSurge = changePercent > 0;

      const level: AlertLevel =
        absChange >= rule.thresholdPercent * 3 ? 'critical' :
        absChange >= rule.thresholdPercent * 1.5 ? 'warning' : 'info';

      triggered.push({
        type: isSurge ? 'price_surge' : 'price_drop',
        level,
        title: isSurge
          ? `金价${windowLabel}内涨了 ${absChange.toFixed(2)}%`
          : `金价${windowLabel}内跌了 ${absChange.toFixed(2)}%`,
        message: isSurge
          ? `过去${windowLabel}，金价从 $${oldPrice.toFixed(2)} 涨到 $${currentPrice.toFixed(2)}，涨了 $${priceDiff.toFixed(2)}（${absChange.toFixed(2)}%）`
          : `过去${windowLabel}，金价从 $${oldPrice.toFixed(2)} 跌到 $${currentPrice.toFixed(2)}，跌了 $${Math.abs(priceDiff).toFixed(2)}（${absChange.toFixed(2)}%）`,
        price: currentPrice,
        timestamp: ts,
        indicators: {
          changePercent,
          windowMinutes: rule.windowMinutes,
          oldPrice,
        },
      });
    }

    const cooldownMs = (config.alertRules.cooldownMinutes ?? 10) * 60_000;
    const passed: Alert[] = [];

    for (const alert of triggered) {
      const key = `${alert.type}_${alert.indicators.windowMinutes}`;
      const last = this.lastAlertTime.get(key) ?? 0;
      if (now - last >= cooldownMs) {
        this.lastAlertTime.set(key, now);
        this.alertHistory.push(alert);
        if (this.alertHistory.length > this.maxAlertHistory) {
          this.alertHistory.shift();
        }
        passed.push(alert);
      }
    }

    return passed;
  }
}

function formatWindow(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}小时`;
  return `${minutes}分钟`;
}
