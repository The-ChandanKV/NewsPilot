import { z } from "zod";
import { sanitizeAiOutputText } from "@/lib/security";

export const storySummarySchema = z.object({
  headline: z.string().min(1).max(240),
  summary: z.string().min(1).max(4000),
  whyItMatters: z.string().min(1).max(1000),
  keyFacts: z.array(z.string().min(1)).max(12),
  entities: z.array(z.string().min(1)).max(20),
  confidence: z.enum(["high", "medium", "low"]),
  uncertaintyNotes: z.array(z.string().min(1)).max(8).default([]),
  sourceDisagreements: z
    .array(
      z.object({
        issue: z.string().min(1),
        positions: z
          .array(
            z.object({
              source: z.string().min(1),
              claim: z.string().min(1),
            }),
          )
          .min(1)
          .max(6),
      }),
    )
    .max(6)
    .default([]),
  /** Facts explicitly grounded in the provided source material. */
  reportedFacts: z.array(z.string().min(1)).max(12).default([]),
  /**
   * Optional cautious inferences. Must be empty unless clearly labeled as inference
   * and strictly supported by the inputs. Prefer [].
   */
  inferences: z.array(z.string().min(1)).max(4).default([]),
});

export type StorySummaryPayload = z.infer<typeof storySummarySchema>;

function scrubSummaryPayload(payload: StorySummaryPayload): StorySummaryPayload {
  return {
    headline: sanitizeAiOutputText(payload.headline, 240),
    summary: sanitizeAiOutputText(payload.summary, 4000),
    whyItMatters: sanitizeAiOutputText(payload.whyItMatters, 1000),
    keyFacts: payload.keyFacts
      .map((fact) => sanitizeAiOutputText(fact, 400))
      .filter(Boolean),
    entities: payload.entities
      .map((entity) => sanitizeAiOutputText(entity, 120))
      .filter(Boolean),
    confidence: payload.confidence,
    uncertaintyNotes: payload.uncertaintyNotes
      .map((note) => sanitizeAiOutputText(note, 400))
      .filter(Boolean),
    sourceDisagreements: payload.sourceDisagreements.map((item) => ({
      issue: sanitizeAiOutputText(item.issue, 300),
      positions: item.positions.map((position) => ({
        source: sanitizeAiOutputText(position.source, 120),
        claim: sanitizeAiOutputText(position.claim, 400),
      })),
    })),
    reportedFacts: payload.reportedFacts
      .map((fact) => sanitizeAiOutputText(fact, 400))
      .filter(Boolean),
    inferences: payload.inferences
      .map((fact) => sanitizeAiOutputText(fact, 400))
      .filter(Boolean),
  };
}

export function parseStorySummaryJson(raw: string): StorySummaryPayload {
  const trimmed = raw.trim();
  // Tolerate accidental markdown fences from some models.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (error) {
    throw new Error(
      `Malformed JSON from AI summarizer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return scrubSummaryPayload(storySummarySchema.parse(parsed));
}
