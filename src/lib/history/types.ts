export type SearchHistoryEntry = {
  id: string;
  clientId: string;
  topic: string;
  normalizedTopic: string;
  storyCount: number;
  lastBriefingAt: string | null;
  searchedAt: string;
};

export type SavedStory = {
  id: string;
  clientId: string;
  storyRefId: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  topic: string;
  savedAt: string;
};

export type RecentlyViewedStory = {
  id: string;
  clientId: string;
  storyRefId: string;
  headline: string;
  source: string;
  url: string;
  topic: string;
  viewedAt: string;
};

export type HistoryLibrary = {
  recentSearches: SearchHistoryEntry[];
  searchHistory: SearchHistoryEntry[];
  savedStories: SavedStory[];
  recentlyViewed: RecentlyViewedStory[];
};

export type SaveStoryInput = {
  storyRefId: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  topic: string;
};

export type ViewStoryInput = {
  storyRefId: string;
  headline: string;
  source: string;
  url: string;
  topic: string;
};
