import config from './config';
import { Alert, AlertLevel } from './alert-engine';
import { AIAnalysisResult } from './ai/provider';

const BASE_URL = 'https://open.feishu.cn/open-apis';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getTenantAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    }),
  });

  const data = await res.json() as {
    code: number;
    msg: string;
    tenant_access_token: string;
    expire: number;
  };

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get feishu token: ${data.msg ?? JSON.stringify(data)}`);
  }

  cachedToken = data.tenant_access_token;
  tokenExpiresAt = Date.now() + (data.expire - 300) * 1000;
  console.log('[Feishu] Obtained tenant_access_token, expires in', data.expire, 's');
  return cachedToken;
}

const LEVEL_TEMPLATE: Record<AlertLevel, { color: string; emoji: string }> = {
  critical: { color: 'red', emoji: '\u{1F6A8}' },
  warning: { color: 'orange', emoji: '\u26A0\uFE0F' },
  info: { color: 'blue', emoji: '\u2139\uFE0F' },
};

function buildInteractiveCard(alert: Alert, aiResult?: AIAnalysisResult | null): string {
  const tpl = LEVEL_TEMPLATE[alert.level];

  const elements: any[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**\u{1F4B0} \u5F53\u524D\u91D1\u4EF7**: $${alert.price.toFixed(2)}\n**\u23F0 \u65F6\u95F4**: ${alert.timestamp}`,
      },
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: alert.message,
      },
    },
  ];

  if (aiResult) {
    const confidenceLabel = { high: '\u{1F7E2} \u53EF\u4FE1\u5EA6\u9AD8', medium: '\u{1F7E1} \u53EF\u4FE1\u5EA6\u4E2D', low: '\u{1F534} \u53EF\u4FE1\u5EA6\u4F4E' }[aiResult.confidence];
    elements.push(
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**\u{1F916} AI \u600E\u4E48\u770B** ${confidenceLabel}\n${aiResult.enhancedMessage}`,
        },
      },
    );
    if (aiResult.suggestion) {
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**\u{1F4A1} \u5EFA\u8BAE**: ${aiResult.suggestion}`,
        },
      });
    }
  }

  elements.push(
    {
      tag: 'note',
      elements: [
        { tag: 'plain_text', content: '\u6570\u636E\u6765\u6E90: XAUUSD \u5B9E\u65F6\u884C\u60C5 | AI \u5206\u6790\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE' },
      ],
    },
  );

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${tpl.emoji} ${alert.title}` },
      template: tpl.color,
    },
    elements,
  };

  return JSON.stringify(card);
}

export async function sendAlert(alert: Alert, aiResult?: AIAnalysisResult | null): Promise<boolean> {
  try {
    const token = await getTenantAccessToken();

    const body = {
      receive_id: config.feishu.targetOpenId,
      msg_type: 'interactive',
      content: buildInteractiveCard(alert, aiResult),
    };

    const res = await fetch(
      `${BASE_URL}/im/v1/messages?receive_id_type=open_id`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await res.json() as { code: number; msg: string };
    if (data.code !== 0) {
      console.error('[Feishu] Send failed:', data.msg, JSON.stringify(data));
      return false;
    }

    console.log(`[Feishu] Alert sent: ${alert.title}`);
    return true;
  } catch (err) {
    console.error('[Feishu] Error sending alert:', err);
    return false;
  }
}

export async function sendTextMessage(text: string): Promise<boolean> {
  try {
    const token = await getTenantAccessToken();

    const body = {
      receive_id: config.feishu.targetOpenId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    };

    const res = await fetch(
      `${BASE_URL}/im/v1/messages?receive_id_type=open_id`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await res.json() as { code: number; msg: string };
    if (data.code !== 0) {
      console.error('[Feishu] Send text failed:', data.msg);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Feishu] Error sending text:', err);
    return false;
  }
}
