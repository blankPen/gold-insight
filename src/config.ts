export interface FeishuConfig {
  appId: string;
  appSecret: string;
  targetOpenId: string;
}

export interface PriceChangeRule {
  windowMinutes: number;
  thresholdPercent: number;
}

export interface AlertRulesConfig {
  priceChangeRules: PriceChangeRule[];
  cooldownMinutes: number;
}

export interface AIConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface Config {
  port: number;
  logLevel: string;
  scrapeInterval: number;
  dbPath: string;
  maxSSEConnections: number;
  analysisIntervalMinutes: number;
  feishu: FeishuConfig;
  alertRules: AlertRulesConfig;
  ai: AIConfig;
}

const DEFAULTS = {
  port: 3003,
  logLevel: 'info',
  scrapeInterval: 1000,
  dbPath: './gold.db',
  maxSSEConnections: 50,
} as const;

function toInt(value: string | undefined, defaultVal: number): number {
  if (value === undefined) return defaultVal;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : defaultVal;
}

function getConfig(): Config {
  const port = toInt(process.env.PORT, DEFAULTS.port);
  const logLevel = process.env.LOG_LEVEL || DEFAULTS.logLevel;
  const scrapeInterval = toInt(process.env.SCRAPE_INTERVAL, DEFAULTS.scrapeInterval);
  const dbPath = process.env.DB_PATH || DEFAULTS.dbPath;
  const maxSSEConnections = toInt(process.env.MAX_SSE_CONNECTIONS, DEFAULTS.maxSSEConnections);

  const feishu: FeishuConfig = {
    appId: process.env.FEISHU_APP_ID || 'cli_a92bec0800f9dbde',
    appSecret: process.env.FEISHU_APP_SECRET || 'ER6YsgQ7gi8b6DkbNUmqQsEKjPhzx36z',
    targetOpenId: process.env.FEISHU_TARGET_OPEN_ID || 'ou_82fb106b096ac2a7563f9a2a6077a44d',
  };

  const defaultRules: PriceChangeRule[] = [
    { windowMinutes: 5, thresholdPercent: 0.3 },
    { windowMinutes: 15, thresholdPercent: 0.5 },
    { windowMinutes: 30, thresholdPercent: 1.0 },
    { windowMinutes: 60, thresholdPercent: 1.5 },
    { windowMinutes: 240, thresholdPercent: 3.0 },
  ];

  let priceChangeRules = defaultRules;
  const rulesEnv = process.env.ALERT_PRICE_CHANGE_RULES;
  if (rulesEnv) {
    try {
      priceChangeRules = JSON.parse(rulesEnv) as PriceChangeRule[];
    } catch {
      console.warn('[Config] Failed to parse ALERT_PRICE_CHANGE_RULES, using defaults');
    }
  }

  const alertRules: AlertRulesConfig = {
    priceChangeRules,
    cooldownMinutes: toInt(process.env.ALERT_COOLDOWN_MINUTES, 10),
  };

  const analysisIntervalMinutes = toInt(process.env.ANALYSIS_INTERVAL_MINUTES, 5);

  const ai: AIConfig = {
    provider: process.env.AI_PROVIDER || 'openai',
    model: process.env.AI_MODEL || 'MiniMax-M2.5',
    baseUrl: process.env.AI_BASE_URL || 'https://api.minimaxi.com/v1',
    apiKey: process.env.AI_API_KEY || 'sk-cp-b7xDdBP2H8XS_XT7XfGaw-m6VZF-9o-QBEYnXzlT_na8BGovqOrvxpZ3bfkwYpd734Ed-zKrpiwv1zyEaYst00kT-249EF_0si-ERBFtaWZQPzxzUt07QQ0',
  };

  const config: Config = {
    port,
    logLevel,
    scrapeInterval,
    dbPath,
    maxSSEConnections,
    analysisIntervalMinutes,
    feishu,
    alertRules,
    ai,
  };
  return config;
}

const config: Config = getConfig();
export default config;
export { getConfig };
