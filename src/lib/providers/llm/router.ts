import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import { ClaudeProvider } from "@/lib/providers/llm/claude";
import { GeminiProvider } from "@/lib/providers/llm/gemini";
import type { AIProvider, LlmProvider } from "@/lib/providers/llm/types";
import type { AiProviderName } from "@/types/briefing";

const providers: Record<AiProviderName, () => LlmProvider> = {
  claude: () => new ClaudeProvider(),
  gemini: () => new GeminiProvider(),
};

export function getLlmProvider(name?: AiProviderName): LlmProvider {
  const selected = name ?? getEnv().AI_PROVIDER;
  const factory = providers[selected];

  if (!factory) {
    throw new AppError(`Unknown AI provider: ${selected}`, {
      statusCode: 500,
      code: "UNKNOWN_AI_PROVIDER",
    });
  }

  return factory();
}

/** Alias for getLlmProvider — AIProvider naming. */
export function getAIProvider(name?: AiProviderName): AIProvider {
  return getLlmProvider(name);
}

export function getAiProviderStatus(): {
  selectedProvider: AiProviderName;
  configured: boolean;
} {
  const provider = getLlmProvider();
  return {
    selectedProvider: provider.name,
    configured: provider.isConfigured(),
  };
}
