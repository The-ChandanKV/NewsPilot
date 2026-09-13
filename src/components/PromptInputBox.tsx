"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ResearchAnswer, ResearchCitation } from "@/lib/research/types";

const SUGGESTIONS = [
  "What happened with OpenAI today?",
  "Why is this important?",
  "How has this story changed since yesterday?",
  "Who are the major companies involved?",
  "Show me the different sources covering this.",
  "Compare how different sources reported this event.",
];

type Props = {
  onOpenTopic?: (topic: string) => void;
};

function linkifyAnswer(text: string, citations: ResearchCitation[]) {
  const urlToCitation = new Map(citations.map((c) => [c.url, c]));
  const parts: Array<{ type: "text" | "link"; value: string; href?: string }> =
    [];
  const regex = /(https?:\/\/[^\s\]]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: text.slice(last, match.index) });
    }
    const href = match[1].replace(/[.,);]+$/, "");
    parts.push({ type: "link", value: href, href });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ type: "text", value: text.slice(last) });
  }

  // Prefer citation titles when we recognize the URL.
  return parts.map((part, index) => {
    if (part.type === "link" && part.href) {
      const citation = urlToCitation.get(part.href);
      return (
        <a
          key={`${part.href}-${index}`}
          href={part.href}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] underline underline-offset-2"
        >
          {citation ? citation.source : part.value}
        </a>
      );
    }
    return <span key={`t-${index}`}>{part.value}</span>;
  });
}

export function PromptInputBox({ onOpenTopic }: Props) {
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchAnswer | null>(null);
  const [focusStoryIds, setFocusStoryIds] = useState<string[]>([]);
  const [priorExchange, setPriorExchange] = useState<{
    question: string;
    answer: string;
  } | null>(null);

  const answerNodes = useMemo(() => {
    if (!result) return null;
    return linkifyAnswer(result.answer, result.citations);
  }, [result]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          focusStoryIds,
          priorExchange: priorExchange ?? undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Research request failed");
      }
      const answer = payload as ResearchAnswer;
      setResult(answer);
      setFocusStoryIds(answer.retrievedStoryIds);
      setPriorExchange({
        question: answer.question,
        answer: answer.answer,
      });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await ask(draft);
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Research chat
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Ask about stored news only. Answers are retrieved from briefings and
          citations — not invented from general knowledge.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="research-prompt">
          Ask a news research question
        </label>
        <input
          id="research-prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What happened with OpenAI today?"
          disabled={loading}
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-transparent px-4 py-3 text-sm outline-none ring-[var(--accent)] focus:ring-1 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          className="rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-black disabled:opacity-50"
        >
          {loading ? "Researching…" : "Ask"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={loading}
            onClick={() => void ask(suggestion)}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:text-[var(--fg)] disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4 border-t border-[var(--border)] pt-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              Question
            </p>
            <p className="mt-1 text-sm">{result.question}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              Answer
              {result.insufficient ? " · insufficient context" : ""}
            </p>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {answerNodes}
            </div>
          </div>

          {result.citations.length > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                Source references
              </p>
              <ul className="mt-2 space-y-2 text-sm">
                {result.citations.map((citation) => (
                  <li key={`${citation.id}-${citation.url}`}>
                    <span className="text-[var(--muted)]">[{citation.label}]</span>{" "}
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] underline underline-offset-2"
                    >
                      {citation.title}
                    </a>
                    <span className="text-[var(--muted)]">
                      {" "}
                      · {citation.source}
                      {citation.topic ? ` · ${citation.topic}` : ""}
                    </span>
                    {citation.topic && onOpenTopic ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="text-xs text-[var(--muted)] underline"
                          onClick={() => onOpenTopic(citation.topic!)}
                        >
                          Open topic
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-xs text-[var(--muted)]">
            Retrieved {result.retrievalCount} stor
            {result.retrievalCount === 1 ? "y" : "ies"} from{" "}
            {result.scannedBriefings} stored briefing
            {result.scannedBriefings === 1 ? "" : "s"}
            {result.provider ? ` · ${result.provider}` : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
