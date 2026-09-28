import {
  AvailableTranslationLanguagesE,
  CategoryE,
  EnAreaVariantsE,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
  LanguageRegisterE,
  WordLevelE,
} from 'server/types';
import { DATASET_CATALOG } from 'server/core/constants/dataset_catalog';

// Endpoints open to any consumer of the dictionary; the auth routes are admin
// panel plumbing and stay out of the public documentation
export enum ApiEndpointKeyE {
  search_get = 'search_get',
  search_detailed_get = 'search_detailed_get',
  word = 'word',
  words_batch = 'words_batch',
  word_meanings = 'word_meanings',
  word_translations = 'word_translations',
  word_forms = 'word_forms',
  word_synonyms = 'word_synonyms',
  word_antonyms = 'word_antonyms',
  word_history = 'word_history',
  word_datasets = 'word_datasets',
  word_dataset_history = 'word_dataset_history',
  word_by_id = 'word_by_id',
  words = 'words',
  random = 'random',
  meta = 'meta',
  suggestions = 'suggestions',
  openapi = 'openapi',
}

export enum ParamControlE {
  text = 'text',
  number = 'number',
  boolean = 'boolean',
  enum = 'enum',
  multi_enum = 'multi_enum',
  // A free list of strings typed as one comma-separated text (the batch lookup, issue #397)
  text_list = 'text_list',
}

export type ApiParamDocT = {
  name: string;
  type: string;
  control: ParamControlE;
  required: boolean;
  // A path segment (`/words/{word}`) rather than a body field or query key
  inPath?: boolean;
  defaultValue?: string | number | boolean | string[];
  min?: number;
  max?: number;
  // Free-form limitation shown when there is no range or option list, e.g. a regexp
  constraints?: string;
  options?: string[];
};

export type ApiEndpointDocT = {
  key: ApiEndpointKeyE;
  // Segment under /documentation
  slug: string;
  method: 'GET' | 'POST';
  // Route as mounted on the server, shown in the docs header; `{name}` marks a path param
  path: string;
  // Path relative to the API base url, used to run the live example
  clientPath: string;
  // Per-endpoint limit; endpoints without one share the public prefix budget
  // (PUBLIC_API_RATE_LIMIT on the server, 100 requests per 60 s by default)
  throttle?: { limit: number; seconds: number };
  // Body fields of a POST, query keys of a GET, path params where `inPath` is set
  params: ApiParamDocT[];
  responseType: string;
};

const SEARCH_TERM_PARAM: ApiParamDocT = {
  name: 'search',
  type: 'string',
  control: ParamControlE.text,
  required: true,
};

const ENTRY_TYPE_PARAM: ApiParamDocT = {
  name: 'type',
  type: 'EnEntryTypesE',
  control: ParamControlE.enum,
  required: false,
  options: Object.values(EnEntryTypesE),
};

const HEADWORD_PARAM: ApiParamDocT = {
  name: 'word',
  type: 'string',
  control: ParamControlE.text,
  required: true,
  inPath: true,
};

// the datasets an instance can hold are a closed catalog
const DATASET_PARAM: ApiParamDocT = {
  name: 'dataset',
  type: 'string',
  control: ParamControlE.enum,
  required: true,
  inPath: true,
  options: DATASET_CATALOG.map((entry) => entry.name),
};

const multiEnum = (name: string, type: string, values: Record<string, string>): ApiParamDocT => ({
  name,
  type: `${type}[]`,
  control: ParamControlE.multi_enum,
  required: false,
  options: Object.values(values),
});

// Filters shared by the list and the random entry (WordFiltersV1QueryDTO on the server)
const WORD_FILTER_PARAMS: ApiParamDocT[] = [
  { name: 'search', type: 'string', control: ParamControlE.text, required: false, max: 128 },
  { name: 'is_obsolete', type: 'boolean', control: ParamControlE.boolean, required: false },
  multiEnum('part_of_speech', 'EnPartOfSpeechE', EnPartOfSpeechE),
  multiEnum('word_level', 'WordLevelE', WordLevelE),
  multiEnum('language_register', 'LanguageRegisterE', LanguageRegisterE),
  multiEnum('category', 'CategoryE', CategoryE),
  multiEnum('area_variant', 'EnAreaVariantsE', EnAreaVariantsE),
  {
    ...multiEnum('form_of_word', 'EnWordFormsE', EnWordFormsE),
    defaultValue: [EnWordFormsE.base_form],
  },
];

