# API surfaces: public `/api/v1` and the admin API

The server exposes two surfaces on one host:

| Surface    | Prefixes                                  | Auth                              | Purpose                                                                   |
| ---------- | ----------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| **Public** | `/api/v1/*`                               | none                              | Read-only, versioned contract for consuming applications                  |
| **Admin**  | `/api/en/*`, `/api/settings`, `/api/auth` | admin JWT (cookie / Bearer token) | Everything the admin UI does: editing, import / export, statistics, login |

Nothing under `/api/v1` mutates data or requires a login; nothing outside it is part of the
public contract. The public contract is also served as an [OpenAPI document](#openapi-document);
Swagger UI, the website's reference and the other ways to read the API are compared in
[api-tools.md](./api-tools.md).

## The public contract

- **Versioned prefix.** Response shapes under `/api/v1` change only with a new prefix
  (`/api/v2`). The types consumers rely on live in `apps/server/types/public/v1/`.
- **`X-API-Version: 1`** on every response of the prefix, errors included.
- **Envelope:** every successful answer is `{ "data": ..., "meta": { ... } }` — the payload
  under `data` (a list or one object), paging and counts under `meta`, never mixed into
  the items.
- **Errors** reuse the `ErrorResT` shape everywhere under the prefix, whatever raised them
  (validation, an unknown route, the rate limit):

  ```json
  { "statusCode": 429, "message": "too_many_requests", "error": true }
  ```

- **Languages**. The headwords are English and the prefix carries no language
  segment: a second source language is out of scope, so `/api/v1/words/run` will not become
  `/api/v1/en/words/run`. The translation language is a filter on the answer and travels as
  the multi-valued query parameter `language` (`/api/v1/words/run/translations?language=ru`);
  the detailed search's `translation_languages` (a repeated query key) does the same. Without
  the parameter every language is returned. `GET /api/v1/meta` lists the languages an instance
  serves under `available_languages`; consumers should read it instead of assuming `ru`.
- **Rate limit.** One budget per client IP for the whole prefix, `PUBLIC_API_RATE_LIMIT`
  (`<requests>/<seconds>`, default `100/60`); every request costs one unit, the batch lookup
  included. Exceeding it answers `429` with the error above.
  There are no API keys yet; put the instance behind a reverse proxy if you need per-client
  quotas. The one exemption is the instance's own website: its server-side requests carry
  `INTERNAL_API_TOKEN` as `X-Internal-Token` and are not counted
  ([`environment.md`](./environment.md)).
- **Cacheable.** Every successful `GET` carries `ETag`, `Last-Modified` and `Cache-Control:
public, max-age=<PUBLIC_API_CACHE_MAX_AGE>, stale-while-revalidate=<the same>`; conditional requests answer `304` — see
  [Caching](#caching). The search has a `GET` form for that reason.

### Endpoints

Every successful answer is an envelope: the payload under `data`, paging and counts under
`meta`. The response types are in `apps/server/types/public/v1/index.ts`.

| Method | Path                                              | Query / body                                                                                           | Response                                                                                                            |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/meta`                                    | —                                                                                                      | `{ data: { api_version, app_version, dataset, source, dataset_version, license, …, counts, available_languages } }` |
| `GET`  | `/api/v1/openapi.json`                            | —                                                                                                      | the OpenAPI 3 document of this contract (no envelope; see [OpenAPI document](#openapi-document))                    |
| `GET`  | `/api/v1/search`                                  | `search`, `type?`, `limit?`                                                                            | `{ data: PublicSearchWordV1T[], meta: { count, fuzzy, short_term } }`                                               |
| `GET`  | `/api/v1/search/detailed`                         | `search`, `type?`, `limit?`, `page?`, `with_meanings?`, `with_translations?`, `translation_languages?` | `{ data: PublicWordV1T[], meta: { page, limit, has_more, fuzzy, short_term } }`                                     |
| `GET`  | `/api/v1/words/{word}`                            | —                                                                                                      | `{ data: PublicWordV1T[], meta: { word, count } }`                                                                  |
| `GET`  | `/api/v1/words/{word}/meanings`                   | —                                                                                                      | `{ data: PublicMeaningV1T[], meta: { word, count } }`                                                               |
| `GET`  | `/api/v1/words/{word}/translations`               | `language?`                                                                                            | `{ data: { short_translations, meaning_translations }, meta }`                                                      |
| `GET`  | `/api/v1/words/{word}/forms`                      | —                                                                                                      | `{ data: PublicWordFormV1T[], meta: { word, count } }`                                                              |
| `GET`  | `/api/v1/words/{word}/synonyms`                   | —                                                                                                      | `{ data: PublicWordLinkV1T[], meta: { word, count } }`                                                              |
| `GET`  | `/api/v1/words/{word}/antonyms`                   | —                                                                                                      | `{ data: PublicWordLinkV1T[], meta: { word, count } }`                                                              |
| `GET`  | `/api/v1/words/{word}/history`                    | —                                                                                                      | `{ data: PublicChangeV1T[], meta: { word, count } }`                                                                |
| `GET`  | `/api/v1/words/{word}/datasets`                   | —                                                                                                      | `{ data: PublicWordDatasetV1T[], meta: { word, datasets, found } }`                                                 |
| `GET`  | `/api/v1/words/{word}/datasets/{dataset}/history` | —                                                                                                      | `{ data: PublicChangeV1T[], meta: { word, count } }`                                                                |
| `GET`  | `/api/v1/words/id/{id}`                           | —                                                                                                      | `{ data: PublicWordV1T }`                                                                                           |
| `GET`  | `/api/v1/words`                                   | filters, `cursor?`, `limit?`, `with_meanings?`, `with_translations?`                                   | `{ data: PublicWordV1T[], meta: { limit, has_more, next_cursor } }`                                                 |
| `GET`  | `/api/v1/random`                                  | filters                                                                                                | `{ data: PublicWordV1T }`                                                                                           |
| `POST` | `/api/v1/words/batch`                             | `{ words: string[] }` (1–50)                                                                           | `{ data: { word, count, entries: PublicWordV1T[] }[], meta: { count, not_found } }`                                 |
| `POST` | `/api/v1/suggestions`                             | `{ headword, word_id?, message?, kind?, edits?, author_name?, author_consent? }`                       | `201 { data: { id, status } }`                                                                                      |

The same endpoints can be tried on the website's playground and the admin's _Documentation_
pages ([api-tools.md](./api-tools.md)); the machine-readable contract is the
[OpenAPI document](#openapi-document).

`POST /api/v1/suggestions` is the one write of the public surface: a reader of the
website's word pages files feedback into the instance's moderation queue (the admin
_Suggestions_ page). Two kinds share the endpoint:

- **`kind: "report"`** (the default) — a free-text `message` about a headword; `word_id`
  optionally names the entry from a word answer.
- **`kind: "edit"`** — the reader edits the word form as a whole; the proposal the admin can
  apply in one click travels as `edits`, a list of `{ target_type, target_id, changes }` items
  covering every touched piece: `target_type` is `word` | `meaning` | `meaning_translation` |
  `short_translation`, `target_id` comes from the word answers, `changes` holds the proposed
  field values (`description` / `transcription` for a word, `title` / `definition` for a
  meaning or its translation, `description` for a short translation). The server snapshots the
  current values into before/after diffs at file time; unknown fields, empty values, targets of
  another headword and a proposal that changes nothing are rejected. Applying walks every item
  through the same edit services the admin UI uses, so the changes are recorded in the history
  of the dataset — as a correction of a reader — and flag the entry `user_modified`.

A sender who wants to be credited passes `author_name` (up to 80 characters) **together with
`author_consent: true`**: the name is published with the correction — on the word page, in
`/words/{word}/history`, in the exports of the data. A name without the consent answers `400`;
a consent without a name names nobody. The owner removes a name on request
([`data.md`](./data.md#personal-data)).

The headword must exist in the dictionary. The endpoint has a rate limit of its own —
`SUGGESTIONS_RATE_LIMIT`, default `5/3600` (five reports per hour per client), separate from
the shared `/api/v1` budget — and answers `503 suggestion_queue_full` once 500 reports are
waiting for the admin. See [`data.md`](./data.md#reporting-errors). A suggestion the admin
applies becomes part of the dictionary data and travels with it under the license of the
dataset it corrects — CC BY 4.0 for the project's own
([`DATA_LICENSE.md`](../DATA_LICENSE.md)); the word pages say so next to the form.

The examples use `localhost:3010`, the port of a start without Docker; a docker compose
installation publishes the API on `localhost:3240` by default (`SERVER_PORT`).

```bash
curl 'http://localhost:3010/api/v1/search?search=run&limit=5'
curl 'http://localhost:3010/api/v1/search/detailed?search=run&with_meanings=true'

curl 'http://localhost:3010/api/v1/words/run'
curl 'http://localhost:3010/api/v1/words?part_of_speech=noun&word_level=B1&word_level=B2&limit=50'
curl 'http://localhost:3010/api/v1/random?part_of_speech=verb&word_level=A2'
```

#### Search tiers and typo tolerance

Both searches are `GET` reads: the fields travel in the query string
(`translation_languages` as a repeated key, booleans as `true` / `false`), the answer carries
the caching headers of the prefix, and a search can be pasted into a browser or shared as a
link. `limit` is 1–100 (default 10) for the search and 1–20 for the detailed one, whose `page`
starts at 1. `translation_languages` is either omitted (every language) or a non-empty list —
an empty list answers `400`. The `POST` forms of the alpha are gone
([Removed aliases](#removed-aliases)).

Both search endpoints rank their answer by tiers: exact headword, phrasal variants, starts
with the term, phrases containing it as a word, ends with it, contains it anywhere. Every tier
is served by an index on Postgres (a byte-order btree for the prefixes, a trigram GIN for the
rest). Within a tier the starts-with entries come in byte order (an autocomplete
reads them as typed) and the others shortest headword first — `language` before
`body language` for `guag`. An inflected form resolves to its base entry in every tier, so a
headword appears once however many of its forms match, each tier fills the part of `limit`
left to it with distinct headwords, and `type` binds every tier, the exact one included.

When no tier matches at all, a **fuzzy tier** answers instead: headwords whose trigrams are
similar enough to the term (`pg_trgm`, similarity ≥ 0.3), best match first. Such an answer
carries `meta.fuzzy: true` and a `similarity` (0–1) on every item — the "did you mean"
signal for a UI or an SDK:

```json
{ "data": [{ "word": "relieve", "similarity": 0.45, "…": "…" }], "meta": { "count": 8, "fuzzy": true } }
```

> [!NOTE]
> `fuzzy` is `false` whenever the exact tiers found something, and also when nothing at all is
> similar (empty `data`). The fuzzy tier exists on Postgres instances only (`pg_trgm`); a
> SQLite instance answers an empty list for a typo, with `fuzzy: false`.

A term of **one or two characters** (after trimming) searches the exact and prefix tiers
only — the headword itself, its phrasal variants, an inflected form's base entry and
headwords starting with the term — and answers with `meta.short_term: true`. The suffix,
substring, phrase and fuzzy tiers are skipped: half the dictionary contains any given letter,
so those tiers would return an arbitrary slice rather than a match, and a trigram index has
nothing to look up in fewer than three characters. `a`, `I`, `ok`, `TV` still answer, as
exact headwords; a blank term answers an empty list.

#### Headword reads

`GET /api/v1/words/{word}` answers **every entry** of a headword — one item per part of
speech, each with its forms, meanings (definitions, examples, translations, synonyms,
antonyms) and short translations. The spelling is matched case-insensitively
([unless the dictionary holds both spellings](#spellings-that-differ-by-case)); URL-encode
spaces for phrases (`/api/v1/words/put%20up%20with`). An inflected form resolves to its base
entry: `/api/v1/words/ran` answers the verb _run_ (with `ran` among its `forms`). An unknown
spelling answers `404` with `word_doesnt_found`.

The partial reads (`/meanings`, `/translations`, `/forms`) flatten the same entries into one
list; every item carries `word_id` and `part_of_speech` so it can be tied back to its entry.
`/translations` splits into `short_translations` (per entry) and `meaning_translations` (per
meaning, with `meaning_id`); `?language=ru` keeps one language only. `/synonyms` and
`/antonyms` list the linked headwords of every meaning — `{ word, meaning_id,
word_id, part_of_speech }`, each `word` readable through `/words/{word}` — so a thesaurus
does not need the full entry; a headword without links answers an empty list.

`GET /api/v1/words/id/{id}` is the same entry by its numeric id (the `id` of any item above).

##### Spellings that differ by case

The project's own dataset writes its headwords in lower case, and a lookup does not depend on the
case of the letters: `Run`, `RUN` and `run` answer the same entries with `meta.word: "run"`. A
dataset of a public source holds words that differ by nothing else — `Polish`, the language, and
`polish`, to make shiny; `Test`, a match of cricket, and `test`. Those are **words of their own**:

| Request              | Answer                                                     | `meta.word` | `meta.variants`        |
| -------------------- | ---------------------------------------------------------- | ----------- | ---------------------- |
| `/words/polish`      | the entries spelled `polish`                               | `polish`    | `["Polish"]`           |
| `/words/Polish`      | the entries spelled `Polish`                               | `Polish`    | `["polish"]`           |
| `/words/POLISH`      | the entries of both: the dictionary has no word spelled so | `polish`    | `["Polish", "polish"]` |
| `/words/Run`, `/RUN` | the entries of `run`: the dictionary holds one spelling    | `run`       | `[]`                   |

`meta.variants` lists the other spellings of the headword, each readable through
`/words/{word}`, and every entry says its own in `word`. The partial reads, the history and the
batch lookup match the same way. `variants` was added after 1.0 and is optional in the contract.

`POST /api/v1/words/batch` with `{ "words": ["run", "ran", "put up with"] }` looks
up to 50 spellings in one request — for a consumer enriching a word list, which would
otherwise spend its whole rate-limit budget on per-word GETs. Each spelling is matched like
the single read; the answer keeps the request order with one item per spelling — `word` (the
normalized spelling), `count` and `entries`, exactly what `GET /api/v1/words/{word}` answers
under `data` — collapsing duplicates and case, and lists the spellings without an entry under
`meta.not_found` instead of failing. A batch counts as **one request** against the rate limit
whatever its size; instances exposed to the open internet size `PUBLIC_API_RATE_LIMIT` with
that in mind. Being a `POST`, it carries no cache validators; a consumer that re-reads the same
words benefits from the cached single reads instead.

Word items are an explicit projection of the dictionary rows: the fields of
`PublicWordV1T` and its parts in `apps/server/types/public/v1/index.ts` are the whole promise,
each assigned by name from the row (`src/modules/PublicApiModule/utils/projection.ts`), so a
column added to the database does not become public by accident. The instance's editorial
state — `generated`, `generated_by_model`, `version`, `user_modified` — is not part of v1; it
stays on the admin API (`GET /api/en/{id}`), where the admin UI reads it.

Every word names its `source`: where the data of the entry comes from — `vocab-bloom-hub` for
the project's own dataset, `wiktionary`, `wordnet`, `princeton-wordnet`. An instance serves one dataset at a time
([`datasets.md`](./datasets.md)), so every word of an answer has the same source; the terms
that go with it are in `GET /api/v1/meta`. The one read that answers from several datasets,
[`/words/{word}/datasets`](#a-headword-in-every-dataset), groups the entries by dataset and
states the terms of each group. The field was added after 1.0 and is optional
in the contract: a server of 1.0 does not send it.

`source` is on **every answer that carries an entry, a part of one or an edit of one**: the
headword, id, batch, list and random reads, both searches, the items of `/meanings`, `/forms`,
`/translations`, `/synonyms` and `/antonyms`, the edits of `/history`, and the entries of every
group of `/words/{word}/datasets`. An item taken out of its answer still says what it is
attributed to.

Every word says whether it was **`modified`**: changed or added on the instance, so that it is
not, or not only, what its source says. The licenses of the datasets ask that a reader is told;
show it wherever you show the entry. The flag is per entry — the noun of a headword may be
modified and its verb not — and goes back to `false` when an update of the dataset replaces the
entry with the content of its source, or when the change is taken back. Optional in the
contract like `source`.

The mark is on **every answer that carries an entry or a part of one**: the headword, id, batch,
list and random reads, both searches, and the partial reads — an item of `/meanings`, `/forms`,
`/translations`, `/synonyms` and `/antonyms` carries the `modified` of the entry it belongs to,
next to `word_id` and `part_of_speech`. `GET /api/v1/meta` says it of the dataset as a whole:
`modified_entries`.

#### The history of a headword

`GET /api/v1/words/{word}/history` lists **what was changed**: the edits of the entries of the
headword that show in what is served, the latest first. The history of a dataset starts empty —
the data is taken to be what its source published until an edit is recorded — so it answers an
empty list for a headword served as its source has it, and `404` for an unknown spelling; an inflected form answers with
the history of its base entry.

```json
{
  "data": [
    {
      "created_at": "2026-09-27T10:00:00.000Z",
      "word": "lamp",
      "part_of_speech": "noun",
      "entity": "meaning",
      "action": "update",
      "record": { "title": "a light", "sort_order": 1 },
      "diff": { "definition": { "before": "A light.", "after": "A device that gives light." } },
      "origin": "suggestion",
      "author": "Ada Lovelace",
      "source": "wiktionary"
    }
  ],
  "meta": { "word": "lamp", "count": 1 }
}
```

| Field            | What it says                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity`         | what was edited: `word`, `word_form`, `meaning`, `meaning_translation`, `short_translation`                                                                    |
| `action`         | `create`, `update` or `delete`                                                                                                                                 |
| `word`           | the spelling of the entry the edit belongs to, as `word` of the entry says it: with `part_of_speech` it names the entry among the ones `/words/{word}` answers |
| `part_of_speech` | the entry of the headword the edit belongs to                                                                                                                  |
| `record`         | what names the edited record inside its entry — the form, the title of the meaning, the translation; `null` for the entry itself. No ids                       |
| `diff`           | `{ field: { before, after } }`: the fields that changed; every field of a record that was added (`before: null`) or deleted (`after: null`)                    |
| `origin`         | `admin` — an edit of the owner; `suggestion` — a correction of a reader the owner applied                                                                      |
| `author`         | the reader who sent the correction, when they asked to be named; `null` otherwise                                                                              |
| `source`         | the source of the dataset the edit was made in: what the changed entry is attributed to, next to the owner of the instance                                     |

The values are what the records say: related words by their spelling, no ids, no timestamps of
the database — the same history reads the same on another instance. The editorial state of the
instance (`generated`, `generated_by_model`) is left out. At most 200 edits are listed, the
latest. How the history is kept and undone:
[`datasets.md`](./datasets.md#editing-a-dataset-the-history-of-edits).

#### A headword in every dataset

An instance may hold several datasets and serves one of them. `GET /api/v1/words/{word}/datasets`
reads the headword from **every dataset the instance holds**, for a consumer that compares what
the sources say — the entry of the project's dataset next to the one of Wiktionary or WordNet —
without the owner switching anything. The answer is one group per dataset, in the order the
datasets were installed, and the groups are **never merged**:

```json
{
  "data": [
    {
      "dataset": "default",
      "active": false,
      "source": "vocab-bloom-hub",
      "dataset_version": "1.0.0",
      "license": "CC-BY-4.0",
      "license_url": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "…",
      "attribution_url": "…",
      "notice": "…",
      "license_text": "",
      "word": "polish",
      "variants": [],
      "count": 2,
      "entries": [{ "id": 17, "word": "polish", "source": "vocab-bloom-hub", "modified": false, "…": "…" }]
    },
    {
      "dataset": "wiktionary",
      "active": true,
      "source": "wiktionary",
      "dataset_version": null,
      "license": "CC-BY-SA-4.0",
      "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
      "attribution": "…",
      "attribution_url": "https://en.wiktionary.org",
      "notice": "",
      "license_text": "",
      "word": "polish",
      "variants": ["Polish"],
      "count": 3,
      "entries": [{ "id": 90412, "word": "polish", "source": "wiktionary", "modified": true, "…": "…" }]
    }
  ],
  "meta": { "word": "polish", "datasets": 2, "found": 2 }
}
```

| Field                                                                                                             | What it says                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataset`                                                                                                         | the name of the dataset on the instance: `default`, `wiktionary`, `wordnet`, `wordnet_princeton`                                                                                                                                  |
| `active`                                                                                                          | whether it is the dataset the other routes of the API serve                                                                                                                                                                       |
| `source`, `dataset_version`, `license`, `license_url`, `attribution`, `attribution_url`, `notice`, `license_text` | the terms of that dataset, the ones [`/meta`](#meta) states for the served one                                                                                                                                                    |
| `word`, `variants`                                                                                                | the headword the entries belong to in that dataset and its other spellings there ([by the rule of a headword read](#spellings-that-differ-by-case)); the asked spelling in lower case and `[]` for a dataset without the headword |
| `count`, `entries`                                                                                                | what `GET /words/{word}` would answer under `data` if that dataset were the served one; `0` and `[]` for a dataset without the headword                                                                                           |
| `meta.word`                                                                                                       | the spelling that was asked                                                                                                                                                                                                       |
| `meta.datasets`, `meta.found`                                                                                     | how many datasets the instance holds, and how many of them hold the headword                                                                                                                                                      |

- **The spelling is matched inside each dataset.** `polish` names one word in a dataset that
  writes its headwords in lower case and one of two in a dataset that holds `Polish` as well, so
  every group has a `word` and `variants` of its own.
- **An entry says what its own dataset says of it**: `source` is the source of the group, and
  `modified` tells whether the entry was changed on the instance in that dataset. What was
  changed is read from `GET /api/v1/words/{word}/datasets/{dataset}/history` — the answer of
  [the history of a headword](#the-history-of-a-headword), read from the dataset that is named;
  `404 dataset_not_found` for a dataset the instance does not hold.
- **Ids are per dataset**: the `id` of an entry means something in its group only. `/words/id/{id}`
  reads the served dataset.
- **The terms are per group.** An entry is used under the terms of the group it was taken from,
  and a consumer that takes entries from several groups is bound by the terms of each: a
  share-alike license of one group does not reach the entries of another, and does not leave its
  own.
- **`404 word_doesnt_found`** when no dataset holds the headword. A dataset without it answers an
  empty group: that the source has no such word is information.
- **One request** against the rate limit, whatever the number of datasets. The search stays on
  the served dataset.
- **Every dataset the instance holds is read**, the ones that were never activated too: a
  dataset is public from the moment it is installed, with the history of its edits and the names
  of the readers credited in it.
- **A report is about the served dataset.** `POST /api/v1/suggestions` files it in the dataset
  the instance serves: the `word_id` and the `target_id` of an entry of another group name
  nothing there, or another entry. Report what the headword read of the served dataset
  answered.

An instance with one dataset — every instance on SQLite — answers one group.

#### What a consumer does with it

The mark and the history exist because the licenses of the data ask that a change is indicated,
and the obligation passes to whoever shows the data further:

| You read                                 | You do                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `attribution`, `license_url` of `/meta`  | show the attribution line and link to the license wherever you show the data                                            |
| `modified: true` on a word or a part     | say next to the entry that it was changed: it is not, or not only, what its source published                            |
| `/words/{word}/history`                  | optional: show or link what was changed, and credit the `author` of a correction when one is named                      |
| a group of `/words/{word}/datasets`      | do all of the above per group, with the terms the group carries: entries of two groups are shown under two attributions |
| `license` of `/meta` ending in `-SA-4.0` | keep what you build on the data, changed entries included, under the same license                                       |
| a non-empty `license_text` of `/meta`    | keep the text with every copy of the data: show it, or link to a page that does                                         |
| `modified_entries` of `/meta` above `0`  | know that the instance serves data that differs from its source                                                         |

Read them from the API rather than hard-coding them: the owner may activate another dataset, edit
an entry or take a change back at any time. The terms in full:
[`DATA_LICENSE.md`](../DATA_LICENSE.md#using-data-that-was-changed-on-an-instance).

#### Filtered list and cursor pagination

`GET /api/v1/words` lists entries ordered by `(word, id)` — the headword by its bytes,
case-folded (`LOWER(word) COLLATE "C"` on Postgres, `LOWER(word)` on SQLite: `a bag of wind`
before `aaron burr`, whatever the database locale, and a grammar pattern that keeps its
sentence capital — `It’s the first time …` — sorts among the `i`s, not before `a`), then the
id. Filters: `part_of_speech`,
`word_level`, `language_register`, `category`, `area_variant`, `form_of_word`, plus `search`
and `is_obsolete`. Every enum filter accepts one value or a repeated key; values
of one filter are OR-ed, different filters are AND-ed
(`?word_level=B1&word_level=B2&part_of_speech=noun` — B1 or B2 nouns). `search` keeps the
headwords starting with the prefix, case-insensitively (`?search=ru` — run, rung, runner, …;
a phrase prefix keeps its spaces); ordered as the list is and cacheable like every `GET`, it
is what an autocomplete or an A–Z browser should page through instead of the search.
`is_obsolete=true` / `false` keeps obsolete or current entries only. Without
`form_of_word` only base forms are listed; inflected forms are reachable through their base
entry's `forms` or explicitly (`?form_of_word=past_simple`). Items carry no meanings or
short translations unless `with_meanings=true` / `with_translations=true` is passed.

Pages are read with a cursor: take `meta.next_cursor` of a page and pass it back as
`?cursor=` (with the same filters) to get the next one; `next_cursor` is `null` on the last
page and `has_more` says whether there is one. Unlike page numbers, a cursor never repeats or
skips an item while the dictionary is being edited. `limit` is 1–100, default 20.

> [!IMPORTANT]
> The cursor is opaque — do not build it by hand; an unrecognised value answers `400` with
> `invalid_cursor`, and so does a cursor taken from a page read with other filters (it carries
> a fingerprint of them); `?cursor=` with nothing after it is the first page.

#### Random entry

`GET /api/v1/random` answers one random entry matching the same filters as the list (base
forms unless `form_of_word` is given); `404` when nothing matches. The draw is an index
lookup, not `ORDER BY random()` — cheap on a 300k-row dictionary; entries right after a gap
in the ids come up slightly more often, which does not matter for a "word of the day".

#### Meta

`GET /api/v1/meta` describes what the instance serves: `api_version` (`"1"`), `app_version`
(the server's `package.json`), the dataset — `dataset` (its name on the instance, `default`
for the one it was born with), `source` (where its data comes from: `vocab-bloom-hub`,
`wiktionary`, `wordnet`, `princeton-wordnet`) and `dataset_version` (the version of the dataset the dictionary
was last imported from, `null` for data authored in place or imported without a manifest) —,
the terms of the data — `license` (the SPDX identifier, `"CC-BY-4.0"` for the project's
dataset, `"CC-BY-SA-4.0"` for Wiktionary), `license_url`, `attribution` (the line a consumer
has to show, see [`DATA_LICENSE.md`](../DATA_LICENSE.md)) and `attribution_url` (where the line
links to, `null` when the dataset names none), `notice` (the provenance line to pass on to
readers — for the project's dataset: the data is generated by language models and not
human-verified, [`data.md`](./data.md); an empty string when the dataset has none) — and
`counts` (entries, words, phrases, grammar patterns, word forms, meanings, meaning and short
translations; the counts are refreshed at most once a minute), and `available_languages`: `source`, the language of the headwords (`["en"]`), and `translations`, the
languages a translation may carry on this build (`["ru", "es", "fr", "de", "pt", "zh", "ar"]`) — the values
`?language=` accepts. They describe the schema, not the data: a language is listed whether or not a
translation in it has been imported yet.

The terms are the ones of the **active dataset** and change when the owner activates another
one ([`datasets.md`](./datasets.md)): read them from `meta` rather than hard-coding the
license of the project's dataset. `license_text` holds the notices the source of the dataset
asks to be kept with its data, in full — the WordNet license, the one of the CMU Pronouncing
Dictionary; an empty string for a dataset whose license is named by its link alone. Show it, or
link to a page that does, wherever the license asks for its text on every copy. `dataset`,
`source`, `attribution_url` and `license_text` were added after 1.0 and are optional in the
contract.

`modified_entries` counts the headwords the instance serves with entries that were changed or
added on it: `0` says that the data is what its source published, anything else that a
consumer shows data that differs from the source and has to say so
([The history of a headword](#the-history-of-a-headword)). It is refreshed with the counts, at
most once a minute. Optional in the contract.

### OpenAPI document

The contract above is also an OpenAPI 3 document, built from the controllers, DTOs and
response types of the running code — nothing is hand-written, so it cannot drift.
`GET /api/v1/openapi.json` serves it from any instance, with the caching headers of the prefix;
`apps/server/openapi/public-v1.json` is the committed copy the SDKs and the website are
generated from. Where each is used and the regeneration chain after a change:
[api-tools.md](./api-tools.md#the-openapi-document-the-public-contract-as-a-file). The
generator bootstraps the application without listening, on an in-memory SQLite database, so it
needs no `.env` and its output depends on the source code only; `admin.json` — the whole API
including the admin surface — is written next to it and ignored by git.

**Response schemas**. The controllers type their answers with the TypeScript
contract in `apps/server/types/public/v1`, which Swagger cannot see, so the generator reads
those types with `ts-json-schema-generator`, converts the result to OpenAPI 3.0 component
schemas (`nullable` for `| null`, enums, generics inlined; `src/openapi/json-schema-to-openapi.ts`)
and commits them to `openapi/public-v1.schemas.json`. `src/openapi/public-responses.ts` maps
every public operation to its response type and error statuses; the document build fails for a
route missing there, so an endpoint cannot ship untyped. The running server serves the committed
schemas — no TypeScript at runtime. `test/public-schemas.e2e-spec.ts` calls every operation on a
seeded dictionary and validates the real bodies against the served schemas (strictly, unknown
fields fail), which is what makes the schemas trustworthy for SDK generators.

### SDKs

- **Node.js / TypeScript** — [`@vocab-bloom-hub/client`](../packages/npm-sdk/README.md):
  one method per endpoint (the batch and thesaurus reads included), types generated from
  `openapi/public-v1.json`, typed errors, cursor and page iteration, optional ETag cache, opt-in
  retry on `429` / `5xx` honouring `Retry-After`, a versioned `User-Agent`. ESM and CommonJS with a
  declaration file each. On npm since the first alpha.
- **Python** — [`vocab-bloom-hub`](../packages/python-sdk/README.md): sync and async
  clients on httpx, pydantic models generated from the same spec, typed exceptions, per-request
  options, opt-in retry, cursor and page iteration, ETag cache, `words_dataframe()` for notebooks.
  On PyPI since the first alpha.

### Caching

Dictionary data changes rarely, so the public `GET` reads are built to be cached by browsers,
CDNs and reverse proxies. Every successful `GET` answer carries:

| Header          | Value                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ETag`          | weak, a hash of the JSON body: `W/"…"`. Changes exactly when the answer changes                                                                                                                                                                                      |
| `Last-Modified` | the newest change anywhere in the dictionary (entries, words, meanings, translations), refreshed once a minute; for the reads of every dataset, the newest change of any dataset the instance holds and of their set (one installed, activated or deleted)           |
| `Cache-Control` | `public, max-age=<PUBLIC_API_CACHE_MAX_AGE>, stale-while-revalidate=<the same>` (default `3600`): a shared cache keeps the answer for an hour and may serve it stale for another while it revalidates in the background; `public, no-cache` when the variable is `0` |

`HEAD` answers with the same three headers as the `GET` of that URL, so a cache that checks
freshness with `HEAD` sees the validators it stored. A client that sends the tag back
revalidates in one bodiless round trip:

```bash
curl -i 'http://localhost:3010/api/v1/words/run'                                   # 200, ETag: W/"…"
curl -i -H 'If-None-Match: W/"…"' 'http://localhost:3010/api/v1/words/run'         # 304, no body
curl -i -H 'If-Modified-Since: <Last-Modified>' 'http://localhost:3010/api/v1/words/run'
```

Invalidation is implicit: the `ETag` is a content hash, so the first answer after an edit or
an import carries a new tag and a `304` is never served for changed data. `Last-Modified` is
informational (a minute behind at most) — when both validators are sent the `ETag` decides. A
CDN or proxy in front keeps an answer for `max-age` and then revalidates; lower
`PUBLIC_API_CACHE_MAX_AGE` (or set it to `0`) on an instance whose dictionary is edited live.

> [!NOTE]
> Not cached: the two `POST` requests, the batch lookup and a suggestion (HTTP caches do not
> store `POST`), every error under the prefix (`Cache-Control: no-store`, so a miss or a `429`
> is never served from a cache), and everything under the admin prefixes (`no-store` on every
> answer, including `401`s and the `404`s of a disabled surface).

### Removed aliases

`POST /api/en/search` and `POST /api/en/search/detailed` — the pre-public-API search routes
that answered with the bare bodies and a `Deprecation: true` header through the alpha — are
gone since `v0.2.0-beta.1`, and so are the `POST /api/v1/search` and
`POST /api/v1/search/detailed` forms that bridged the alpha (the same fields in a JSON body).
All four answer `404` like any unknown route; the successors are `GET /api/v1/search` and
`GET /api/v1/search/detailed` with the `{ data, meta }` envelope.

## Running a public-only or admin-only instance

Two switches decide which surfaces an instance serves; both default to on:

| Variable             | Effect when `false`                                                                 |
| -------------------- | ----------------------------------------------------------------------------------- |
| `PUBLIC_API_ENABLED` | `/api/v1/*` answers `404` as if the routes did not exist                            |
| `ADMIN_API_ENABLED`  | `/api/en/*`, `/api/settings`, `/api/auth` answer `404`; the admin UI cannot sign in |

> [!WARNING]
> Disabling both is a configuration error and the server refuses to start.

A demo or embedded instance runs with `ADMIN_API_ENABLED=false` (edit the data elsewhere and
move it over with the dataset export / import, see [offline-import.md](./offline-import.md));
an internal editing instance that must not be readable from outside runs with
`PUBLIC_API_ENABLED=false`.

## Probes: `/api/health` and `/api/ready`

Two routes live under `/api` but belong to neither surface: the liveness probe
`GET /api/health` (`200 { status: 'ok', version }`) and the readiness probe `GET /api/ready`
(`200 { status: 'ok' }`, or `503 { status: 'error', reason }` while the database does not answer
(`database_unreachable`), a shutdown is draining requests (`shutting_down`), the automatic
dictionary load of the first start is still running (`importing`, with `percent` and `stage`)
or that load failed (`import_failed`, with `error`)). They need no login, are not rate-limited, ignore both
switches above and are sent with `Cache-Control: no-store`. They are not part of the `/api/v1`
contract — the public OpenAPI document does not list them and the SDKs do not wrap them; they
are for process managers, orchestrators and the reverse proxy
([`deployment/README.md`](./deployment/README.md#probes)).

## Keeping the admin API private behind a reverse proxy

When one instance serves both surfaces and only the dictionary should be reachable from the
internet, expose `/api/v1` and fence the admin prefixes (`/api/en`, `/api/settings`,
`/api/auth`) at the proxy — by address list or basic auth — or serve them only from a private
network. Tested Caddy and nginx configs for that, TLS, the `TRUST_PROXY` setting the rate limits
need behind a proxy, and the other exposure profiles are in
[`deployment/reverse-proxy.md`](./deployment/reverse-proxy.md).

Set `CORS_ORIGINS` to the origins that may call the API from a browser; `curl`-style clients
are not affected by CORS.
