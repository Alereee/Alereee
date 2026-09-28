# @vocab-bloom-hub/client

Typed client for the public read-only API of a [Vocab Bloom Hub](https://github.com/Fristail27/vocab-bloom-hub) instance — an English dictionary with IPA, CEFR levels, sense-level definitions, examples, translations (Russian, Spanish, French, German, Portuguese, Chinese, Arabic) and inflected forms, served under `/api/v1`.

Documentation, the API reference and a playground: [vocab-bloom-hub.com](https://vocab-bloom-hub.com/en/docs/sdk/node).

- One method per endpoint, typed from the server's OpenAPI document — the types cannot drift from the API.
- Node.js ≥ 20 and browsers; `fetch` only, no dependencies; ESM and CommonJS.
- Errors are thrown as typed exceptions; `AbortSignal` on every call; optional ETag cache for repeated reads; opt-in retry on `429` / `5xx` honouring `Retry-After`; a versioned `User-Agent`.

## Install

```bash
npm install @vocab-bloom-hub/client
```

Stable releases publish under `latest`. A prerelease publishes under its channel dist-tag
(`alpha`, `beta`) and never takes `latest`, so it has to be named:
`npm install @vocab-bloom-hub/client@beta`.

## Quick start

```ts
import { VocabBloomClient, NotFoundError } from '@vocab-bloom-hub/client';

const client = new VocabBloomClient({ baseUrl: 'https://dict.example.com' });

// search: relevance tiers, typo tolerance
const { data, meta } = await client.search({ search: 'definately' });
console.log(meta.fuzzy, data[0].word); // true "definitely"

// a headword with every part of speech, forms, meanings and translations
try {
  const run = await client.word('run');
  console.log(run.data[0].meanings[0].definition);
} catch (error) {
  if (error instanceof NotFoundError) console.log('no such word');
  else throw error;
}

// walk the whole dictionary, page after page
for await (const word of client.iterateWords({ word_level: ['A1', 'A2'], with_meanings: true })) {
  console.log(word.word, word.meanings.length);
}
```

## API

| Method                           | Endpoint                                | Answer                                                                                                         |
| -------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `search(request)`                | `GET /search`                           | `SearchResponse`                                                                                               |
| `searchDetailed(request)`        | `GET /search/detailed`                  | `DetailedSearchResponse`                                                                                       |
| `word(headword)`                 | `GET /words/{word}`                     | `HeadwordResponse`                                                                                             |
| `wordsBatch(words)`              | `POST /words/batch`                     | `WordsBatchResponse` — up to 50 headwords, one rate-limit unit; misses under `meta.not_found`                  |
| `wordById(id)`                   | `GET /words/id/{id}`                    | `WordResponse`                                                                                                 |
| `meanings(headword)`             | `GET /words/{word}/meanings`            | `MeaningsResponse`                                                                                             |
| `translations(headword, query?)` | `GET /words/{word}/translations`        | `TranslationsResponse`                                                                                         |
| `forms(headword)`                | `GET /words/{word}/forms`               | `FormsResponse`                                                                                                |
| `synonyms(headword)`             | `GET /words/{word}/synonyms`            | `LinksResponse` — the linked headwords per meaning                                                             |
| `antonyms(headword)`             | `GET /words/{word}/antonyms`            | `LinksResponse`                                                                                                |
| `history(headword)`              | `GET /words/{word}/history`             | `HistoryResponse` — what was changed on the instance, with the values before and after                         |
| `words(query?)`                  | `GET /words`                            | `WordsResponse` (one page)                                                                                     |
| `iterateWords(query?)`           | `GET /words`, following the cursor      | `AsyncGenerator<Word>`                                                                                         |
| `iterateSearchDetailed(request)` | `GET /search/detailed`, page after page | `AsyncGenerator<Word>` — stops at the server's page cap (`DETAILED_SEARCH_MAX_PAGE`, 20)                       |
| `random(filters?)`               | `GET /random`                           | `WordResponse`                                                                                                 |
| `meta()`                         | `GET /meta`                             | `MetaResponse`                                                                                                 |
| `openapi()`                      | `GET /openapi.json`                     | the OpenAPI 3 document                                                                                         |
| `suggest(request)`               | `POST /suggestions`                     | `SuggestionCreatedResponse` — files a reader report (or an edit proposal) into the instance's moderation queue |

Every method resolves to the `{ data, meta }` envelope the API answers with and takes an optional last argument `{ signal, headers, timeoutMs }`. The request and response types (`Word`, `Meaning`, `SearchRequest`, `ListWordsQuery`, …) are exported — the request types of the `GET` reads are their query strings, so a `SearchRequest` is `{ search, type?, limit? }` — and so are the raw generated `paths` / `components` / `operations` for anything not aliased. The contract itself — tiers, filters, cursor pagination, caching — is documented in the server's [`docs/api.md`](https://github.com/Fristail27/vocab-bloom-hub/blob/main/docs/api.md).

### Options

```ts
new VocabBloomClient({
  baseUrl: 'https://dict.example.com', // origin of the instance; /api/v1 is appended
  headers: { 'X-App': 'my-app' }, // sent with every request
  cache: true, // ETag revalidation (see below); or your own ResponseCache
  fetch: myFetch, // a custom fetch (instrumentation, polyfills, tests)
  timeoutMs: 10_000, // fail a hung request with NetworkError; null disables (the default is 10 s)
  retry: { attempts: 3, backoffMs: 500, maxDelayMs: 60_000 }, // opt-in: retry the GET reads on 429 / 5xx (see below)
});
```

`timeoutMs` can also be passed per call and combines with your `signal` — whichever fires first aborts the request.

Every request carries `User-Agent: vocab-bloom-hub-npm/<version>` (`USER_AGENT`, built from `SDK_VERSION`) so an operator can tell SDK traffic apart in the log; pass your own `User-Agent` in `headers` to replace it. Browsers own the header and ignore the value.

### Retry

Off by default — the client documents exact request counts against the rate limit, so the loop is opt-in. With `retry: {}` (or explicit `attempts` / `backoffMs`) a `GET` answered `429` or `5xx` is sent again: after `Retry-After` when the server sent it, otherwise after `backoffMs`, then twice that, and so on, up to `attempts` tries in total (the first one included; 3 and 500 ms by default); no single wait exceeds `maxDelayMs` (60 s by default), whatever `Retry-After` says. `POST` requests (the batch lookup, a suggestion), `4xx` answers and network errors are never retried; an abort of your `signal` while waiting ends the wait with `NetworkError`.

### Errors

Failed requests throw:

| Class             | When                                            | Fields                                         |
| ----------------- | ----------------------------------------------- | ---------------------------------------------- |
| `NotFoundError`   | 404                                             | `status`, `code` (`word_doesnt_found`), `body` |
| `RateLimitError`  | 429 — the public rate limit                     | `retryAfter` (seconds, from `Retry-After`)     |
| `NetworkError`    | no answer: DNS, connection, TLS, abort, timeout | `status: 0`, `code: 'network_error'`, `cause`  |
| `VocabBloomError` | everything else                                 | `status`, `code`, `body`                       |

Without the `retry` option the client never retries on its own: a `RateLimitError` carries `retryAfter` (seconds) and backoff is the caller's decision.

`code` is the machine-readable error of the API (`invalid_cursor`, `too_many_requests`, …), or `http_error` when the answer was not JSON (a proxy page, for instance).

### ETag cache

With `cache: true` every `GET` answer is kept in memory per URL together with its `ETag`; the next read of the same URL sends `If-None-Match` and, on `304 Not Modified`, returns the kept body — the round trip stays, the payload does not. `MemoryCache` holds 500 entries (least recently used out); pass an object with `get(url)` / `set(url, entry)` for a store of your own. Off by default.

## Development

```bash
yarn workspace @vocab-bloom-hub/client generate        # types from apps/server/openapi/public-v1.json
yarn workspace @vocab-bloom-hub/client generate:check  # fail when the generated types are stale (CI)
yarn workspace @vocab-bloom-hub/client build           # dist/ (ESM, CJS, d.ts)
yarn workspace @vocab-bloom-hub/client test            # unit tests + the client against the real server on SQLite
yarn workspace @vocab-bloom-hub/client pack:check      # publint + arethetypeswrong on the packed tarball (CI, release)
```

The package ships ESM and CommonJS with a declaration file for each (`dist/index.d.ts`, `dist/index.d.cts`); the `exports` map hands every consumer the pair its resolution asks for.

`src/generated/openapi.ts` is produced by `openapi-typescript` from the committed public spec and committed itself: a contract change on the server shows up as a diff here, and `test/contract.spec.ts` fails until every operation of the spec has a client method.

## License

MIT for the client. The dictionary data comes under the license of the dataset the instance
serves — CC BY 4.0 for the project's own, the license of the source for another: read `license`,
`attribution` and `license_text` from `meta()` and show them with the data. An entry the owner of
the instance changed carries `modified: true`, and `client.history(headword)` says what was changed: say next
to such an entry that it was changed. What the licenses ask for:
[DATA_LICENSE.md](https://github.com/Fristail27/vocab-bloom-hub/blob/main/DATA_LICENSE.md#using-data-that-was-changed-on-an-instance).
