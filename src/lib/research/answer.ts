import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getAIProvider } from "@/lib/providers/llm/router";
import type { LlmProvider } from "@/lib/providers/llm/types";
import {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchContext,
  citationsFromStories,
  parseCitationIdsUsed,
} from "@/lib/research/context";
import { retrieveRelevantStories } from "@/lib/research/retrieve";
import type {
  ResearchAnswer,
  ResearchChatOptions,
  ResearchCitation,
} from "@/lib/research/types";
import { sanitizeUntrustedText, wrapUntrustedDataBlock } from "@/lib/security";

const INSUFFICIENT_MESSAGE =
  "I don't have enough stored news context to answer that from NewsPilot's database. Try a different question, open a topic briefing first so stories are stored, or check back after the daily briefing job runs.";

function filterCitationsForAnswer(
  answer: string,
  all: ResearchCitation[],
): ResearchCitation[] {
  const used = new Set(parseCitationIdsUsed(answer));
  if (used.size === 0) {
    // Still expose retrieved sources so the UI can show clickable refs.
    return all.filter((c) => !c.id.includes(".") || c.id.endsWith(".1"));
  }
  return all.filter((c) => {
    const base = c.label;
    return used.has(base) || used.has(c.id.split(".")[0] ?? c.id);
  });
}

/**
 * Lightweight RAG: retrieve → context → AIProvider.complete → citations.
 * Does not send the full news database to the model.
 */
export async function answerResearchQuestion(
  options: ResearchChatOptions,
  deps?: { provider?: LlmProvider },
): Promise<ResearchAnswer> {
  const question = sanitizeUntrustedText(options.question.trim(), {
    maxLength: 2000,
  });
  if (!question) {
    throw new AppError("Question is required", {
      statusCode: 400,
      code: "INVALID_RESEARCH_QUESTION",
    });
  }

  const { stories, scannedBriefings } = retrieveRelevantStories({
    question,
    clientId: options.clientId,
    focusStoryIds: options.focusStoryIds,
  });

  if (stories.length === 0) {
    logger.info("Research chat: insufficient retrieval", {
      question,
      scannedBriefings,
    });
    return {
      question,
      answer: INSUFFICIENT_MESSAGE,
      insufficient: true,
      citations: [],
      retrievedStoryIds: [],
      provider: null,
      model: null,
      retrievalCount: 0,
      scannedBriefings,
    };
  }

  const provider = deps?.provider ?? getAIProvider();
  if (!provider.isConfigured()) {
    throw new AppError("AI provider is not configured", {
      statusCode: 503,
      code: "AI_NOT_CONFIGURED",
    });
  }

  const context = buildResearchContext(stories);
  const prior = options.priorExchange
    ? wrapUntrustedDataBlock("PRIOR_TURN", {
        question: sanitizeUntrustedText(options.priorExchange.question, {
          maxLength: 2000,
        }),
        answer: sanitizeUntrustedText(options.priorExchange.answer, {
          maxLength: 4000,
        }),
      })
    : "";

  const userPrompt = [
    "Answer using only the retrieved context. Cite story ids like [S1]. If context is insufficient, say so.",
    "Prior turn (if any) is for continuity only — still cite only retrieved news context.",
    context,
    prior,
    wrapUntrustedDataBlock("USER_QUESTION", question),
  ]
    .filter(Boolean)
    .join("\n\n");

  const env = getEnv();
  const completion = await provider.complete({
    messages: [
      { role: "system", content: RESEARCH_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    responseFormat: "text",
    maxTokens: Math.min(env.AI_MAX_OUTPUT_TOKENS, 1200),
    temperature: 0.2,
  });

  const allCitations = citationsFromStories(stories);
  let answer = completion.content.trim().slice(0, 8000);
  const insufficient =
    /not enough|insufficient|don't have enough|do not have enough|no stored news|cannot answer from the (provided|retrieved)/i.test(
      answer,
    );

  // Ensure a Sources section with clickable URLs when the model omitted it.
  if (!insufficient && !/\bSources:\b/i.test(answer) && allCitations.length > 0) {
    const lines = allCitations
      .filter((c) => c.id === c.label || c.id.endsWith(".1"))
      .slice(0, stories.length)
      .map((c) => `[${c.label}] ${c.title} — ${c.url}`);
    answer = `${answer}\n\nSources:\n${lines.join("\n")}`;
  }

  const citations = filterCitationsForAnswer(answer, allCitations);

  logger.info("Research chat answered", {
    question,
    retrievalCount: stories.length,
    scannedBriefings,
    insufficient,
    provider: completion.provider,
    citationCount: citations.length,
  });

  return {
    question,
    answer,
    insufficient,
    citations,
    retrievedStoryIds: stories.map((s) => s.storyId),
    provider: completion.provider,
    model: completion.model,
    retrievalCount: stories.length,
    scannedBriefings,
  };
}
