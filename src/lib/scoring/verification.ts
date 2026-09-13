import { getScoringConfig, type ScoringConfig } from "@/config/scoring";
import type { NormalizedArticle } from "@/lib/pipeline/normalize";
import {
  describeSource,
  type SourceQualityProfile,
} from "@/lib/scoring/source-quality";
import { calculateFreshness } from "@/lib/pipeline/score";
import type {
  SourceDisagreement,
  StoryVerification,
  VerificationLevel,
} from "@/types/briefing";

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function publishedMs(article: NormalizedArticle): number {
  if (!article.publishedAt) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(article.publishedAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

export type VerificationInput = {
  articles: NormalizedArticle[];
  similarityScore?: number;
  sourceDisagreements?: SourceDisagreement[];
  now?: Date;
  config?: ScoringConfig;
  /**
   * Independent sources needed for "multiple sources confirm".
   * Configurable; default 2.
   */
  multiSourceThreshold?: number;
  /** Independent sources for the stronger "well supported" band. Default 3. */
  strongMultiSourceThreshold?: number;
};

function uniqueProfiles(articles: NormalizedArticle[]): SourceQualityProfile[] {
  const byPublisher = new Map<string, SourceQualityProfile>();

  for (const article of articles) {
    const profile = describeSource(
      article.sourceName,
      article.url,
      article.sourceTier,
    );
    const existing = byPublisher.get(profile.publisherId);
    if (!existing || profile.qualityScore > existing.qualityScore) {
      byPublisher.set(profile.publisherId, profile);
    }
  }

  return [...byPublisher.values()];
}

function firstReportedBy(articles: NormalizedArticle[]): string | null {
  if (articles.length === 0) return null;
  const sorted = [...articles].sort((a, b) => publishedMs(a) - publishedMs(b));
  const first = sorted.find((article) => Number.isFinite(publishedMs(article)));
  return first?.sourceName ?? sorted[0]?.sourceName ?? null;
}

function buildSignals(args: {
  independentCount: number;
  sourceCount: number;
  multipleConfirm: boolean;
  firstReporter: string | null;
  contested: boolean;
  strongThreshold: number;
}): string[] {
  const signals: string[] = [];

  if (args.contested) {
    signals.push("Sources disagree on key details");
  }

  if (args.independentCount <= 1) {
    signals.push("Currently reported by a single source");
  } else if (args.multipleConfirm) {
    signals.push(
      args.independentCount >= args.strongThreshold
        ? `Reported by ${args.independentCount} independent sources`
        : "Multiple sources confirm the event",
    );
  }

  if (args.firstReporter) {
    signals.push(`First reported by ${args.firstReporter}`);
  }

  if (args.sourceCount > args.independentCount) {
    signals.push(
      `${args.sourceCount} named outlets mapped to ${args.independentCount} independent publishers`,
    );
  }

  return signals;
}

function chooseLevel(args: {
  independentCount: number;
  contested: boolean;
  multiThreshold: number;
  strongThreshold: number;
}): { level: VerificationLevel; label: string; detail: string; icon: "check" | "warning" } {
  if (args.contested) {
    return {
      level: "contested",
      label: "Sources diverge",
      detail: "Outlets disagree on one or more key details",
      icon: "warning",
    };
  }

  if (args.independentCount >= args.strongThreshold) {
    return {
      level: "well_supported",
      label: "Multiple sources",
      detail: `${args.independentCount} independent sources`,
      icon: "check",
    };
  }

  if (args.independentCount >= args.multiThreshold) {
    return {
      level: "confirmed",
      label: "Multiple sources",
      detail: `${args.independentCount} independent sources`,
      icon: "check",
    };
  }

  return {
    level: "limited",
    label: "Limited reporting",
    detail: "Only one source currently available",
    icon: "warning",
  };
}

/**
 * Deterministic multi-source verification for a story cluster.
 * Estimates support / attribution — never labels a story true or false.
 */
export function assessStoryVerification(
  input: VerificationInput,
): StoryVerification {
  const config = input.config ?? getScoringConfig();
  const now = input.now ?? new Date();
  const multiThreshold = input.multiSourceThreshold ?? 2;
  const strongThreshold = input.strongMultiSourceThreshold ?? 3;

  const articles = input.articles;
  const sourceNames = [
    ...new Set(articles.map((article) => article.sourceName.trim()).filter(Boolean)),
  ];
  const profiles = uniqueProfiles(articles);
  const independentSourceCount = profiles.length;
  const sourceCount = sourceNames.length;

  const sourceDiversity = clamp01(
    independentSourceCount / config.SOURCE_DIVERSITY_SATURATION,
  );
  const sourceRecency = calculateFreshness(articles, now, config);
  const sourceQualityScore =
    profiles.length === 0
      ? 0
      : clamp01(
          profiles.reduce((sum, profile) => sum + profile.qualityScore, 0) /
            profiles.length,
        );

  const similarityOk = (input.similarityScore ?? 1) >= 0.35;
  const multipleSourcesConfirmEvent =
    independentSourceCount >= multiThreshold && similarityOk;

  const contested = (input.sourceDisagreements?.length ?? 0) > 0;
  const firstReporter = firstReportedBy(articles);

  const levelInfo = chooseLevel({
    independentCount: independentSourceCount,
    contested,
    multiThreshold,
    strongThreshold,
  });

  const signals = buildSignals({
    independentCount: independentSourceCount,
    sourceCount,
    multipleConfirm: multipleSourcesConfirmEvent,
    firstReporter,
    contested,
    strongThreshold,
  });

  const explanation = [
    `Independent publishers: ${independentSourceCount}.`,
    `Named outlets: ${sourceCount}.`,
    `Source diversity score: ${round4(sourceDiversity)} (saturates at ${config.SOURCE_DIVERSITY_SATURATION}).`,
    `Source quality score: ${round4(sourceQualityScore)} (tier weights from config; not a bias rating).`,
    `Source recency score: ${round4(sourceRecency)}.`,
    multipleSourcesConfirmEvent
      ? "Multiple independent outlets cover the same clustered event."
      : "Event coverage is currently thin or single-source.",
    contested
      ? "Attributed disagreements were supplied for this cluster."
      : "No attributed source disagreements were supplied.",
  ].join(" ");

  return {
    level: levelInfo.level,
    label: levelInfo.label,
    detail: levelInfo.detail,
    icon: levelInfo.icon,
    sourceCount,
    independentSourceCount,
    sourceDiversity: round4(sourceDiversity),
    sourceRecency: round4(sourceRecency),
    sourceQualityScore: round4(sourceQualityScore),
    multipleSourcesConfirmEvent,
    firstReportedBy: firstReporter,
    signals,
    explanation,
    publishers: profiles.map((profile) => ({
      id: profile.publisherId,
      name: profile.displayName,
      tier: profile.tier,
      tierLabel: profile.tierLabel,
      qualityScore: profile.qualityScore,
    })),
  };
}
