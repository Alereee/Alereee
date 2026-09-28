# vocab-bloom-hub

Typed Python client for the public read-only API of a [Vocab Bloom Hub](https://github.com/Fristail27/vocab-bloom-hub) instance — an English dictionary with IPA, CEFR levels, sense-level definitions, examples, translations (Russian, Spanish, French, German, Portuguese, Chinese, Arabic) and inflected forms, served under `/api/v1`.

Documentation, the API reference and a playground: [vocab-bloom-hub.com](https://vocab-bloom-hub.com/en/docs/sdk/python).

- Sync (`VocabBloomClient`) and async (`AsyncVocabBloomClient`) on `httpx`; one method per endpoint.
- pydantic models generated from the server's OpenAPI document — the types cannot drift from the API.
- Typed exceptions, cursor iteration, optional ETag cache, `words_dataframe()` for notebooks.
- Python 3.10+; dependencies: `httpx`, `pydantic` (`pandas` optional).

## Install

```bash
pip install vocab-bloom-hub
# with pandas support
pip install "vocab-bloom-hub[pandas]"
```

pip skips prereleases by default (`1.1.0b1`, PEP 440 for `1.1.0-beta.1`); add `--pre` to
try one.

## Quick start

```python
from vocab_bloom_hub import NotFoundError, VocabBloomClient

client = VocabBloomClient("https://dict.example.com")

# search: relevance tiers, typo tolerance
result = client.search("definately")
print(result.meta.fuzzy, result.data[0].word)  # True definitely

# a headword with every part of speech, forms, meanings and translations
try:
    run = client.word("run")
    print(run.data[0].meanings[0].definition)
except NotFoundError:
    print("no such word")

# walk the whole dictionary, page after page
for word in client.iter_words(word_level=["A1", "A2"], with_meanings=True):
    print(word.word, len(word.meanings))

# a notebook: the filtered list as a DataFrame (pip install "vocab-bloom-hub[pandas]")
frame = client.words_dataframe(part_of_speech=["noun"], category=["IT"])
```

Async, the same methods awaited:

```python
from vocab_bloom_hub import AsyncVocabBloomClient

async with AsyncVocabBloomClient("https://dict.example.com") as client:
    meta = await client.meta()
    async for word in client.iter_words(limit=100):
        ...
```

## API

| Method                                      | Endpoint                                | Answer                                                                                                         |
| ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `search(search, *, type, limit)`            | `GET /search`                           | `SearchResponse`                                                                                               |
| `search_detailed(search, *, ...)`           | `GET /search/detailed`                  | `DetailedSearchResponse`                                                                                       |
| `word(headword)`                            | `GET /words/{word}`                     | `HeadwordResponse`                                                                                             |
| `words_batch(words)`                        | `POST /words/batch`                     | `WordsBatchResponse` — up to 50 headwords, one rate-limit unit; misses under `meta.not_found`                  |
| `word_by_id(id)`                            | `GET /words/id/{id}`                    | `WordResponse`                                                                                                 |
| `meanings(headword)`                        | `GET /words/{word}/meanings`            | `MeaningsResponse`                                                                                             |
| `translations(headword, *, language)`       | `GET /words/{word}/translations`        | `TranslationsResponse`                                                                                         |
| `forms(headword)`                           | `GET /words/{word}/forms`               | `FormsResponse`                                                                                                |
| `synonyms(headword)`                        | `GET /words/{word}/synonyms`            | `LinksResponse` — the linked headwords per meaning                                                             |
| `antonyms(headword)`                        | `GET /words/{word}/antonyms`            | `LinksResponse`                                                                                                |
| `history(headword)`                         | `GET /words/{word}/history`             | `HistoryResponse` — what was changed on the instance, with the values before and after                         |
| `words(**filters, cursor, limit, with_...)` | `GET /words`                            | `WordsResponse` (one page)                                                                                     |
| `iter_words(**filters, ...)`                | `GET /words`, following the cursor      | `Iterator[Word]`                                                                                               |
| `iter_search_detailed(search, *, ...)`      | `GET /search/detailed`, page after page | `Iterator[Word]` — stops at the server's page cap (`DETAILED_SEARCH_MAX_PAGE`, 20)                             |
| `random(**filters)`                         | `GET /random`                           | `WordResponse`                                                                                                 |
| `meta()`                                    | `GET /meta`                             | `MetaResponse`                                                                                                 |
| `openapi()`                                 | `GET /openapi.json`                     | `dict` — the OpenAPI document                                                                                  |
| `suggest(headword, ...)`                    | `POST /suggestions`                     | `SuggestionCreatedResponse` — files a reader report (or an edit proposal) into the instance's moderation queue |
| `words_dataframe(**filters, ...)`           | `GET /words`, every page                | `pandas.DataFrame` (sync and async clients)                                                                    |

Every response is the `{ data, meta }` envelope the API answers with, as a pydantic model. Filters (`part_of_speech`, `word_level`, `language_register`, `category`, `area_variant`, `form_of_word`) take lists of strings or of the exported enums (`PartOfSpeech`, `WordLevel`, ...); values of one filter are OR-ed, different filters are AND-ed. The contract itself — tiers, filters, cursor pagination, caching — is documented in the server's [`docs/api.md`](https://github.com/Fristail27/vocab-bloom-hub/blob/main/docs/api.md).

### Options

```python
VocabBloomClient(
    "https://dict.example.com",  # origin of the instance; /api/v1 is appended
    headers={"X-App": "my-app"},  # sent with every request
    timeout=10.0,  # seconds, or an httpx.Timeout
    cache=True,  # ETag revalidation (below); or your own ResponseCache
    retry={
        "attempts": 3,
        "backoff": 0.5,
        "max_delay": 60.0,
    },  # opt-in: retry the GET reads on 429 / 5xx (below)
    transport=...,  # a custom httpx transport (tests, instrumentation)
)
```

Use the client as a context manager (`with` / `async with`) to close the connection pool.

### Errors

| Exception         | When                                     | Fields                                         |
| ----------------- | ---------------------------------------- | ---------------------------------------------- |
| `NotFoundError`   | 404                                      | `status`, `code` (`word_doesnt_found`), `body` |
| `RateLimitError`  | 429 — the public rate limit              | `retry_after` (seconds, from `Retry-After`)    |
| `NetworkError`    | no answer: DNS, connection, TLS, timeout | `status == 0`, `code == "network_error"`       |
| `VocabBloomError` | everything else                          | `status`, `code`, `body`                       |

`code` is the machine-readable error of the API (`invalid_cursor`, `too_many_requests`, ...), or `http_error` when the answer was not JSON (a proxy page, for instance).

Without the `retry` option the client never retries on its own: a `RateLimitError` carries `retry_after` (seconds) and backoff is the caller's decision.

### Per-request options

Every method takes `options=` — a `RequestOptions` dict with `headers` (merged over the client's for that call) and `timeout` (seconds or an `httpx.Timeout`, replacing the client's) — the counterpart of the Node client's last argument:

```python
client.word("run", options={"headers": {"X-Request-Id": "abc"}, "timeout": 2.0})
```

Every request carries `User-Agent: vocab-bloom-hub-python/<version>` (`vocab_bloom_hub.USER_AGENT`) so an operator can tell SDK traffic apart in the log; pass your own `User-Agent` in `headers` to replace it.

### Retry

Off by default — the client documents exact request counts against the rate limit, so the loop is opt-in. With `retry={}` (or explicit `attempts` / `backoff`) a `GET` answered `429` or `5xx` is sent again: after `Retry-After` when the server sent it, otherwise after `backoff`, then twice that, and so on, up to `attempts` tries in total (the first one included; 3 and 0.5 s by default); no single wait exceeds `max_delay` seconds (60 by default), whatever `Retry-After` says. `POST` requests (the batch lookup, a suggestion), `4xx` answers and network errors are never retried.

### ETag cache

With `cache=True` every `GET` answer is kept in memory per URL together with its `ETag`; the next read of the same URL sends `If-None-Match` and, on `304 Not Modified`, returns the kept body — the round trip stays, the payload does not. `MemoryCache` holds 500 entries (least recently used out); pass any object with `get(url)` / `set(url, entry)` for a store of your own. Off by default.

## Development

```bash
cd packages/python-sdk
uv sync                                           # Python 3.12 + dependencies into .venv
uv run python scripts/generate_models.py          # models from apps/server/openapi/public-v1.json
uv run python scripts/generate_models.py --check  # fail when the generated models are stale (CI)
uv run ruff check . && uv run ruff format --check . && uv run mypy
uv run pytest                                     # unit tests + the client against the real server
```

`src/vocab_bloom_hub/_generated/models.py` is produced by `datamodel-code-generator` from the committed public spec and committed itself: a contract change on the server shows up as a diff here, and `tests/test_contract.py` fails until every operation of the spec has a client method. The live tests start the server through `yarn workspace server fixture:public-api` (Node.js and the monorepo's dependencies installed), on an in-memory SQLite database.

## License

MIT for the client. The dictionary data comes under the license of the dataset the instance
serves — CC BY 4.0 for the project's own, the license of the source for another: read `license`,
`attribution` and `license_text` from `meta()` and show them with the data. An entry the owner of
the instance changed carries `modified: true`, and `client.history(headword)` says what was changed: say next
to such an entry that it was changed. What the licenses ask for:
[DATA_LICENSE.md](https://github.com/Fristail27/vocab-bloom-hub/blob/main/DATA_LICENSE.md#using-data-that-was-changed-on-an-instance).
