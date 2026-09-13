import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resetEnvForTests } from "@/config/env";
import { resetDbConnectionForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import {
  clearHistory,
  getHistoryLibrary,
  getSavedStoryByRef,
  listRecentlyViewed,
  listSearchHistory,
  recordSearch,
  recordStoryView,
  saveStory,
  unsaveStoryByRef,
} from "@/lib/history/store";
import { addUserTopic, listUserTopics } from "@/lib/topics/store";

describe("news history and saved stories", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-history-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("records search history and recent searches without duplicates", () => {
    const clientId = "hist-1";
    recordSearch(clientId, "Artificial Intelligence", {
      storyCount: 3,
      briefingAt: "2026-09-12T10:00:00.000Z",
    });
    recordSearch(clientId, "artificial intelligence", {
      storyCount: 5,
      briefingAt: "2026-09-13T10:00:00.000Z",
    });
    recordSearch(clientId, "Space", { storyCount: 2 });

    const history = listSearchHistory(clientId);
    expect(history).toHaveLength(2);
    expect(history[0].topic.toLowerCase()).toContain("space");
    const ai = history.find((item) =>
      item.normalizedTopic.includes("artificial"),
    );
    expect(ai?.storyCount).toBe(5);
  });

  it("saves and unsaves stories with required fields", () => {
    const clientId = "hist-2";
    const saved = saveStory(clientId, {
      storyRefId: "story-abc",
      headline: "OpenAI launches model",
      summary: "Coverage of a model launch.",
      source: "Reuters",
      url: "https://www.reuters.com/openai",
      topic: "Artificial Intelligence",
    });

    expect(saved.headline).toBe("OpenAI launches model");
    expect(saved.savedAt).toBeTruthy();
    expect(getSavedStoryByRef(clientId, "story-abc")?.id).toBe(saved.id);

    // Idempotent re-save
    const again = saveStory(clientId, {
      storyRefId: "story-abc",
      headline: "OpenAI launches model",
      summary: "Coverage of a model launch.",
      source: "Reuters",
      url: "https://www.reuters.com/openai",
      topic: "Artificial Intelligence",
    });
    expect(again.id).toBe(saved.id);

    expect(unsaveStoryByRef(clientId, "story-abc")).toBe(true);
    expect(getSavedStoryByRef(clientId, "story-abc")).toBeNull();
  });

  it("tracks recently viewed stories and clears history without removing saves", () => {
    const clientId = "hist-3";
    saveStory(clientId, {
      storyRefId: "keep-me",
      headline: "Keep",
      summary: "Saved",
      source: "BBC",
      url: "https://www.bbc.com/keep",
      topic: "Space",
    });
    recordSearch(clientId, "Space");
    recordStoryView(clientId, {
      storyRefId: "view-1",
      headline: "Viewed story",
      source: "Reuters",
      url: "https://www.reuters.com/view",
      topic: "Space",
    });

    expect(listRecentlyViewed(clientId)).toHaveLength(1);
    const cleared = clearHistory(clientId);
    expect(cleared.searchesCleared).toBe(1);
    expect(cleared.viewedCleared).toBe(1);
    expect(getSavedStoryByRef(clientId, "keep-me")).not.toBeNull();
    expect(listSearchHistory(clientId)).toHaveLength(0);
  });

  it("builds a library that includes saved topics from preferences", () => {
    const clientId = "hist-4";
    addUserTopic(clientId, { topic: "Cybersecurity" });
    recordSearch(clientId, "Cybersecurity", { storyCount: 1 });

    const library = getHistoryLibrary(clientId);
    expect(library.recentSearches).toHaveLength(1);
    expect(listUserTopics(clientId)).toHaveLength(1);

    fs.rmSync(process.env.DATABASE_URL!, { force: true });
  });
});