const WITH_MEANINGS_PARAM: ApiParamDocT = {
  name: 'with_meanings',
  type: 'boolean',
  control: ParamControlE.boolean,
  required: false,
  defaultValue: false,
};

const WITH_TRANSLATIONS_PARAM: ApiParamDocT = {
  name: 'with_translations',
  type: 'boolean',
  control: ParamControlE.boolean,
  required: false,
  defaultValue: false,
};

// The fields of the search, shared by its GET (query) and POST (body) forms (issue #396)
const SEARCH_PARAMS: ApiParamDocT[] = [
  SEARCH_TERM_PARAM,
  ENTRY_TYPE_PARAM,
  {
    name: 'limit',
    type: 'number',
    control: ParamControlE.number,
    required: false,
    defaultValue: 10,
    min: 1,
    max: 100,
  },
];

const SEARCH_DETAILED_PARAMS: ApiParamDocT[] = [
  SEARCH_TERM_PARAM,
  ENTRY_TYPE_PARAM,
  {
    name: 'limit',
    type: 'number',
    control: ParamControlE.number,
    required: false,
    defaultValue: 10,
    min: 1,
    max: 20,
  },
  {
    name: 'page',
    type: 'number',
    control: ParamControlE.number,
    required: false,
    defaultValue: 1,
    min: 1,
    max: 20,
  },
  WITH_MEANINGS_PARAM,
  WITH_TRANSLATIONS_PARAM,
  {
    name: 'translation_languages',
    type: 'AvailableTranslationLanguagesE[]',
    control: ParamControlE.multi_enum,
    required: false,
    options: Object.values(AvailableTranslationLanguagesE),
  },
];

