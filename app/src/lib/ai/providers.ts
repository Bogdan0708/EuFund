import OpenAI from 'openai';

export type AIProvider = 'openai' | 'anthropic' | 'gemini';

const clients: Map<string, OpenAI> = new Map();

/**
 * Get a direct OpenAI-compatible client for a provider.
 * Anthropic and Gemini both offer OpenAI-compatible endpoints.
 */
export function getDirectClient(provider: AIProvider = 'openai'): OpenAI | null {
  if (clients.has(provider)) {
    return clients.get(provider)!;
  }

  let client: OpenAI | null = null;

  switch (provider) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      client = new OpenAI({ apiKey });
      break;
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return null;
      // Anthropic's OpenAI-compatible endpoint
      client = new OpenAI({
        apiKey,
        baseURL: 'https://api.anthropic.com/v1/',
      });
      break;
    }
    case 'gemini': {
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (!apiKey) return null;
      client = new OpenAI({
        apiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
      break;
    }
  }

  if (client) {
    clients.set(provider, client);
  }
  return client;
}

/**
 * Get any available client — gateway first, then direct providers.
 */
export function getAnyClient(gatewayClient: OpenAI | null): OpenAI {
  if (gatewayClient) return gatewayClient;

  // Try direct providers in priority order
  for (const provider of ['openai', 'anthropic', 'gemini'] as AIProvider[]) {
    const client = getDirectClient(provider);
    if (client) return client;
  }

  throw new Error(
    'No AI provider available. Set AI_GATEWAY_URL or at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY'
  );
}
