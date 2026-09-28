import type { ErrorResT } from './errors';

/**
 * Reader feedback on the dictionary data (issue #327): a reader of a word
 * page reports a mistake through the public API, the instance admin works
 * the queue in the admin UI. The loop stays inside the instance — the data
 * may differ from the published dataset (user_modified, #328).
 */
export enum SuggestionStatusE {
  new = 'new',
  resolved = 'resolved',
  dismissed = 'dismissed',
}

/** A free-text report, or a structured edit the admin can apply in one click */
export enum SuggestionKindE {
  report = 'report',
  edit = 'edit',
}

/** What an edit suggestion targets; each maps to an existing admin edit endpoint */
export enum SuggestionTargetE {
  word = 'word',
  meaning = 'meaning',
  meaning_translation = 'meaning_translation',
  short_translation = 'short_translation',
}

/**
 * The proposed values of one target, the audit-diff shape: `before` is the
 * value the reader saw when filing, `after` is the proposal. Applying uses
 * `after`; the moderation queue renders the pair as a diff.
 */
export type SuggestionChangesT = Record<string, { before: string | null; after: string }>;

/**
 * One edited piece of the word form (issue #327): the reader edits the word
 * as a whole, so a single suggestion carries every touched target — the
 * entry's own fields, meanings, translations — and applying walks them all.
 */
export type SuggestionEditT = {
  target_type: SuggestionTargetE;
  /** @asType integer */
  target_id: number;
  changes: SuggestionChangesT;
};

export type SuggestionT = {
  /** @asType integer */
  id: number;
  created_at: string;
  headword: string;
  /** The entry (part of speech) the report points at, when the reader named one */
  word_id: number | null;
  message: string;
  /** Dataset version the instance held when the report was filed */
  dataset_version: string | null;
  status: SuggestionStatusE;
  kind: SuggestionKindE;
  /** Set on edit suggestions: every touched target with its before/after diff */
  edits: SuggestionEditT[] | null;
  /** The name the sender agreed to be credited by (issue #531); null when they gave none */
  author_name: string | null;
};

export type SuggestionListT = {
  items: SuggestionT[];
  /** @asType integer */
  total: number;
  /** @asType integer */
  page: number;
  /** @asType integer */
  limit: number;
  has_more: boolean;
};

// Mirrors ListSuggestionsQueryDTO (the admin listing query)
export type ListSuggestionsQueryT = {
  /** @asType integer */
  page?: number | undefined;
  /** @asType integer */
  limit?: number | undefined;
  status?: SuggestionStatusE[] | undefined;
  kind?: SuggestionKindE[] | undefined;
  search?: string | undefined;
};

export type ListSuggestionsResT = SuggestionListT | ErrorResT;
export type UpdateSuggestionStatusResT = { success: boolean } | ErrorResT;
export type DeleteSuggestionResT = { success: boolean } | ErrorResT;
export type ApplySuggestionResT = { success: boolean } | ErrorResT;
