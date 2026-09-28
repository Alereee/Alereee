import { ConfigurationError } from '../../../configuration';
import { RateLimitT } from '../../core/utils/public-api';

// The public intake is meant for a handful of honest reports, not a feed: a
// few per hour from one client is plenty (issue #327). The e2e suites raise
// it through the environment.
export const DEFAULT_SUGGESTIONS_RATE_LIMIT: RateLimitT = { limit: 5, ttl: 3_600_000 };

/** `SUGGESTIONS_RATE_LIMIT=<requests>/<seconds>`, e.g. `5/3600` (the default) */
export const parseSuggestionsRateLimit = (raw: string | undefined): RateLimitT => {
  const value = raw?.trim();
  if (!value) return DEFAULT_SUGGESTIONS_RATE_LIMIT;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const limit = match ? Number(match[1]) : NaN;
  const seconds = match ? Number(match[2]) : NaN;
  if (!match || limit < 1 || seconds < 1) {
    throw new ConfigurationError(
      `SUGGESTIONS_RATE_LIMIT must look like "<requests>/<seconds>", e.g. 5/3600; got "${value}".`,
    );
  }
  return { limit, ttl: seconds * 1000 };
};

// Read per request, like PUBLIC_API_RATE_LIMIT; an invalid value fails startup
export const getSuggestionsRateLimit = (env: NodeJS.ProcessEnv = process.env): RateLimitT => {
  try {
    return parseSuggestionsRateLimit(env.SUGGESTIONS_RATE_LIMIT);
  } catch {
    return DEFAULT_SUGGESTIONS_RATE_LIMIT;
  }
};

/** The @Throttle() of the public intake, an order of magnitude below the general public budget */
export const SUGGESTIONS_THROTTLE = {
  default: { limit: () => getSuggestionsRateLimit().limit, ttl: () => getSuggestionsRateLimit().ttl },
};

// Past this many reports waiting for the admin the intake answers 503
// (suggestion_queue_full) instead of hoarding spam
export const MAX_OPEN_SUGGESTIONS = 500;

export const SUGGESTION_MESSAGE_MIN_LENGTH = 10;
export const SUGGESTION_MESSAGE_MAX_LENGTH = 2000;
export const SUGGESTION_VALUE_MAX_LENGTH = 2000;

// one form edit touches at most this many targets (fields of the entry,
// its meanings and translations together)
export const MAX_SUGGESTION_EDITS = 50;

// The fields an edit suggestion may propose, per target — each set is a
// subset of the matching admin edit DTO, so applying is exactly the edit
// the admin would have typed (issue #327)
export const EDITABLE_FIELDS = {
  word: ['description', 'transcription'],
  meaning: ['title', 'definition'],
  meaning_translation: ['title', 'definition'],
  short_translation: ['description'],
} as const;

// the name a sender asks to be credited by (issue #531)
export const SUGGESTION_AUTHOR_MAX_LENGTH = 80;
