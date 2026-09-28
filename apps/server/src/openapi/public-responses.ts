/**
 * Response types of the public operations (issue #305), keyed by the
 * operationId @nestjs/swagger derives from `Controller_method`. The
 * controllers type their answers with the TypeScript contract in
 * `types/public/v1`, which Swagger cannot see; the generator turns those
 * types into component schemas and this map says which one each route
 * answers with. Every public route must be listed — building the document
 * fails otherwise, so a new endpoint cannot ship without a schema.
 */
export type PublicResponseSpecT = {
  // name of the exported type in types/public/v1; null for a response that
  // is not one of the contract types (the OpenAPI document itself)
  type: string | null;
  // error statuses the route answers with (all in the PublicApiErrorT shape)
  errors: number[];
};

export const PUBLIC_ERROR_SCHEMA = 'PublicApiErrorT';

export const PUBLIC_ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid input: an unknown field, a value outside the allowed set, or a foreign cursor',
  404: 'Nothing matches',
  429: 'Rate limit of the public prefix exceeded (PUBLIC_API_RATE_LIMIT); retry after the window',
  503: 'Not available: the OpenAPI document is not ready, or the suggestion queue is full',
};

export const PUBLIC_RESPONSES: Record<string, PublicResponseSpecT> = {
  PublicSearchController_searchGet: { type: 'PublicSearchV1ResT', errors: [400, 429] },
  PublicSearchController_searchDetailedGet: { type: 'PublicSearchDetailedV1ResT', errors: [400, 429] },
  PublicWordsController_list: { type: 'PublicWordsV1ResT', errors: [400, 429] },
  PublicWordsController_byId: { type: 'PublicWordV1ResT', errors: [400, 404, 429] },
  PublicWordsController_byHeadword: { type: 'PublicHeadwordV1ResT', errors: [400, 404, 429] },
  PublicWordsController_batch: { type: 'PublicWordsBatchV1ResT', errors: [400, 429] },
  PublicWordsController_meanings: { type: 'PublicHeadwordMeaningsV1ResT', errors: [400, 404, 429] },
  PublicWordsController_translations: { type: 'PublicHeadwordTranslationsV1ResT', errors: [400, 404, 429] },
  PublicWordsController_forms: { type: 'PublicHeadwordFormsV1ResT', errors: [400, 404, 429] },
  PublicWordsController_synonyms: { type: 'PublicHeadwordLinksV1ResT', errors: [400, 404, 429] },
  PublicWordsController_antonyms: { type: 'PublicHeadwordLinksV1ResT', errors: [400, 404, 429] },
  PublicWordsController_history: { type: 'PublicHeadwordHistoryV1ResT', errors: [400, 404, 429] },
  PublicDictionaryController_random: { type: 'PublicWordV1ResT', errors: [400, 404, 429] },
  PublicDictionaryController_meta: { type: 'PublicMetaV1ResT', errors: [429] },
  PublicOpenApiController_openapi: { type: null, errors: [429, 503] },
  PublicSuggestionsController_create: { type: 'PublicSuggestionCreatedV1ResT', errors: [400, 404, 429, 503] },
};
