import type { BriefingStory } from "@/types/briefing";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  /** Optional JSON schema hint for structured responses. */
  responseFormat?: "text" | "json";
  maxTokens?: number;
  temperature?: number;
  /**
   * Override HTTP retry count for this call.
   * Summarizer sets 0 because it owns validation/backoff retries.
   */
  maxRetries?: number;
}

export interface LlmCompletionResult {
  content: string;
  model: string;
  provider: "claude" | "gemini";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * Replaceable AI / LLM provider contract (adapter pattern).
 * Prefer one structured completion per story cluster — never per article.
 */
export interface LlmProvider {
  readonly name: "claude" | "gemini";
  isConfigured(): boolean;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
  /**
   * Optional batch briefing hook (prefer per-cluster summarizeStory instead).
   */
  synthesizeBriefing?(
    topic: string,
    clustersJson: string,
  ): Promise<BriefingStory[]>;
}

/** Alias matching product vocabulary. */
export type AIProvider = LlmProvider;