export const DOCUMENTED_ENDPOINTS: ApiEndpointDocT[] = [
  {
    key: ApiEndpointKeyE.search_get,
    slug: 'search',
    method: 'GET',
    path: '/api/v1/search',
    clientPath: '/v1/search',
    responseType: 'PublicSearchV1ResT',
    params: SEARCH_PARAMS,
  },
  {
    key: ApiEndpointKeyE.search_detailed_get,
    slug: 'search-detailed',
    method: 'GET',
    path: '/api/v1/search/detailed',
    clientPath: '/v1/search/detailed',
    responseType: 'PublicSearchDetailedV1ResT',
    params: SEARCH_DETAILED_PARAMS,
  },
  {
    key: ApiEndpointKeyE.word,
    slug: 'word',
    method: 'GET',
    path: '/api/v1/words/{word}',
    clientPath: '/v1/words/{word}',
    responseType: 'PublicHeadwordV1ResT',
    params: [HEADWORD_PARAM],
  },
  {
    key: ApiEndpointKeyE.words_batch,
    slug: 'words-batch',
    method: 'POST',
    path: '/api/v1/words/batch',
    clientPath: '/v1/words/batch',
    responseType: 'PublicWordsBatchV1ResT',
    params: [
      {
        name: 'words',
        type: 'string[]',
        control: ParamControlE.text_list,
        required: true,
        min: 1,
        max: 50,
        constraints: 'comma-separated',
      },
    ],
  },
  {
    key: ApiEndpointKeyE.word_meanings,
    slug: 'word-meanings',
    method: 'GET',
    path: '/api/v1/words/{word}/meanings',
    clientPath: '/v1/words/{word}/meanings',
    responseType: 'PublicHeadwordMeaningsV1ResT',
    params: [HEADWORD_PARAM],
  },
  {
    key: ApiEndpointKeyE.word_translations,
    slug: 'word-translations',
    method: 'GET',
    path: '/api/v1/words/{word}/translations',
    clientPath: '/v1/words/{word}/translations',
    responseType: 'PublicHeadwordTranslationsV1ResT',
    params: [
      HEADWORD_PARAM,
      multiEnum('language', 'AvailableTranslationLanguagesE', AvailableTranslationLanguagesE),
    ],
  },
  {
    key: ApiEndpointKeyE.word_forms,
    slug: 'word-forms',
    method: 'GET',
    path: '/api/v1/words/{word}/forms',
    clientPath: '/v1/words/{word}/forms',
    responseType: 'PublicHeadwordFormsV1ResT',
    params: [HEADWORD_PARAM],
  },
  {
    key: ApiEndpointKeyE.word_synonyms,
    slug: 'word-synonyms',
    method: 'GET',
    path: '/api/v1/words/{word}/synonyms',
    clientPath: '/v1/words/{word}/synonyms',
    responseType: 'PublicHeadwordLinksV1ResT',
    params: [HEADWORD_PARAM],
  },
  {
    key: ApiEndpointKeyE.word_antonyms,
    slug: 'word-antonyms',
    method: 'GET',
    path: '/api/v1/words/{word}/antonyms',
    clientPath: '/v1/words/{word}/antonyms',
    responseType: 'PublicHeadwordLinksV1ResT',
    params: [HEADWORD_PARAM],
  },
  {
    key: ApiEndpointKeyE.word_history,
    slug: 'word-history',
    method: 'GET',
    path: '/api/v1/words/{word}/history',
    clientPath: '/v1/words/{word}/history',
    responseType: 'PublicHeadwordHistoryV1ResT',
    params: [HEADWORD_PARAM],
  },
  {
    key: ApiEndpointKeyE.word_datasets,
    slug: 'word-datasets',
    method: 'GET',
    path: '/api/v1/words/{word}/datasets',
    clientPath: '/v1/words/{word}/datasets',
    responseType: 'PublicWordDatasetsV1ResT',
    params: [HEADWORD_PARAM],
  },
  {
    key: ApiEndpointKeyE.word_dataset_history,
    slug: 'word-dataset-history',
    method: 'GET',
    path: '/api/v1/words/{word}/datasets/{dataset}/history',
    clientPath: '/v1/words/{word}/datasets/{dataset}/history',
    responseType: 'PublicHeadwordHistoryV1ResT',
    params: [HEADWORD_PARAM, DATASET_PARAM],
  },
  {
    key: ApiEndpointKeyE.word_by_id,
    slug: 'word-by-id',
    method: 'GET',
    path: '/api/v1/words/id/{id}',
    clientPath: '/v1/words/id/{id}',
    responseType: 'PublicWordV1ResT',
    params: [
      { name: 'id', type: 'number', control: ParamControlE.number, required: true, inPath: true, min: 1 },
    ],
  },
  {
    key: ApiEndpointKeyE.words,
    slug: 'words',
    method: 'GET',
    path: '/api/v1/words',
    clientPath: '/v1/words',
    responseType: 'PublicWordsV1ResT',
    params: [
      ...WORD_FILTER_PARAMS,
      {
        name: 'cursor',
        type: 'string',
        control: ParamControlE.text,
        required: false,
        constraints: 'meta.next_cursor',
      },
      {
        name: 'limit',
        type: 'number',
        control: ParamControlE.number,
        required: false,
        defaultValue: 20,
        min: 1,
        max: 100,
      },
      WITH_MEANINGS_PARAM,
      WITH_TRANSLATIONS_PARAM,
    ],
  },
  {
    key: ApiEndpointKeyE.random,
    slug: 'random',
    method: 'GET',
    path: '/api/v1/random',
    clientPath: '/v1/random',
    responseType: 'PublicWordV1ResT',
    params: WORD_FILTER_PARAMS,
  },
  {
    key: ApiEndpointKeyE.meta,
    slug: 'meta',
    method: 'GET',
    path: '/api/v1/meta',
    clientPath: '/v1/meta',
    responseType: 'PublicMetaV1ResT',
    params: [],
  },
  {
    key: ApiEndpointKeyE.suggestions,
    slug: 'suggestions',
    method: 'POST',
    path: '/api/v1/suggestions',
    clientPath: '/v1/suggestions',
    responseType: 'PublicSuggestionCreatedV1ResT',
    // SUGGESTIONS_RATE_LIMIT on the server; its own bucket, not the shared one
    throttle: { limit: 5, seconds: 3600 },
    params: [
      { name: 'headword', type: 'string', control: ParamControlE.text, required: true },
      {
        name: 'message',
        type: 'string',
        control: ParamControlE.text,
        required: true,
        constraints: '10–2000 characters',
      },
      { name: 'word_id', type: 'number', control: ParamControlE.number, required: false, min: 1 },
    ],
  },
  {
    key: ApiEndpointKeyE.openapi,
    slug: 'openapi',
    method: 'GET',
    path: '/api/v1/openapi.json',
    clientPath: '/v1/openapi.json',
    responseType: 'OpenAPI 3 document',
    params: [],
  },
];

export const getEndpointBySlug = (slug: string): ApiEndpointDocT | undefined =>
  DOCUMENTED_ENDPOINTS.find((endpoint) => endpoint.slug === slug);
