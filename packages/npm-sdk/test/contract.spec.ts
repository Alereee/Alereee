import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { VocabBloomClient } from '../src';

type PathsT = Record<string, Record<string, { operationId: string }>>;

// Every public operation has a client method (issue #275): a new endpoint
// in the spec fails here until the SDK covers it
const METHOD_BY_OPERATION: Record<string, keyof VocabBloomClient> = {
  // the searches are GET reads (issue #396); their POST forms were removed (issue #440)
  PublicSearchController_searchGet: 'search',
  PublicSearchController_searchDetailedGet: 'searchDetailed',
  PublicWordsController_list: 'words',
  PublicWordsController_byId: 'wordById',
  PublicWordsController_byHeadword: 'word',
  PublicWordsController_batch: 'wordsBatch',
  PublicWordsController_meanings: 'meanings',
  PublicWordsController_translations: 'translations',
  PublicWordsController_forms: 'forms',
  PublicWordsController_synonyms: 'synonyms',
  PublicWordsController_antonyms: 'antonyms',
  PublicWordsController_history: 'history',
  PublicDictionaryController_random: 'random',
  PublicDictionaryController_meta: 'meta',
  PublicOpenApiController_openapi: 'openapi',
  PublicSuggestionsController_create: 'suggest',
};

import { DETAILED_SEARCH_MAX_PAGE } from '../src';

describe('SDK coverage of the public contract (issue #275)', () => {
  const spec = JSON.parse(
    readFileSync(resolve(__dirname, '../../../apps/server/openapi/public-v1.json'), 'utf8'),
  ) as {
    paths: PathsT;
  };
  const operations = Object.values(spec.paths).flatMap((item) =>
    Object.values(item).map((op) => op.operationId),
  );

  it('maps every operation of openapi/public-v1.json to a client method', () => {
    expect(operations.sort()).toEqual(Object.keys(METHOD_BY_OPERATION).sort());
    const client = new VocabBloomClient({
      baseUrl: 'http://localhost',
      fetch: () => Promise.reject(new Error('unused')),
    });
    for (const method of Object.values(METHOD_BY_OPERATION)) {
      expect(typeof client[method]).toBe('function');
    }
  });

  it('stops the detailed-search iterator at the page cap the document declares', () => {
    const detailed = spec.paths['/api/v1/search/detailed'] as {
      get: { parameters: Array<{ name: string; schema: { maximum?: number } }> };
    };
    const page = detailed.get.parameters.find((p) => p.name === 'page')!;
    expect(page.schema.maximum).toBe(DETAILED_SEARCH_MAX_PAGE);
  });
});
