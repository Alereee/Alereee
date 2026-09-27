import 'server-only';

import type { PublicHeadwordV1ResT, PublicMetaV1ResT, PublicWordV1ResT } from 'server/types';

import { serverApiBase } from './apiBase';
import { DatasetTermsT, OWN_DATASET_TERMS } from './datasetTerms';
import { getWithOneRetry, internalApiHeaders } from './internalApi';

// The word pages are rendered on the server from the instance's public API
// and cached for an hour: the dictionary changes rarely, a page is asked
// for often once it is indexed
const REVALIDATE_SECONDS = 3600;

/**
 * Thrown by a page that cannot be rendered without the API (issue #480): the
 * route-level error boundary shows it and Next answers 500 with no-store, so
 * neither a crawler nor a cache keeps a placeholder for a page that exists
 */
export class DictionaryUnavailableError extends Error {
  constructor() {
    super('the dictionary API is unavailable');
    this.name = 'DictionaryUnavailableError';
  }
}

export type HeadwordResultT =
  { kind: 'found'; result: PublicHeadwordV1ResT } | { kind: 'not_found' } | { kind: 'unavailable' };

/** GET /api/v1/words/{word}: every entry of a headword, or why there is none */
export const fetchHeadword = async (word: string): Promise<HeadwordResultT> => {
  try {
    // the site's own traffic (internalApi.ts): not counted against the public
    // budget with INTERNAL_API_TOKEN set, and a brief 429 is retried once
    const res = await getWithOneRetry(() =>
      fetch(`${serverApiBase()}/v1/words/${encodeURIComponent(word)}`, {
        headers: internalApiHeaders(),
        next: { revalidate: REVALIDATE_SECONDS },
      }),
    );
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'unavailable' };

    return { kind: 'found', result: (await res.json()) as PublicHeadwordV1ResT };
  } catch {
    return { kind: 'unavailable' };
  }
};

/** GET /api/v1/random: the headword of a random base-form entry, null when the API does not answer */
export const fetchRandomWord = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${serverApiBase()}/v1/random`, {
      headers: internalApiHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;

    return ((await res.json()) as PublicWordV1ResT).data.word;
  } catch {
    return null;
  }
};

/** GET /api/v1/meta, reduced to the terms of the data; the project's own when the API does not say */
export const fetchDatasetTerms = async (): Promise<DatasetTermsT> => {
  try {
    const res = await getWithOneRetry(() =>
      fetch(`${serverApiBase()}/v1/meta`, {
        headers: internalApiHeaders(),
        next: { revalidate: REVALIDATE_SECONDS },
      }),
    );
    if (!res.ok) return OWN_DATASET_TERMS;
    const { data } = (await res.json()) as PublicMetaV1ResT;
    if (!data.source) return OWN_DATASET_TERMS;
    return {
      source: data.source,
      license: data.license,
      license_url: data.license_url,
      attribution: data.attribution,
      attribution_url: data.attribution_url ?? null,
      notice: data.notice,
    };
  } catch {
    return OWN_DATASET_TERMS;
  }
};
