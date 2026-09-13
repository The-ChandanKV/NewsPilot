import type { StoredDailyBriefing } from "@/lib/jobs/types";

export type RenderedDailyBriefingEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDateLabel(date: string): string {
  const ms = Date.parse(`${date}T12:00:00.000Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Deterministic email body from a stored DailyBriefing.
 * No LLM calls — reuses headlines, summaries, whyItMatters, links, and changes.
 */
export function renderDailyBriefingEmail(
  briefing: StoredDailyBriefing,
  options?: { unsubscribeUrl?: string },
): RenderedDailyBriefingEmail {
  const dateLabel = formatDateLabel(briefing.date);
  const subject = `${briefing.topic} Daily Briefing — ${dateLabel}`;

  const topStories = briefing.stories.slice(0, 5);
  const changeLines =
    briefing.changes.highlights.length > 0
      ? briefing.changes.highlights.map((item) => {
          const detail = item.changeSummary ? ` — ${item.changeSummary}` : "";
          return `${item.status.toUpperCase()}: ${item.headline}${detail}`;
        })
      : [
          `${briefing.changes.label}: ${briefing.changes.newCount} new, ${briefing.changes.updatedCount} updated, ${briefing.changes.ongoingCount} ongoing`,
        ];

  const textParts = [
    `${briefing.topic.toUpperCase()} DAILY BRIEFING`,
    dateLabel,
    "",
    "Top stories:",
    ...topStories.map((story, index) => {
      const url = story.articleUrls[0] ? ` (${story.articleUrls[0]})` : "";
      return `${index + 1}. ${story.headline}${url}\n   ${story.summary}\n   Why it matters: ${story.whyItMatters || "n/a"}\n   Source: ${story.primarySource}`;
    }),
    "",
    "What's changed since the previous briefing:",
    ...changeLines.map((line) => `• ${line}`),
    "",
    "Why it matters (digest):",
    ...(briefing.whyItMatters.length
      ? briefing.whyItMatters.map((line) => `• ${line}`)
      : ["• See individual story notes above."]),
  ];

  if (options?.unsubscribeUrl) {
    textParts.push("", `Unsubscribe: ${options.unsubscribeUrl}`);
  }

  const htmlStories = topStories
    .map((story) => {
      const link = story.articleUrls[0]
        ? `<p><a href="${escapeHtml(story.articleUrls[0])}">${escapeHtml(story.primarySource)} — read source</a></p>`
        : `<p>Source: ${escapeHtml(story.primarySource)}</p>`;
      return `<li>
  <strong>${escapeHtml(story.headline)}</strong>
  <p>${escapeHtml(story.summary)}</p>
  <p><em>Why it matters:</em> ${escapeHtml(story.whyItMatters || "n/a")}</p>
  ${link}
</li>`;
    })
    .join("\n");

  const htmlChanges = changeLines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("\n");

  const htmlWhy = (briefing.whyItMatters.length
    ? briefing.whyItMatters
    : ["See individual story notes above."]
  )
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("\n");

  const unsubscribe = options?.unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#666"><a href="${escapeHtml(options.unsubscribeUrl)}">Unsubscribe</a></p>`
    : "";

  const html = `<!doctype html>
<html>
<body style="font-family:Georgia,serif;line-height:1.5;color:#111;max-width:640px;margin:0 auto;padding:24px">
  <p style="letter-spacing:0.12em;text-transform:uppercase;font-size:12px;color:#666">${escapeHtml(briefing.topic)} daily briefing</p>
  <h1 style="font-size:28px;margin:8px 0 4px">${escapeHtml(dateLabel)}</h1>
  <h2 style="font-size:18px;margin-top:28px">Top stories</h2>
  <ol>
    ${htmlStories || "<li>No stories for this day.</li>"}
  </ol>
  <h2 style="font-size:18px;margin-top:28px">What's changed</h2>
  <p>${escapeHtml(briefing.changes.label)}</p>
  <ul>
    ${htmlChanges}
  </ul>
  <h2 style="font-size:18px;margin-top:28px">Why it matters</h2>
  <ul>
    ${htmlWhy}
  </ul>
  ${unsubscribe}
</body>
</html>`;

  return {
    subject,
    text: textParts.join("\n"),
    html,
  };
}
