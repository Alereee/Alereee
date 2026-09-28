# Datasets: several dictionaries in one instance

An instance is born with one dictionary, the project's own dataset. It can hold more — the
English Wiktionary, Open English WordNet, Princeton WordNet — each one complete and separate,
**one of them served at a time**. Datasets are never mixed: an answer of the API comes from one
source and carries the terms of that source.

|                     |                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Needs               | PostgreSQL. On SQLite (development) there is the default dataset only and the page says so                                         |
| Where               | Admin → **Managing → Datasets**; `/api/en/datasets` of the admin API                                                               |
| Which datasets      | the ones the code knows: a closed catalog, with the license and the attribution of each stated in it                               |
| A dataset is        | a Postgres schema with the dictionary tables in it, plus a row in the registry                                                     |
| The default dataset | `default`, the tables in `public` an instance always had. It cannot be deleted                                                     |
| Switching           | a click; the server re-opens its database connection on the other schema — no restart, no failed request                           |
| Upgrading to this   | nothing to do: the migration registers the existing dictionary as `default` and leaves it in place                                 |
| Editing             | every dataset can be edited; what was changed is kept as [a history](#editing-a-dataset-the-history-of-edits) and shown to readers |

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
gone from the source are not deleted. When the source has a file that is worth installing, the
card says so ([below](#versions-and-newer-files-of-a-source)).

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

| Route                                   | What it does                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/en/datasets`                  | `{ supported, active, datasets: [...] }`: the catalog with `installed`, `active`, `version`                                                                |
| `GET /api/en/datasets/updates`          | `{ enabled, datasets: [{ name, installed, latest, url, comparable, update_available, checked_at }] }`: what the sources of the installed datasets have now |
| `POST /api/en/datasets/{name}/install`  | installs or updates from the file of the source. `400 dataset_source_invalid` for another file                                                             |
| `POST /api/en/datasets/{name}/activate` | makes it the one the instance serves                                                                                                                       |
| `DELETE /api/en/datasets/{name}`        | drops the dataset with its schema. `409 dataset_is_active` / `dataset_is_default`                                                                          |

One import or installation runs at a time, and no dataset is activated or deleted while one
runs (`409 import_in_progress`, `409 datasets_busy`). On SQLite the routes that change the set
of datasets answer `409 datasets_not_supported`.

**A dataset of another instance.** An export is a dataset in the project's format and goes
through the import page: with more than one dataset installed the page offers _Import into_,
and `dataset` of the import request names a dataset of the catalog, installing it when it is
not ([`offline-import.md`](./offline-import.md)).

## Versions and newer files of a source

**The version of a dataset is what its file says of itself.** It is read when the dataset is
installed, from the file as it was downloaded; the source is not asked, so an instance without
internet access records the same version as one with it, and two instances that installed the
same file report the same `dataset_version`.

| Dataset              | Where the file says it                                       | Version      |
| -------------------- | ------------------------------------------------------------ | ------------ |
| English Wiktionary   | the header of the gzip: the day the extract was made, in UTC | `2026.09.25` |
| Open English WordNet | the folder of the archive, `oewn2025/`                       | `2025`       |
| Princeton WordNet    | the name of its build log, `dict/log.grind.3.1`              | `3.1`        |
| the project's own    | `version` of the manifest of the published dataset           | `1.0.0`      |

- **Attach the file as it is.** An extract that was unpacked and packed again has lost its date,
  an archive packed without its folder its edition: the dataset is then recorded by **the day of
  the installation**, as every dataset was before the versions were read from the files.
- **The pronunciations of CMUdict have no version** and are not a part of the version of a
  WordNet dataset.
- **An installation takes no version from the admin.** Like the license and the attribution,
  the version of a file is a fact of the source. Two other ways into a dataset do carry a version
  that somebody wrote: an export of another instance, imported on the import page, brings the
  version of its manifest, and a manifest filled in by hand there brings the one that was typed
  ([`offline-import.md`](./offline-import.md)). The settings field `en_dataset_version`, which
  mirrors the version of the active dataset and is what `GET /api/v1/meta` reports, can be
  corrected by hand too; the registry and the card of the dataset keep what was installed.
- **A dataset installed by an earlier version of the server** keeps the day of its installation
  until it is installed again: the server does not have the file any more.
- The version is written into every entry of the dataset, into the registry and the manifest of
  an export, and is what `GET /api/v1/meta` and the groups of `GET /api/v1/words/{word}/datasets`
  report. It is a string a client shows, not one it computes with.

**A newer file of the source** is told on the card of the dataset: what is installed, what the
source has now, and a notice when the difference is worth an installation.

| Dataset              | What is asked, once a day at most                                       | The notice appears                                          |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| English Wiktionary   | `HEAD` of the extract on kaikki.org, for its `Last-Modified`            | when the extract of the source is **30 days or more** newer |
| Open English WordNet | the latest release of `globalwordnet/english-wordnet` on the GitHub API | when its edition is newer than the installed one            |
| Princeton WordNet    | nothing: frozen since 2011                                              | never                                                       |
| the project's own    | nothing here: the import page compares it with the published dataset    | on the import page                                          |

- **A notice, not an update.** The file is downloaded and attached by the admin, as at the
  first installation; the link of the notice leads to the page of the source.
- **Wiktionary is made again every few days**, so a notice for every new extract would never go
  away; the card shows the day of the extract of the source at any time.
- **Only installed datasets are asked about**, and only by an instance that may: with
  `UPDATE_CHECK=false` no request leaves the server ([`environment.md`](./environment.md)). What
  is asked is stated in the catalog of datasets, next to the terms of the source. The answers are
  kept in memory for a day, a failure for half an hour; nothing is written to the database.
- **What is sent**: an anonymous request with a `User-Agent` of `vocab-bloom-hub/<version>`,
  nothing about the instance or its data. The file itself is not downloaded.
- **A version that cannot be compared gets no notice**: a dataset recorded by the day of its
  installation does not say which edition it holds, and nothing is guessed. The card says so and
  asks to install the dataset again from the file of its source (`comparable: false`).
- **An older file can be installed over a newer one**: the version becomes the one of the file
  that was attached, and the notice of a newer file appears again.
- `GET /api/en/datasets/updates` (admin) answers what the card shows. Nothing of it is a part of
  the public API.

## What a switch changes

- **Every read and every edit** goes to the tables of the new active dataset: the public API,
  the admin UI, the search, the export, the suggestions of the readers. The one exception is
  the read of a headword from every dataset ([below](#reading-every-dataset-at-once)), which
  answers from all of them whichever is active.
- **`GET /api/v1/meta`** reports the dataset (`dataset`, `source`, `dataset_version`) and its
  terms (`license`, `license_url`, `attribution`, `attribution_url`, `notice`, and `license_text`
  — the notices of the source in full, where its license asks for them); every word of the public API names its `source`, and so does every part of a word served on its own and every edit of the history. The word pages of the website print the license and the
  attribution of the dataset and lead to `/dataset-terms`, the page with the terms in full; the
  form _Report a mistake_ names the license a correction is sent under.
- **Caches are invalidated**: the `ETag` and `Last-Modified` of the public API change with the
  switch, so a client that revalidates gets the new data. The website keeps a rendered word page
  for up to an hour; rebuild or restart it to show the new dataset everywhere at once.
- **Case may tell two words apart.** The project's dataset writes its headwords in lower case;
  Wiktionary and WordNet hold `Polish` next to `polish`. Where a dataset holds both, each is a
  word of its own in the API and a page of its own on the website
  ([`api.md`](./api.md#spellings-that-differ-by-case)).
- **Ids are per dataset.** The entry with id 42 of one dataset has nothing to do with id 42 of
  another: a client that stored ids re-reads them by headword after a switch.
- **The history of edits is per dataset** too: the _History_ page lists the edits of the active
  dataset, and says of every event of the instance which dataset it was about.
- **The moderation queue is per dataset**: a report about an entry stays with the dataset the
  entry belongs to and comes back when that dataset is active again.
- **The automatic first-start import** (`DICTIONARY_AUTO_IMPORT`) fills `default` only, and only
  while `default` is the active dataset.

## Reading every dataset at once

The public API serves the active dataset. One read answers from all of them:
`GET /api/v1/words/{word}/datasets` gives the headword as every dataset of the instance has it,
**a group per dataset** with the terms of that dataset, and
`GET /api/v1/words/{word}/datasets/{dataset}/history` gives what was changed in one of them
([`api.md`](./api.md#a-headword-in-every-dataset)). Nothing is activated for it and nothing is
merged: an entry stays in the group of its dataset, under the license of its source.

- **A connection per dataset.** A dataset that is not the active one is read through a small
  pool of its own (four connections at most, closed when idle like the ones of the application's
  pool), opened by the first such read and kept until the dataset is deleted or becomes the
  active one. With `N` datasets an instance may hold `DB_POOL_SIZE + 4 × (N − 1)` connections
  for its reads; count them against the connection limit of a managed Postgres.
- **No statement names two schemas**: each group is a read of one dataset, the ones the active
  dataset is answered with.
- **The search, the list and the word pages of the website stay on the active dataset.** So do
  the reports of the readers: a report is filed in the active dataset, and the ids of an entry
  of another group mean nothing there.
- **An installed dataset is public.** Before this read existed a dataset was seen by nobody
  until it was activated; now its entries, the history of its edits and the names credited in
  it are read from the moment it is installed — half imported, if the import is still running.
  The datasets page of the admin says so. A dataset that must not be read yet is one that is
  not installed yet.
- **A connection that is not on its schema is refused.** A connection pooler that drops the
  `search_path` startup option would leave the connection of a dataset on `public`, and the
  default dataset would be answered under the terms of another. The server checks
  `current_schema()` when it opens the connection: the read fails with `500` and the log names
  the dataset ([`database.md`](./database.md#datasets-a-schema-each)).
- **`Last-Modified` costs a lookup per dataset**: the newest change of five tables in every
  schema, a sort without an index, at most once a minute and only while these routes are read
  ([`performance.md`](./performance.md)).

## Editing a dataset: the history of edits

Every dataset can be edited in the admin UI, a dataset of a public source like the project's
own. The licenses allow it, and each asks for something in return:

| Dataset                                 | License         | What an edit obliges to                                                        |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| The project's own, Open English WordNet | CC BY 4.0       | keep the attribution, **indicate that the data was modified**                  |
| English Wiktionary                      | CC BY-SA 4.0    | the same, and the modified entry stays under CC BY-SA                          |
| Princeton WordNet                       | WordNet license | the full notice with its disclaimer on every copy, modifications included      |
| CMU Pronouncing Dictionary              | BSD 2-Clause    | keep the copyright notice (it travels with the WordNet datasets that carry it) |

What the instance does about it:

- **Every edit leaves a row in the history of its dataset** — the table `en_changes`, in the
  schema of the dataset, next to the entries it is about. A row holds what was edited (the
  entry, a form, a meaning, a translation), what was done (added, changed, deleted) and **the
  values before and after**, field by field; a record that was added or deleted is kept whole.
  Rows name an entry by its spelling and part of speech, never by an id: ids change when a
  dataset is updated and differ between instances.
- **A reader is told.** A word of the public API carries `modified: true` while it has edits
  that show in what is served — in every answer that carries an entry or a part of one, the
  searches and the partial reads included — and `/api/v1/meta` counts such headwords
  (`modified_entries`). The word page says _changed or added by the owner of this site_ under
  the part of speech, and `GET /api/v1/words/{word}/history` — the section _What was changed on
  this site_ of the word page — lists the edits with their values.
- **The admin is told before the edit**: the card of a word and every dialog of it name the
  dataset being edited and its license.
- **The notices of a source travel in full**: `license_text` of `/api/v1/meta`, the page
  `/dataset-terms` of the website, the instruction of the dataset in the admin UI and a
  `LICENSE` file in every export.
- **An export says how it differs from its source**: `modified_entries` in `manifest.json`, and
  the history itself as a file of the dataset
  ([`offline-import.md`](./offline-import.md#dataset-format)). An instance that imports the
  copy shows the same entries as modified.
- **Nothing generated by a language model goes into a dataset of a public source**: such a
  dataset holds what people wrote and carries no notice about generated text. The forms offer
  no _generated_ switch there, the API answers `400 generated_not_allowed`, and an import that
  carries generated entries is refused.

**What shows and what does not.** A row of the history _shows_ while the edit it records is a
part of what the instance serves. It stops showing — `superseded_at` is set, the row stays —
when an update of the dataset replaces the entry with the content of its source (after _Return
to the official version_), or when the change is taken back. An entry is `modified` exactly
while it has rows that show: there is no flag to keep in step with the table. Readers are shown
the rows that show; the admin sees all of them. History is never erased.

**Taking a change back.** _Take back_ on a row of the history restores the values the change
replaced: an edit gets its old values, a record that was added is removed, one that was deleted
comes back with everything it said. A history is undone from its end — when the record was
edited again after the change, the later change goes first (`409 change_outdated`). What is
restored is written to the history as a row of its own, and an entry with no change left is
what its source says again: an update of the dataset may replace it, and it carries the version
of its dataset instead of `custom_version` — the history records the version an entry had when
it became the owner's, and the last change taken back returns it. An entry edited before the
history recorded versions keeps `custom_version`: nothing is guessed. A change that no longer
shows cannot be taken back (`409 change_not_revertible`).

**The author of a correction.** A reader who sends a correction through _Report a mistake_ may
give a name, with an explicit consent to have it shown and exported; the name goes into the
history when the admin applies the correction and is shown on the word page. A name is personal
data ([`data.md`](./data.md#personal-data)): _Take a name out of the history_ on the _History_
page removes it from the history and the reports of **every dataset of the instance**; the
edits stay.

| Route                                | What it does                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/words/{word}/history`   | public: the edits of a headword that show, the latest first ([`api.md`](./api.md#the-history-of-a-headword))                                              |
| `GET /api/en/changes`                | admin: the whole history of the active dataset; `headword`, `part_of_speech`, `search`, `author`, `entity`, `action`, `origin`, `active`, `page`, `limit` |
| `POST /api/en/changes/{id}/revert`   | admin: takes one change back. `409 change_outdated`, `409 change_not_revertible`                                                                          |
| `POST /api/en/changes/forget-author` | admin: `{ "author": "…" }` — takes a name out of every dataset; answers how many rows named it                                                            |

The history is a part of the data, and the _History_ page keeps it apart from the journal of
the instance: **edits of the dictionary** on one tab — kept for good, exported with the dataset
— and **events of the instance** on the other: imports, settings, switches of the dataset,
verdicts on reports (`audit_log`, kept for `AUDIT_RETENTION_DAYS`). An edit is written to the
history only.

> [!NOTE]
> **A dataset is clean until an edit is recorded.** The history starts empty: on an instance
> that is upgraded, in a dataset that is installed, after an import of data that carries no
> history file. Nothing is guessed about what was edited before — `user_modified` still keeps
> such an entry through an update, and says nothing to a reader. From the first version with
> the history on, every edit is recorded and travels with an export.

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
ds_wiktionary          en_entries, en_words, en_meanings, …, en_changes, suggestions,
                       dataset_migrations
ds_wordnet             the same tables, other rows
```

The connection of the server carries `search_path = ds_<name>, public`: the dictionary tables
resolve to the active dataset, the shared tables to `public`. How the schemas are migrated,
backed up and what a connection pooler has to pass through:
[`database.md`](./database.md#datasets-a-schema-each) and
[`migrations.md`](./migrations.md#shared-and-dataset-migrations).

## Not there yet

- A search across datasets: the headword read answers from every dataset
  ([above](#reading-every-dataset-at-once)), the search from the active one.
- Datasets of other headword languages: the registry records the language of a dataset, the
  tables are the English ones.
