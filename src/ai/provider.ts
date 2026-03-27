import { Alert } from '../alert-engine';
import { OpenAI } from 'openai';

export interface AIAnalysisResult {
  enhancedMessage: string;
  suggestion: string;
  confidence: 'high' | 'medium' | 'low';
  raw?: string;
}

export interface AIAnalysisContext {
  alert: Alert;
  stats24h?: { high24h: number; low24h: number; average24h: number };
  historyContext?: string;
  indicators?: {
    sma20?: number | null;
    ema12?: number | null;
    ema26?: number | null;
    rsi14?: number | null;
    macd?: { macdLine: number; signalLine: number; histogram: number } | null;
    bollingerBands?: { upper: number; middle: number; lower: number } | null;
    pivotPoints?: { pp: number; r1: number; s1: number } | null;
  };
}

export interface AIProvider {
  readonly name: string;

  analyze(ctx: AIAnalysisContext): Promise<AIAnalysisResult | null>;

  ask(messages: OpenAI.ChatCompletionMessageParam[]): Promise<string>;

  isAvailable(): Promise<boolean>;
}
