# Read performance on the full dictionary

How the API behaves on the real data volume — ~298k `en_entries`, ~327k
`en_words`, ~161k `en_meanings`, ~807k meaning translations and ~576k short translations (five
languages), ~509k synonym and ~183k antonym links — what was done about it, and how to measure
it again.

## Targets and where things stand

| Read (public API)                                  | Target (p95) | Postgres now | Note                                            |
| -------------------------------------------------- | -----------: | -----------: | ----------------------------------------------- |
| Headword / id lookup (`/words/{word}`, `/id/{id}`) |        20 ms |       ≤ 4 ms | one query per relation, rows assembled by hand  |
| Filtered list page (`/words?…`)                    |        20 ms |       ≤ 5 ms | index walk in `(word, id)` order, keyset cursor |
| Random entry (`/random?…`)                         |        20 ms |       ≤ 7 ms | primary-key pivot, no `ORDER BY random()`       |
| Search, exact / prefix tiers (`/search`)           |        20 ms |       ≤ 8 ms | byte-order index on the headword                |
| Search, substring / suffix tiers                   |        20 ms |       ≤ 8 ms | trigram GIN index                               |
| Search, typo (fuzzy tier)                          |        20 ms |      ≤ 10 ms | `pg_trgm` similarity when nothing else matches  |
| Search, 1–2 character term (short-term flow)       |        20 ms |       ≤ 6 ms | exact and prefix tiers only, index lookups      |
| List page with meanings joined (`with_meanings`)   |        50 ms |      ≤ 13 ms | 8 small queries instead of one exploding join   |
| Batch lookup, 5 spellings (`/words/batch`)         |        20 ms |       ≤ 5 ms | the same 9 statements as one headword           |
| Batch lookup, 50 spellings (the cap)               |       100 ms |      ≤ 25 ms | 9 statements, ~80 entries, no entity hydration  |

