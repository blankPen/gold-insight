import { AIProvider, AIAnalysisContext, AIAnalysisResult } from './provider';
import { OpenAIProvider } from './openai-provider';
import config from '../config';

export { AIProvider, AIAnalysisContext, AIAnalysisResult } from './provider';

class NoopProvider implements AIProvider {
  readonly name = 'noop';
  async isAvailable() { return true; }
  async analyze() { return null; }
  async ask(): Promise<string> { return ''; }
}

let currentProvider: AIProvider | null = null;

function createProvider(): AIProvider {
  const providerName = config.ai.provider;

  switch (providerName) {
    case 'openai':
      return new OpenAIProvider();
    case 'none':
      return new NoopProvider();
    default:
      return new OpenAIProvider();
  }
}

export function getAIProvider(): AIProvider {
  if (!currentProvider) {
    currentProvider = createProvider();
    console.log(`[AI] Using provider: ${currentProvider.name}`);
  }
  return currentProvider;
}

export function setAIProvider(provider: AIProvider): void {
  currentProvider = provider;
  console.log(`[AI] Provider switched to: ${provider.name}`);
}

export async function analyzeAlert(ctx: AIAnalysisContext): Promise<AIAnalysisResult | null> {
  const provider = getAIProvider();
  if (provider.name === 'noop') return null;

  const available = await provider.isAvailable();
  if (!available) {
    console.warn(`[AI] Provider "${provider.name}" is not available, skipping analysis`);
    return null;
  }

  return provider.analyze(ctx);
}
