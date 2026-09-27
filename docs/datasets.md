# Datasets: several dictionaries in one instance

An instance is born with one dictionary, the project's own dataset. It can hold more — the
English Wiktionary, Open English WordNet, Princeton WordNet — each one complete and separate,
**one of them served at a time**. Datasets are never mixed: an answer of the API comes from one
source and carries the terms of that source.

|                     |                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Needs               | PostgreSQL. On SQLite (development) there is the default dataset only and the page says so               |
| Where               | Admin → **Managing → Datasets**; `/api/en/datasets` of the admin API                                     |
| Which datasets      | the ones the code knows: a closed catalog, with the license and the attribution of each stated in it     |
| A dataset is        | a Postgres schema with the dictionary tables in it, plus a row in the registry                           |
| The default dataset | `default`, the tables in `public` an instance always had. It cannot be deleted                           |
| Switching           | a click; the server re-opens its database connection on the other schema — no restart, no failed request |
| Upgrading to this   | nothing to do: the migration registers the existing dictionary as `default` and leaves it in place       |

## The catalog

The datasets page shows every dataset the instance can hold, installed or not:

| Dataset               | Name                | Source in the API   | License                       | Installed from                                   |
| --------------------- | ------------------- | ------------------- | ----------------------------- | ------------------------------------------------ |
| The project's own     | `default`           | `vocab-bloom-hub`   | CC BY 4.0                     | the import page: HuggingFace or an export        |
| English Wiktionary    | `wiktionary`        | `wiktionary`        | CC BY-SA 4.0, **share-alike** | `kaikki.org-dictionary-English.jsonl.gz`, 0.5 GB |
| Open English WordNet  | `wordnet`           | `wordnet`           | CC BY 4.0                     | `english-wordnet-2025.zip`, 10 MB                |
| Princeton WordNet 3.1 | `wordnet_princeton` | `princeton-wordnet` | WordNet license               | `wn3.1.dict.tar.gz`, 16 MB                       |

