import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import type { LlmProvider } from "@/lib/providers/llm/types";

/**
 * Optional one-line LLM refinement for material story updates.
 * Deterministic change summaries are the source of truth; this only
 * rephrases when EXPLAIN_CHANGES_WITH_AI is enabled and the provider works.
 */
export async function maybeExplainChangeWithAi(args: {
  deterministicSummary: string;
  previousHeadline: string;
  currentHeadline: string;
  provider: LlmProvider;
}): Promise<string | null> {
  const env = getEnv();
  if (!env.EXPLAIN_CHANGES_WITH_AI) {
    return null;
  }
  if (!args.provider.isConfigured()) {
    return null;
  }

  try {
    const completion = await args.provider.complete({
      messages: [
        {
          role: "system",
          content:
            "You explain news story changes in one short neutral sentence. Use only the provided facts. Do not invent details.",
        },
        {
          role: "user",
          content: [
            `Previous headline: ${args.previousHeadline}`,
            `Current headline: ${args.currentHeadline}`,
            `Detected changes: ${args.deterministicSummary}`,
            "Return one plain sentence describing what changed. No markdown.",
          ].join("\n"),
        },
      ],
      maxTokens: 80,
      temperature: 0.1,
    });

    const text = completion.content.trim().replace(/^["']|["']$/g, "");
    if (!text || text.length > 280) {
      return null;
    }
    return text;
  } catch (error) {
    logger.warn("Change explanation AI call failed; keeping deterministic summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
