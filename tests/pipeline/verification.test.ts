import { describe, expect, it } from "vitest";
import { normalizeArticles } from "@/lib/pipeline/normalize";
import { buildStoryCluster } from "@/lib/pipeline/rank";
import { assessStoryVerification } from "@/lib/scoring/verification";
import { makeArticle } from "../helpers/articles";

const NOW = new Date("2026-09-12T12:00:00.000Z");

describe("source quality and multi-source verification", () => {
  it("marks single-source stories as limited reporting", () => {
    const articles = normalizeArticles([
      makeArticle({
        title: "OpenAI launches new AI model",
        url: "https://example-blog.com/openai",
        sourceName: "Example Blog",
        publishedAt: "2026-09-12T10:00:00.000Z",
        snippet: "OpenAI launched a new AI model.",
      }),
    ]);

    const verification = assessStoryVerification({ articles, now: NOW });

    expect(verification.level).toBe("limited");
    expect(verification.icon).toBe("warning");
    expect(verification.label).toBe("Limited reporting");
    expect(verification.detail).toMatch(/only one source/i);
    expect(verification.independentSourceCount).toBe(1);
    expect(verification.multipleSourcesConfirmEvent).toBe(false);
    expect(verification.signals).toContain(
      "Currently reported by a single source",
    );
    expect(verification.explanation).toMatch(/tier weights from config/i);
  });

  it("marks multi-source clusters as confirmed without claiming truth", () => {
    const articles = normalizeArticles([
      makeArticle({
        title: "OpenAI launches new AI model",
        url: "https://www.reuters.com/openai",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T09:00:00.000Z",
        snippet: "OpenAI launched a new AI model.",
        sourceTier: 1,
      }),
      makeArticle({
        title: "OpenAI announces latest AI model",
        url: "https://www.bbc.com/openai",
        sourceName: "BBC",
        publishedAt: "2026-09-12T10:00:00.000Z",
        snippet: "OpenAI announced its latest AI model.",
        sourceTier: 1,
      }),
      makeArticle({
        title: "New OpenAI model released today",
        url: "https://techcrunch.com/openai",
        sourceName: "TechCrunch",
        publishedAt: "2026-09-12T11:00:00.000Z",
        snippet: "A new OpenAI model was released today.",
        sourceTier: 2,
      }),
    ]);

    const verification = assessStoryVerification({
      articles,
      similarityScore: 0.7,
      now: NOW,
    });

    expect(verification.icon).toBe("check");
    expect(verification.label).toBe("Multiple sources");
    expect(verification.independentSourceCount).toBe(3);
    expect(verification.multipleSourcesConfirmEvent).toBe(true);
    expect(verification.signals.some((s) => /3 independent sources/i.test(s))).toBe(
      true,
    );
    expect(verification.firstReportedBy).toBe("Reuters");
    expect(verification.signals).toContain("First reported by Reuters");
    expect(verification.explanation).not.toMatch(/true|false|unbiased/i);
  });

  it("treats AP and AP News as one independent publisher", () => {
    const articles = normalizeArticles([
      makeArticle({
        title: "OpenAI launches new AI model",
        url: "https://apnews.com/a",
        sourceName: "AP",
        publishedAt: "2026-09-12T09:00:00.000Z",
      }),
      makeArticle({
        title: "OpenAI launches new AI model",
        url: "https://apnews.com/b",
        sourceName: "AP News",
        publishedAt: "2026-09-12T09:30:00.000Z",
      }),
    ]);

    const verification = assessStoryVerification({ articles, now: NOW });
    expect(verification.sourceCount).toBe(2);
    expect(verification.independentSourceCount).toBe(1);
    expect(verification.level).toBe("limited");
  });

  it("flags contested stories when disagreements are supplied", () => {
    const articles = normalizeArticles([
      makeArticle({
        title: "Agency reports policy change",
        url: "https://www.reuters.com/policy",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T09:00:00.000Z",
      }),
      makeArticle({
        title: "Officials deny policy change",
        url: "https://www.bbc.com/policy",
        sourceName: "BBC",
        publishedAt: "2026-09-12T10:00:00.000Z",
      }),
    ]);

    const verification = assessStoryVerification({
      articles,
      similarityScore: 0.6,
      sourceDisagreements: [
        {
          issue: "Whether a policy change occurred",
          positions: [
            { source: "Reuters", claim: "Policy changed" },
            { source: "BBC", claim: "Officials deny change" },
          ],
        },
      ],
      now: NOW,
    });

    expect(verification.level).toBe("contested");
    expect(verification.icon).toBe("warning");
    expect(verification.signals).toContain("Sources disagree on key details");
  });

  it("attaches explainable verification to StoryCluster", () => {
    const articles = normalizeArticles([
      makeArticle({
        title: "OpenAI launches new AI model",
        url: "https://www.reuters.com/openai",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T09:00:00.000Z",
        sourceTier: 1,
      }),
      makeArticle({
        title: "OpenAI announces latest AI model",
        url: "https://www.theverge.com/openai",
        sourceName: "The Verge",
        publishedAt: "2026-09-12T10:00:00.000Z",
        sourceTier: 2,
      }),
    ]);

    const cluster = buildStoryCluster(articles, "AI", NOW, undefined, 0.72);
    expect(cluster.verification).toBeDefined();
    expect(cluster.verification.independentSourceCount).toBe(2);
    expect(cluster.verification.sourceQualityScore).toBeGreaterThan(0);
    expect(cluster.verification.sourceDiversity).toBeGreaterThan(0);
    expect(cluster.verification.sourceRecency).toBeGreaterThan(0);
    expect(cluster.verification.explanation.length).toBeGreaterThan(40);
  });
});
