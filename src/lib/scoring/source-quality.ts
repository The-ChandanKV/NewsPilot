import sourcesConfig from "../../../config/sources.json";
import { getScoringConfig } from "@/config/scoring";

export type SourceTier = 1 | 2 | 3;

export type SourceQualityProfile = {
  tier: SourceTier;
  tierLabel: string;
  tierNote: string;
  publisherId: string;
  displayName: string;
  domain?: string;
  qualityScore: number;
};

type SourcesFile = {
  tiers: Record<
    "1" | "2" | "3",
    { label: string; note: string; domains: string[]; aliases: string[] }
  >;
  publisherGroups: Array<{ id: string; names: string[] }>;
};

const config = sourcesConfig as SourcesFile;

const domainToTier = new Map<string, SourceTier>();
const aliasToTier = new Map<string, SourceTier>();

for (const [tierKey, tier] of Object.entries(config.tiers)) {
  const tierNum = Number(tierKey) as SourceTier;
  for (const domain of tier.domains) {
    domainToTier.set(domain.toLowerCase(), tierNum);
  }
  for (const alias of tier.aliases) {
    aliasToTier.set(alias.toLowerCase(), tierNum);
  }
}

const publisherLookup = new Map<string, string>();
for (const group of config.publisherGroups) {
  for (const name of group.names) {
    publisherLookup.set(name.toLowerCase(), group.id);
  }
}

export function hostnameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function matchDomainTier(host: string): SourceTier | undefined {
  if (domainToTier.has(host)) {
    return domainToTier.get(host);
  }
  for (const [domain, tier] of domainToTier) {
    if (host.endsWith(`.${domain}`)) {
      return tier;
    }
  }
  return undefined;
}

export function resolveSourceTier(
  sourceName: string,
  url?: string,
): SourceTier {
  const host = url ? hostnameFromUrl(url) : undefined;
  if (host) {
    const fromDomain = matchDomainTier(host);
    if (fromDomain) return fromDomain;
  }

  const normalized = sourceName.trim().toLowerCase();
  return aliasToTier.get(normalized) ?? 3;
}

export function sourceTierScore(tier: SourceTier): number {
  const scoring = getScoringConfig();
  if (tier === 1) return scoring.SOURCE_TIER1_SCORE;
  if (tier === 2) return scoring.SOURCE_TIER2_SCORE;
  return scoring.SOURCE_TIER3_SCORE;
}

export function resolvePublisherId(sourceName: string, url?: string): string {
  const normalized = sourceName.trim().toLowerCase();
  if (publisherLookup.has(normalized)) {
    return publisherLookup.get(normalized)!;
  }

  const host = url ? hostnameFromUrl(url) : undefined;
  if (host) {
    if (publisherLookup.has(host)) {
      return publisherLookup.get(host)!;
    }
    for (const [name, id] of publisherLookup) {
      if (host === name || host.endsWith(`.${name}`)) {
        return id;
      }
    }
    // Registrable-ish host without www as independent id.
    return host;
  }

  return normalized || "unknown";
}

export function describeSource(
  sourceName: string,
  url?: string,
  tierOverride?: SourceTier,
): SourceQualityProfile {
  const tier = tierOverride ?? resolveSourceTier(sourceName, url);
  const tierMeta = config.tiers[String(tier) as "1" | "2" | "3"];
  return {
    tier,
    tierLabel: tierMeta.label,
    tierNote: tierMeta.note,
    publisherId: resolvePublisherId(sourceName, url),
    displayName: sourceName.trim() || "Unknown",
    domain: url ? hostnameFromUrl(url) : undefined,
    qualityScore: sourceTierScore(tier),
  };
}

/** Expose config for admin/docs — no political bias fields. */
export function getSourceQualityConfig() {
  return config;
}
