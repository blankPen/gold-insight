import OpenAI from 'openai';
import config from '../config';
import { AIProvider, AIAnalysisContext, AIAnalysisResult } from './provider';

function formatIndicators(ctx: AIAnalysisContext): string {
  const ind = ctx.indicators;
  if (!ind) return '';

  const lines: string[] = ['', '## 技术指标'];
  if (ind.rsi14 != null) lines.push(`- RSI(14): ${ind.rsi14.toFixed(1)}`);
  if (ind.sma20 != null) lines.push(`- SMA(20): $${ind.sma20.toFixed(2)}`);
  if (ind.ema12 != null && ind.ema26 != null) {
    lines.push(`- EMA(12): $${ind.ema12.toFixed(2)}  EMA(26): $${ind.ema26.toFixed(2)}`);
  }
  if (ind.macd) {
    lines.push(`- MACD: ${ind.macd.macdLine.toFixed(3)} / Signal: ${ind.macd.signalLine.toFixed(3)} / Histogram: ${ind.macd.histogram.toFixed(3)}`);
  }
  if (ind.bollingerBands) {
    const bb = ind.bollingerBands;
    lines.push(`- 布林带: 上轨 $${bb.upper.toFixed(2)} / 中轨 $${bb.middle.toFixed(2)} / 下轨 $${bb.lower.toFixed(2)}`);
  }
  if (ind.pivotPoints) {
    const pp = ind.pivotPoints;
    lines.push(`- 枢轴点: PP $${pp.pp.toFixed(2)} / R1 $${pp.r1.toFixed(2)} / S1 $${pp.s1.toFixed(2)}`);
  }
  return lines.join('\n');
}

function buildMessages(ctx: AIAnalysisContext): OpenAI.ChatCompletionMessageParam[] {
  const { alert, stats24h, historyContext } = ctx;
  const isPeriodic = alert.type === 'periodic_analysis';

  const parts = isPeriodic
    ? [
        `## 当前行情`,
        `- 现在金价: $${alert.price.toFixed(2)}`,
        `- ${alert.message}`,
      ]
    : [
        `## 发生了什么`,
        `- ${alert.title}`,
        `- 现在金价: $${alert.price.toFixed(2)}`,
        `- 详情: ${alert.message}`,
      ];

  if (stats24h) {
    parts.push(
      '', '## 最近24小时的情况',
      `- 最高价: $${stats24h.high24h.toFixed(2)}`,
      `- 最低价: $${stats24h.low24h.toFixed(2)}`,
      `- 平均价: $${stats24h.average24h.toFixed(2)}`,
    );
  }

  parts.push(formatIndicators(ctx));

  if (historyContext) {
    parts.push('', '## 之前的分析记录', historyContext);
  }

  const systemPrompt = isPeriodic
    ? [
        '你是一个金价行情播报员，面向的是完全不懂金融的普通人。',
        '你现在要做一次定期行情分析播报。',
        '要求:',
        '1. 用最通俗易懂的大白话，简单说说金价现在处于什么状态、走势怎样',
        '2. 参考技术指标数据，但转化为普通人能懂的说法（如"价格偏高/偏低"、"涨的势头在减弱"等）',
        '3. 如果有之前的分析记录，对比一下走势变化',
        '4. 建议部分要实在具体',
        '',
        '严格按以下 JSON 格式回复，不要包含 markdown 代码块或其他内容:',
        '{"analysis":"2-3句大白话分析","suggestion":"1句实在的建议","confidence":"high/medium/low"}',
      ].join('\n')
    : [
        '你是一个金价变动播报员，面向的是完全不懂金融的普通人。',
        '要求:',
        '1. 用最通俗易懂的大白话分析，禁止使用任何专业术语（如RSI、MACD、布林带、支撑位、压力位等）',
        '2. 就像跟朋友聊天一样，简单说说金价最近是涨是跌、幅度大不大、值不值得关注',
        '3. 如果有历史告警记录，对比一下之前的走势，说说是在持续涨/跌还是来回波动',
        '4. 建议部分要实在，不要空话套话',
        '',
        '严格按以下 JSON 格式回复，不要包含 markdown 代码块或其他内容:',
        '{"analysis":"2-3句大白话分析，说人话","suggestion":"1句实在的建议","confidence":"high/medium/low"}',
      ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n') },
  ];
}

export class OpenAIProvider implements AIProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;

  constructor() {
    this.name = `openai-compat(${config.ai.baseUrl})`;
    this.client = new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL: config.ai.baseUrl,
    });
    this.model = config.ai.model;
  }

  async isAvailable(): Promise<boolean> {
    return !!config.ai.apiKey;
  }

  async ask(messages: OpenAI.ChatCompletionMessageParam[]): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.4,
      max_tokens: 512,
    });
    return completion.choices?.[0]?.message?.content?.trim() ?? '';
  }

  async analyze(ctx: AIAnalysisContext): Promise<AIAnalysisResult | null> {
    try {
      const messages = buildMessages(ctx);

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.4,
        max_tokens: 512,
      });

      const text = completion.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) return null;

      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            analysis?: string;
            suggestion?: string;
            confidence?: string;
          };
          return {
            enhancedMessage: parsed.analysis || text,
            suggestion: parsed.suggestion || '',
            confidence: (['high', 'medium', 'low'].includes(parsed.confidence || '') ? parsed.confidence : 'medium') as 'high' | 'medium' | 'low',
            raw: text,
          };
        }
      } catch {
        // JSON parse failed
      }

      return {
        enhancedMessage: text,
        suggestion: '',
        confidence: 'low',
        raw: text,
      };
    } catch (err) {
      console.error(`[AI:${this.name}] Analysis failed:`, err);
      return null;
    }
  }
}