The terms of a dataset — license, attribution line, the notice for readers — are **stated in
the code** (`apps/server/core/constants/dataset_catalog.ts`) and nowhere typed in: what a license
asks for is a fact about the source, and the instance shows it as it is. A new version of the
code that corrects an attribution line corrects it on every instance at its next start. There is
no way to make a dataset of a name of one's own; a new source is a converter and an entry of the
catalog ([converters' README](../apps/server/src/converters/README.md#adding-a-source)).

## Installing a dataset

On the card of a dataset that is not installed, **How to install** opens its instruction:

1. **Download the file** the instruction names, from the source itself — the direct link and
   the page of the source are both there. For WordNet a second, optional file adds the
   pronunciations: `cmudict.dict` of the CMU Pronouncing Dictionary (BSD 2-Clause).
2. **Attach it as it is** — packed, under whatever name — and press _Start_. Nothing is run by
   hand: the server checks that the file is what the source distributes, converts it into the
   project's format and imports the result into a schema of its own. **The active dataset keeps
   serving meanwhile.**
3. **Activate it** on its card when the installation is done. Until then nothing a reader sees
   has changed.

The instruction also states the license with its link, the attribution line to show, and what
to know before serving the data: that a share-alike license binds what is built on it, that
edits and corrections take the license of the dataset, how much space it needs.

Measured on a laptop, Postgres in Docker, the upload included:

| Dataset                        | Entries | Senses    | Translations | Installs in | In the database |
| ------------------------------ | ------- | --------- | ------------ | ----------- | --------------- |
| English Wiktionary, 2026-09-25 | 787 000 | 1 072 000 | 515 000      | 9 min       | 1.4 GB          |
| Open English WordNet 2025      | 135 000 | 185 000   | —            | 70 s        | 170 MB          |
| Princeton WordNet 3.1          | 155 000 | 207 000   | —            | 80 s        | 190 MB          |

The public reads of the full Wiktionary — a headword, the search with its typo tolerance, a
page of the list — answer in under 10 ms, as they do on the project's dataset: every dataset
has the same indexes.

**Updating.** A source publishes newer files; the instance does not fetch them. On the card of
an installed dataset _Update from a newer file_ opens the same instruction: the entries are
replaced with the ones of the newer file, the entries you edited are kept, entries that are
gone from the source are not deleted. The version of a dataset is the day it was installed.

> [!NOTE]
> The file goes to the server in one request, up to 2 GiB. A reverse proxy in front of the
> server has to allow it ([`deployment/reverse-proxy.md`](./deployment/reverse-proxy.md)), and
> the server needs free space for the upload and for the converted files while it installs —
> about as much as the dataset takes in the database.

The same over the API (an admin session in `cookies.txt`,
[`authentication.md`](./authentication.md)); the progress streams back as NDJSON, the
conversion first, then the stages of the import:

```bash
curl -b cookies.txt http://localhost:3010/api/en/datasets                          # the catalog, what is installed

curl -N -b cookies.txt -F file=@kaikki.org-dictionary-English.jsonl.gz \
  http://localhost:3010/api/en/datasets/wiktionary/install
curl -N -b cookies.txt -F file=@english-wordnet-2025.zip -F pronunciations=@cmudict.dict \
  http://localhost:3010/api/en/datasets/wordnet/install

curl -b cookies.txt -X POST http://localhost:3010/api/en/datasets/wiktionary/activate
curl -b cookies.txt -X DELETE http://localhost:3010/api/en/datasets/wordnet       # not the active one, not `default`
```

| Route                                   | What it does                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /api/en/datasets`                  | `{ supported, active, datasets: [...] }`: the catalog with `installed`, `active`, `version`    |
| `POST /api/en/datasets/{name}/install`  | installs or updates from the file of the source. `400 dataset_source_invalid` for another file |
| `POST /api/en/datasets/{name}/activate` | makes it the one the instance serves                                                           |
| `DELETE /api/en/datasets/{name}`        | drops the dataset with its schema. `409 dataset_is_active` / `dataset_is_default`              |

One import or installation runs at a time, and no dataset is activated or deleted while one
runs (`409 import_in_progress`, `409 datasets_busy`). On SQLite the routes that change the set
of datasets answer `409 datasets_not_supported`.

**A dataset of another instance.** An export is a dataset in the project's format and goes
through the import page: with more than one dataset installed the page offers _Import into_,
and `dataset` of the import request names a dataset of the catalog, installing it when it is
not ([`offline-import.md`](./offline-import.md)).

## What a switch changes

- **Every read and every edit** goes to the tables of the new active dataset: the public API,
  the admin UI, the search, the export, the suggestions of the readers.
- **`GET /api/v1/meta`** reports the dataset (`dataset`, `source`, `dataset_version`) and its
  terms (`license`, `license_url`, `attribution`, `attribution_url`, `notice`); every word of the
  public API names its `source`. The word pages of the website print the license and the
  attribution of the dataset, and the form _Report a mistake_ names the license a correction is
  sent under.
- **Caches are invalidated**: the `ETag` and `Last-Modified` of the public API change with the
  switch, so a client that revalidates gets the new data. The website keeps a rendered word page
  for up to an hour; rebuild or restart it to show the new dataset everywhere at once.
- **Ids are per dataset.** The entry with id 42 of one dataset has nothing to do with id 42 of
  another: a client that stored ids re-reads them by headword after a switch. The _History_
  page says which dataset a row is about.
- **The moderation queue is per dataset**: a report about an entry stays with the dataset the
  entry belongs to and comes back when that dataset is active again.
- **The automatic first-start import** (`DICTIONARY_AUTO_IMPORT`) fills `default` only, and only
  while `default` is the active dataset.

## Datasets are never mixed

An import is refused with `409 dataset_source_mismatch` when the data names another source than
the dataset it would go into: an export of a Wiktionary dataset does not land in the project's
dataset because the target was left on _the active dataset_, and the published dataset of the
project does not land in an active Wiktionary. A dataset without a `source` in its manifest (an
export of an older version, files assembled by hand) is taken for what the target holds. An
installation cannot mix at all: the file of a source goes into the dataset of that source.

> [!WARNING]
> **One server process per database.** A switch re-opens the connection of the process that
> handled the request; another server process on the same database keeps serving the dataset it
> started with until it is restarted. Run one, as the deployment guide asks
> ([`deployment/README.md`](./deployment/README.md)), or restart the others after a switch.

## Public sources

| Source                     | Where it comes from                                                                 | License         | Updated               |
| -------------------------- | ----------------------------------------------------------------------------------- | --------------- | --------------------- |
| English Wiktionary         | <https://kaikki.org/dictionary/English/>, the extract wiktextract makes of the wiki | CC BY-SA 4.0    | every few days        |
| Open English WordNet       | <https://github.com/globalwordnet/english-wordnet/releases>                         | CC BY 4.0       | an edition a year     |
| Princeton WordNet 3.1      | <https://wordnet.princeton.edu>                                                     | WordNet license | not since 2011        |
| CMU Pronouncing Dictionary | <https://github.com/cmusphinx/cmudict>, the pronunciations of a WordNet dataset     | BSD 2-Clause    | a correction at times |

What each source has and what a converted entry looks like — the titles derived from the
definitions, the forms folded into their base word, the translations of Wiktionary — is in the
[converters' README](../apps/server/src/converters/README.md), together with how to add a
source. The converters also run from a checkout, without an instance
(`yarn workspace server convert wordnet --input english-wordnet-2025.zip --out ./wordnet-en`):
the folder they write is a dataset like an export.

> [!IMPORTANT]
> **The license of a source binds the instance that serves it.** Wiktionary is share-alike: what
> the instance serves, exports and accepts as corrections while that dataset is active is under
> CC BY-SA 4.0, and a product built on it has to say so and keep derived data under the same
> license. Show the `attribution` of `GET /api/v1/meta` wherever you show the data. GPL sources
> (GCIDE) have no converter on purpose.

## On SQLite

SQLite has no schemas, and it is the database of development only: the instance holds the
default dataset, the datasets page shows the catalog and every instruction, and nothing can be
installed — the page says why. A dataset of a public source needs PostgreSQL.

## In the database

```
public                 settings, datasets, audit_log, migrations, dataset_migrations,
                       the enum types — and the tables of the `default` dataset
ds_wiktionary          en_entries, en_words, en_meanings, …, suggestions, dataset_migrations
ds_wordnet             the same tables, other rows
```

The connection of the server carries `search_path = ds_<name>, public`: the dictionary tables
resolve to the active dataset, the shared tables to `public`. How the schemas are migrated,
backed up and what a connection pooler has to pass through:
[`database.md`](./database.md#datasets-a-schema-each) and
[`migrations.md`](./migrations.md#shared-and-dataset-migrations).

## Not there yet

- Reading a headword from every dataset in one request, each answer with its own terms
  ([#528](https://github.com/Fristail27/vocab-bloom-hub/issues/528)); a search across datasets.
- Datasets of other headword languages: the registry records the language of a dataset, the
  tables are the English ones.
