import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
} from "@/lib/providers/llm/types";
import { fetchWithRetry } from "@/lib/utils/http";

type GeminiPart = { text?: string };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string; code?: number };
};

function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  return text;
}

/**
 * Google Gemini adapter (Generative Language API).
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;

  isConfigured(): boolean {
    return Boolean(getEnv().GOOGLE_API_KEY);
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const env = getEnv();
    if (!env.GOOGLE_API_KEY) {
      throw new AppError("Google API key is not configured", {
        statusCode: 503,
        code: "AI_PROVIDER_NOT_CONFIGURED",
        details: { provider: this.name },
      });
    }

    const model = env.GEMINI_MODEL;
    const maxTokens = request.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS;
    const systemParts = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const contents = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    if (contents.length === 0) {
      throw new AppError("AI completion requires at least one user message", {
        statusCode: 400,
        code: "AI_INVALID_REQUEST",
      });
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent`;

    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: maxTokens,
        ...(request.responseFormat === "json"
          ? { responseMimeType: "application/json" }
          : {}),
      },
    };

    if (systemParts) {
      payload.systemInstruction = {
        parts: [{ text: systemParts }],
      };
    }

    logger.info("Calling Gemini", {
      model,
      maxTokens,
      json: request.responseFormat === "json",
    });

    const response = await fetchWithRetry(url, {
      method: "POST",
      timeoutMs: env.AI_PROVIDER_TIMEOUT_MS,
      maxRetries: env.AI_PROVIDER_MAX_RETRIES,
      errorNamespace: "ai",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GOOGLE_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as GeminiResponse;
    if (data.error?.message) {
      throw new AppError("AI provider returned an error", {
        statusCode: 502,
        code: "AI_PROVIDER_ERROR",
        details: { provider: this.name, model },
        cause: data.error.message,
      });
    }

    const content = extractText(data);
    if (!content) {
      throw new AppError("Gemini returned an empty completion", {
        statusCode: 502,
        code: "AI_EMPTY_RESPONSE",
        details: {
          provider: this.name,
          finishReason: data.candidates?.[0]?.finishReason,
        },
      });
    }

    return {
      content,
      model,
      provider: this.name,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