> [!NOTE]
> Numbers are p95 of the [benchmark](#the-benchmark) on a laptop against a local Postgres 18
> with the published dataset; treat them as an order of magnitude, not a promise.

The full reads cost the same 9 statements whatever they return — the entries, then one
`IN (...)` per relation for the whole set — so a batch's time grows with the entries it
returns, not with the spellings: 50 everyday headwords are ~80 entries with ~240 meanings (a
285 KB answer) in ~22 ms. They used to take ~275 ms: the same statements, but `find()` with
relations then spent ~220 ms turning the rows into entity instances. Now
`WordRowsService` (`src/modules/EnModule/word-rows.service.ts`) runs the statements itself —
in two concurrent waves after the entries (the collections of the entries, then those of the
meanings), so a read costs three round-trips whatever the distance to the database —
converts the raw values through the driver (the conversion hydration applies: booleans, enums,
arrays, JSON, dates) and groups the collections by foreign key in one pass; a unit test pins
its answer to `find()`'s field for field. The admin entry read, the detailed search and the
list with joins go through it too.

> [!WARNING]
> **SQLite is a development and test database only.** On the full dictionary its search tiers
> take 0.1 – 1 s per request and the admin statistics 0.25 s (tables below): `LIKE` cannot use
> its indexes, there is no `pg_trgm` (no fuzzy tier either) and the planner has no bitmap or
> parallel scans. The reads that became index lookups after this work (headword / id lookups
> ~1 ms, random ~8 ms, list pages 10 – 30 ms) are fine on SQLite too, so a full `dev.sqlite`
> stays usable for hacking on the API — but nothing else. `NODE_ENV=production` with a SQLite
> `DATABASE_URL` is a startup error, as before.

## What was slow and what changed

The [benchmark](#the-benchmark) with `--explain` found seven problems; each is fixed by a
change that the [query-plan guard](#the-query-plan-guard) keeps in place.

1. **Loading an entry multiplied its rows.** `find()` with nested relations joins everything
   in one statement, so a word with 4 forms × 4 meanings × 4 translations × 8 synonyms comes
   back as thousands of rows to deduplicate: 45 ms on Postgres and 2.2 s on SQLite for
   `GET /api/v1/words/run`. The reads that load the meaning tree now use
   `relationLoadStrategy: 'query'` — one query per relation (~20 small statements, each an
   index lookup) — 5 – 8 ms on Postgres, ~1 ms on SQLite. Every relation load uses it, even
   the light `word + forms` of a list page: joins would be ~1 ms cheaper on Postgres there,
   but SQLite materializes the whole `forms` table for that join (0.6 s per page), and a
   bounded handful of index lookups has no worst case to discover later.
2. **Prefix search could not use an index.** `entry.word LIKE 'xylo%'` under the `en_US`
   collation is a sequential scan of `en_entries`; a rare term ran every tier at full cost —
   490 ms. The prefix tiers (starts-with, phrase start) and the admin prefix filter now
   compare through `LOWER(word) COLLATE "C"` (the `foldedWord()` helper; case-folded so
   the capitalised grammar patterns stay findable), served by
   `IDX_EN_ENTRY_WORD_LOWER_C`:
   35 ms, the rest being the substring tiers, which the trigram index (below) brought to 7 ms.
3. **The list had no index for its filters.** `?category=IT` scanned and sorted all of
   `en_words`: 244 ms. `AddWordFilterIndexes` adds a btree per filter column
   (`word_level`, `language_register`, `area_variant`, `form_of_word`), a GIN over the
   `categories` array (the filter uses the overlap operator `&&`, the only indexable form)
   and `IDX_EN_WORD_LOWER_C` on `(LOWER(word) COLLATE "C", id)`, the order the list pages in.
   The list no longer joins `en_entries`: the same headword is on `en_words`, and the planner
   either walks `IDX_EN_WORD_LOWER_C` (unselective filters) or bitmap-ANDs the filter indexes and top-N
   sorts (selective ones). 2 – 4 ms either way.
4. **The keyset cursor started the index walk from the beginning.** `word > :w OR (word = :w
AND id > :id)` is a filter, not a range start: a page at "m" read half the index (23 ms).
   The row comparison `(word, id) > (:w, :id)` is one index range condition: 0.1 ms
   (SQLite uses its `word` index for it too).
5. **The random draw scanned for its bounds.** `MIN(id)`/`MAX(id)` under the filters was a
   sequential scan (38 ms). The pivot is now drawn in the id range of the whole table (two
   primary-key lookups) and the first matching row at or after it is taken, wrapping around
   to the last one before it: 4 – 7 ms whatever the filter.
6. **Substring, suffix and word-boundary search tiers** (`%term`, `%term%`, `% term %`) were sequential scans of `en_entries` — a btree cannot serve them. `AddEntryWordTrigramIndex` enables `pg_trgm` and adds `IDX_EN_ENTRY_WORD_TRGM`, a GIN over the trigrams of the headword: the same `LIKE`s now read the index (a rare term 35 → 7 ms, a phrase 38 → 5.5 ms), and a **fuzzy tier** answers typos through the similarity operator when no other tier matches (`recieve` → `relieve, retrieve, …` in 8 ms, `meta.fuzzy`, `similarity` per item — see `api.md`). Very short terms (`ab`) have no full trigram and get their own flow (below).

7. **One- and two-character terms ran every tier.** `%a%` matches ~175k of 298k headwords, so
   the suffix, substring and phrase tiers answered an arbitrary slice of half the dictionary
   (on Postgres a scan cut short by the `LIMIT`, on SQLite ~0.7 s), and a term with no full
   trigram has nothing to look up in the GIN. A term shorter than
   `SEARCH_MIN_SUBSTRING_LENGTH` (3) stops after the exact and prefix tiers — both index
   lookups — and answers `meta.short_term: true`; a blank term answers nothing without a
   query. `a` and `ab`: 5 – 6 ms, every statement an index lookup (the guard covers them).

Not changed, by design:

- **Admin listings** count their total with `COUNT(DISTINCT …)` over a join and page by
  offset: 20 – 45 ms, admin-only, not part of the public contract.
- **Statistics** are counts over whole tables by nature (50 ms, cached by the UI).
- **`Last-Modified`** (`ORDER BY updateAt DESC LIMIT 1` on five tables) is a sort without an
  index, run at most once a minute behind a cache. The reads of a headword from every dataset
  run it in every dataset the instance holds, behind a cache of their own, and only while they
  are asked for.

## The benchmark

```bash
yarn workspace server bench                     # DATABASE_URL from the root .env
yarn workspace server bench --iterations 100    # more samples (default 30 after 3 warm-up calls)
yarn workspace server bench --explain           # Postgres: EXPLAIN every statement, report Seq Scans
yarn workspace server bench --json out.json     # raw numbers
DATABASE_URL=sqlite:../../dev.sqlite yarn workspace server bench   # the same on SQLite (from apps/server)
```

`src/bench/run.ts` boots the real application on an ephemeral port and drives the scenarios
of `src/bench/scenarios.ts` through HTTP — every search tier, the headword / id lookups, the
batch lookup (5 spellings and the 50-spelling cap), the list at several selectivities and
cursor depths, the random draw, the meta endpoint and the admin listings. It reports p50 / p95 / max latency and, through a TypeORM logger attached
to the data source (`QueryRecorder`), **how many statements one request costs** — the N+1
audit in one column. `--explain` runs `EXPLAIN (FORMAT JSON)` on each recorded statement
with its parameters bound and prints the sequential scans over the large tables.

> [!NOTE]
> The scenarios need the loaded dictionary (they look up the verb _run_). Load it with the
> import page or `docs/offline-import.md`.

## The query-plan guard

```bash
yarn workspace server test:postgres      # needs a postgres:// DATABASE_URL with the migrations applied
```

`test/query-plans.pg-spec.ts` runs the public scenarios with `SET enable_seqscan = off`
and explains every statement they issue: with sequential scans discouraged the planner
picks an index path whenever one exists, so a `Seq Scan` on `en_entries`, `en_words`,
`en_meanings` or the translation and link tables means **no index can serve that query** —
on the full dictionary and on the empty database of CI alike. The `postgres-only tests` job of
`check-pull-request` runs it against a fresh Postgres service after `migration:run`, so a
query change that loses its index fails the pull request. The only statements skipped on purpose are the `Last-Modified` lookups (see above); the same job runs the trigram search suite (`test/fuzzy-search.pg-spec.ts`).

## Indexes on the large tables

Beyond the primary keys and the foreign-key indexes TypeORM creates for relations:

| Table               | Index                                                                                                                            | Serves                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `en_entries`        | `IDX_EN_ENTRY_WORD_LOWER_C` on `(LOWER(word) COLLATE "C")`                                                                       | prefix search tiers, admin prefix filter                                         |
| `en_entries`        | `IDX_EN_ENTRY_WORD_TRGM` GIN on `(word gin_trgm_ops)`                                                                            | substring / suffix / phrase search tiers, the fuzzy tier (`%`) — needs `pg_trgm` |
| `en_words`          | `IDX_EN_WORD_LOWER_C` on `(LOWER(word) COLLATE "C", id)`                                                                         | list order and cursor                                                            |
| `en_words`          | `IDX_EN_WORD_LEVEL`, `IDX_EN_LANGUAGE_REGISTER`, `IDX_EN_AREA_VARIANT`, `IDX_EN_FORM_OF_WORD`                                    | list and random filters (bitmap-ANDed)                                           |
| `en_words`          | `IDX_EN_CATEGORIES` GIN on `(categories)`                                                                                        | `?category=` (`categories && ARRAY[…]`)                                          |
| `en_words`          | `IDX_EN_WORD`, `IDX_EN_WORD_LOOKUP`, `IDX_EN_PART_OF_SPEECH`, `IDX_EN_BASE_FORM`, `IDX_EN_BASE_PHRASAL`, `IDX_EN_PHRASAL_SEARCH` | headword lookups, part of speech, forms and phrasal links                        |
| `en_meanings`       | `IDX_EN_MEANING_WORD`, `IDX_EN_MEANING_WORD_SORT`                                                                                | meanings of an entry                                                             |
| translations, links | `…_MEANING`, `…_WORD`, `…_LANGUAGE`, junction primary keys                                                                       | translations and synonym / antonym links of a meaning                            |

Indexes a decorator cannot express (`COLLATE "C"`, GIN) are declared on the entity with
`MANUALLY_MANAGED_INDEX` (`synchronize: false`) and created by their migration
(`AddCaseFoldedWordIndexes`, `AddWordFilterIndexes`, `AddEntryWordTrigramIndex`); `migration:generate` leaves them alone.
An expression index (`LOWER(word) COLLATE "C"`) gets planner statistics only from `ANALYZE`,
which its migration runs right after creating it — without them a one-row lookup on the
expression is estimated at 0.5 % of the table and planned with parallel workers, ~5 ms of
start-up instead of 0.1 ms; autovacuum keeps the statistics fresh afterwards.
SQLite gets the plain btrees through `synchronize` and needs nothing for the rest.

## Numbers

p50 before → after the changes above (the Postgres "after" includes the trigram index and the short-term flow; the fuzzy and one-letter scenarios did not exist before), then p95 and max after; "queries" is the number of SQL statements one request issues. Postgres 18, 30 iterations; SQLite (better-sqlite3 on the same `dev.sqlite`, no trigram index), 10 – 20 iterations. Same laptop, same dataset.

### Postgres

| Scenario                                        | Queries before → after | p50 before → after | p95 after | max after |
| ----------------------------------------------- | ---------------------: | -----------------: | --------: | --------: |
| search exact "run" (+ phrasal, prefix tiers)    |                  2 → 8 |      **3.8 → 6.5** |       7.3 |       8.9 |
| search one letter "a" (short-term flow)         |                  — → 9 |        **— → 5.6** |       6.0 |       6.0 |
| search broad prefix "ab" (short-term flow)      |                  4 → 9 |      **6.9 → 5.3** |       6.0 |       6.8 |
| search rare "xylo"                              |                 8 → 12 |      **491 → 6.9** |       8.2 |       8.8 |
| search phrase "put up"                          |                 6 → 12 |     **31.7 → 5.5** |       6.9 |       8.0 |
| search typo "recieve" (fuzzy tier)              |                 — → 13 |        **— → 8.5** |       9.6 |      11.7 |
| search no match "qzxvj" (fuzzy tier, empty)     |                  — → 6 |        **— → 3.3** |       3.7 |       4.0 |
| search detailed "run" + meanings + translations |                 2 → 17 |    **16.0 → 13.9** |      14.7 |      14.7 |
| word "run" (noun + verb, full)                  |                 2 → 22 |     **45.3 → 6.8** |       8.3 |       8.4 |
| word "ran" (form → base entry)                  |                 2 → 22 |     **42.7 → 5.5** |       6.5 |       6.9 |
| word by id (run, verb)                          |                 2 → 21 |     **42.0 → 5.0** |       5.8 |       7.5 |
| word "run" translations                         |                 2 → 22 |     **45.0 → 5.7** |       6.6 |       7.3 |
| list first page (no filter)                     |                  2 → 8 |      **2.0 → 2.9** |       3.4 |       3.9 |
| list word_level=B1                              |                  2 → 8 |      **3.3 → 2.8** |       3.1 |       4.2 |
| list noun + C2                                  |                  2 → 8 |      **2.9 → 3.7** |       4.5 |       4.7 |
| list category=IT (rare)                         |                  2 → 8 |      **244 → 4.1** |       4.8 |       5.1 |
| list language_register=slang                    |                  2 → 5 |     **16.7 → 2.1** |       3.0 |       3.3 |
| list form_of_word=past_simple                   |                  2 → 5 |      **3.1 → 2.0** |       2.4 |       2.5 |
| list cursor at "m" (deep page)                  |                  2 → 8 |      **9.1 → 3.6** |       4.1 |       4.5 |
| list cursor at "m" + word_level=C1              |                  2 → 8 |      **8.1 → 3.1** |       3.4 |       4.0 |
| list 50 + meanings + translations               |                 2 → 17 |    **12.1 → 13.7** |      20.2 |      23.9 |
| random (no filter)                              |                 4 → 19 |     **38.7 → 5.0** |       6.5 |       7.2 |
| random A1 noun                                  |                 4 → 19 |     **20.9 → 5.2** |       7.0 |       7.8 |
| random category=medical                         |                 4 → 17 |     **27.7 → 4.5** |       5.2 |       6.5 |
| meta                                            |                  1 → 1 |      **0.5 → 0.4** |       0.5 |       0.7 |
| admin words word_level=B1 (page 1 + total)      |                  2 → 2 |    **25.9 → 19.5** |      21.9 |      27.1 |
| admin words search=un (prefix)                  |                  2 → 2 |    **36.1 → 37.7** |      38.8 |      39.4 |
| admin meanings part_of_speech=verb              |                  3 → 3 |    **45.1 → 44.6** |      46.9 |      49.3 |
| admin word by id                                |                 2 → 21 |     **42.7 → 6.0** |       6.6 |       7.6 |
| admin statistics                                |                15 → 15 |    **52.3 → 51.6** |      57.8 |      58.9 |

### SQLite

| Scenario                                        | Queries before → after | p50 before → after | p95 after | max after |
| ----------------------------------------------- | ---------------------: | -----------------: | --------: | --------: |
| search exact "run" (+ phrasal, prefix tiers)    |                  2 → 8 |     **1185 → 642** |       652 |       655 |
| search broad prefix "ab"                        |                 8 → 11 |      **683 → 119** |       122 |       129 |
| search rare "xylo"                              |                 8 → 12 |      **869 → 297** |       299 |       305 |
| search phrase "put up"                          |                 6 → 12 |     **1240 → 945** |       950 |       955 |
| search detailed "run" + meanings + translations |                 2 → 16 |     **1720 → 655** |       669 |       673 |
| word "run" (noun + verb, full)                  |                 2 → 21 |     **2191 → 1.2** |       1.4 |       1.4 |
| word "ran" (form → base entry)                  |                 2 → 21 |     **1916 → 1.0** |       1.1 |       1.2 |
| word by id (run, verb)                          |                 2 → 20 |     **2487 → 1.0** |       1.1 |       1.1 |
| word "run" translations                         |                 2 → 21 |     **2211 → 1.1** |       1.3 |       1.4 |
| list first page (no filter)                     |                  2 → 8 |     **657 → 27.3** |      27.6 |      28.6 |
| list word_level=B1                              |                  2 → 8 |     **634 → 10.1** |      10.2 |      10.6 |
| list noun + C2                                  |                  2 → 8 |     **610 → 14.6** |      15.0 |      15.9 |
| list category=IT (rare)                         |                  2 → 8 |     **631 → 28.6** |      29.1 |      30.4 |
| list language_register=slang                    |                  2 → 5 |      **625 → 0.8** |       0.8 |       1.0 |
| list form_of_word=past_simple                   |                  2 → 5 |      **600 → 6.7** |       7.0 |       7.1 |
| list cursor at "m" (deep page)                  |                  2 → 8 |     **658 → 29.4** |      30.4 |      31.1 |
| list cursor at "m" + word_level=C1              |                  2 → 8 |     **642 → 18.3** |      19.0 |      19.2 |
| list 50 + meanings + translations               |                 2 → 16 |    **1178 → 34.9** |      36.1 |      39.6 |
| random (no filter)                              |                 4 → 19 |     **2538 → 7.4** |       7.6 |       7.8 |
| random A1 noun                                  |                 4 → 19 |     **2527 → 8.0** |       8.5 |       8.6 |
| random category=medical                         |                 4 → 19 |     **2520 → 7.6** |       8.2 |       8.5 |
| meta                                            |                  1 → 1 |      **0.3 → 0.2** |       0.3 |       0.3 |
| admin words word_level=B1 (page 1 + total)      |                  2 → 2 |    **79.2 → 26.7** |      28.0 |      28.8 |
| admin words search=un (prefix)                  |                  2 → 2 |      **123 → 102** |       103 |       108 |
| admin meanings part_of_speech=verb              |                  3 → 3 |    **55.9 → 56.8** |      58.2 |      63.1 |
| admin word by id                                |                 2 → 20 |     **2460 → 1.1** |       1.3 |       1.3 |
| admin statistics                                |                15 → 15 |      **253 → 264** |       266 |       266 |
