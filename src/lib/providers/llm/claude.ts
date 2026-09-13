import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "@/lib/providers/llm/types";

export class ClaudeProvider implements LlmProvider {
  readonly name = "claude" as const;

  isConfigured(): boolean {
    return Boolean(getEnv().ANTHROPIC_API_KEY);
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.isConfigured()) {
      throw new AppError("Anthropic API key is not configured", {
        statusCode: 503,
        code: "AI_PROVIDER_NOT_CONFIGURED",
        details: { provider: this.name },
      });
    }

    // Phase 1: interface + config only. Live Claude calls come in a later phase.
    void request;
    throw new AppError("Claude completion is not implemented in Phase 1", {
      statusCode: 501,
      code: "AI_NOT_IMPLEMENTED",
      details: { provider: this.name, model: getEnv().ANTHROPIC_MODEL },
    });
  }
}
