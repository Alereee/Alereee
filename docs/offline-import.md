# Moving a dictionary between instances offline

The dictionary import normally downloads the published dataset from HuggingFace. Installations
without internet access — corporate networks, air-gapped labs, CI — and admins who edited an
exported dataset can load the same files from a local source instead:

- **files uploaded through the admin UI** — the zip that _Export dictionary_ produces (the
  _Archive_ tab), or the dataset files in their own slots with the manifest either as a file or
  typed by hand (the _Separate files_ tab);
- **a directory or zip on the server** — inside the folder named by `DICTIONARY_IMPORT_DIR`
  (a mounted volume, for instance).

Both go through the same import pipeline as the HuggingFace source; only the download stage is
skipped.

## Dataset format

A dataset is the set of files the export writes, flat or inside a single wrapper folder:

```
manifest.json
LICENSE                                                # the license and the notices of the source, in full
vocab-bloom-hub-en-words.jsonl
vocab-bloom-hub-en-phrasal-verbs.jsonl
vocab-bloom-hub-en-grammar-patterns.jsonl
vocab-bloom-hub-en-phrases.jsonl
vocab-bloom-hub-en-meanings.jsonl
vocab-bloom-hub-en-meaning-translations.<lang>.jsonl   # one per language: .ru, .es, .fr, .de, .pt, .zh, .ar
vocab-bloom-hub-en-short-translations.<lang>.jsonl
vocab-bloom-hub-en-changes.jsonl                       # the history of edits, when the data was edited
```

The entry files (`words`, `phrases`, `grammar-patterns`) carry the entries themselves and their
forms; `phrasal-verbs` is the linking map of base verbs to their phrasal variants. The
collections are files of their own, one line per row next to the key of its parent:

| File                          | One line per                  | Key of the parent                                               |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `meanings`                    | meaning (with its links)      | `word`, `part_of_speech`                                        |
| `meaning-translations.<lang>` | translation of a meaning      | `word`, `part_of_speech`, `meaning_sort_order`, `meaning_title` |
| `short-translations.<lang>`   | short translation of an entry | `word`, `part_of_speech`                                        |

The translations are one file per language (`<lang>` is a member of `available_languages`), so a
file stays a manageable size and a language loads on its own; a language without rows has no
file. Exports made before this split wrote one combined `meaning-translations.jsonl` /
`short-translations.jsonl` for every language — the import still reads those.

Phrases and grammar patterns are keyed the same way, with `phrase` / `grammar_pattern` as the
part of speech. The lines follow the order of the entry files, then the natural keys of the rows,
so two exports of the same data are byte-identical. Datasets published before this layout nest
`meanings` and `short_translations` inside the entry lines; the import still reads them.

Only the `.jsonl` files you actually have are needed — at least one of them; every file but the
words file is optional, and so is `manifest.json`. The collection files are imported after the
entry files and go to the entries and meanings that exist by then, whether they came from this
dataset or were there before: a file of translations alone — one language, say — loads into a
dictionary that already holds the entries, and rows the dictionary already has (a meaning with the
same sort order and title, a translation in the same language with the same title, a short
translation in the same language with the same description) are skipped like duplicate entries.
When the manifest is present
its `version` is stored as _Your version_ after the import (and its synonym / antonym link counts
refine the progress bar); without it the version stays unknown. The terms an export writes into
the manifest — `source`, `license`, `license_url`, `attribution`, `attribution_url`, `notice`
([`DATA_LICENSE.md`](../DATA_LICENSE.md)) — say where the export was taken from. The terms of the dataset
the import fills are the ones the code states for it and do not change with an import; a
manifest that names another `source` than that dataset is refused (`dataset_source_mismatch`):
datasets are never mixed ([`datasets.md`](./datasets.md#datasets-are-never-mixed)). Line counts for the progress bar
are always taken from the files themselves, so a hand-assembled dataset needs no bookkeeping.

**The history of edits** travels with the data
([`datasets.md`](./datasets.md#editing-a-dataset-the-history-of-edits)): `changes` holds one
line per edit made on the instance the export was taken from — the headword and the part of
speech, what was edited, the values before and after, where the edit came from, the name of a
reader who asked to be credited — and `modified_entries` of the manifest counts the entries that
differ from their source by them. The licenses ask that an indication of earlier modifications
is kept, so the import reads the file last (stage 14) and merges it into the history of the
dataset it fills: a line the history already has is skipped, and an edit shows on the importing
instance only where the entry itself was taken from the copy — for an entry the instance kept
as it had it, the edit is recorded as past. The file is absent from an export of a dataset
nobody edited, and data that comes without it is taken to be clean: an import marks no entry as
changed on its own. `LICENSE` is written by the export for whoever receives the files; an import
accepts and ignores it — the terms of a dataset are the ones the code states.

> [!NOTE]
> A dataset of a public source takes nothing generated by a language model: an import whose
> entries are marked `generated` is refused for such a dataset (`generated_not_allowed`).

> [!NOTE]
> The dataset is validated **before** the import starts and is rejected (`dataset_invalid`) when
> there is no `.jsonl` file at all, when `manifest.json` is malformed, or when the folder / archive
> contains any file with an unknown name. OS artefacts (`.DS_Store`, `__MACOSX/`) are ignored.

## Export on A → copy → import on B

> [!NOTE]
> **The version of the entries edited on the instance.** Every entry line carries a `version`:
> the one of the dataset it came from, or `custom_version` once the entry was edited in the admin
> UI. `custom_version` is a mark of the instance and says nothing to whoever takes the copy, so
> the export page has a setting for it, _Version of the entries edited here_
> (`GET /api/en/dictionary/export?edited_version=2.1.0`): the edited entries are written under
> that version. The dictionary itself is not changed, and an export without the setting writes
> `custom_version` as before. An entry whose changes were all taken back carries the version of
> its dataset again and is exported under it. The version of the dataset as a whole is `version` of
> `manifest.json`.

1. On instance A open _Managing → Export dictionary_ (or call `GET /api/en/dictionary/export`
   and download the archive from `GET /api/en/dictionary/export/download/:exportId`). You get
   `vocab-bloom-hub-en-export.zip`.
2. Copy the zip to a machine that can reach instance B.
3. On instance B open _Managing → Import dictionary → Archive_, drop the zip into the upload
   area and press _Start importing_. The progress stream is the same as for the HuggingFace
   import; the manifest version is stored as _Your version_ when the import completes.

   To load the files separately open the _Separate files_ tab instead: one slot per file (the
   slot decides what the file is, its own name does not matter), and the manifest either as
   `manifest.json` or filled in by hand (version, optional synonym / antonym link counts).

Equivalent API calls (the admin cookie or a Bearer token is required). The multipart fields are
`archive` for the whole zip, or `words`, `phrasal_verbs`, `grammar_patterns`, `phrases`,
`meanings`, `meaning_translations_<lang>`, `short_translations_<lang>` (one slot per language, e.g.
`short_translations_es`) and `manifest` for the separate files;
the text fields `version`, `synonym_links` and `antonym_links` stand in for (and override) a
manifest file:

The examples use `localhost:3010`, the port of a start without Docker; under docker compose the
API is on `localhost:3240` by default.

```bash
# the whole archive
curl -N -b cookies.txt -F archive=@vocab-bloom-hub-en-export.zip \
  http://localhost:3010/api/en/dictionary/import/upload

# only the words, the version typed by hand
curl -N -b cookies.txt -F words=@my-words.jsonl -F version=1.4.0 \
  http://localhost:3010/api/en/dictionary/import/upload

# translations only, for entries the dictionary already has
curl -N -b cookies.txt -F short_translations_es=@es-short-translations.jsonl \
  -F meaning_translations_es=@es-meaning-translations.jsonl \
  http://localhost:3010/api/en/dictionary/import/upload

# an export of a WordNet dataset into the WordNet dataset of this instance (installed when it
# is not yet); the active one keeps serving
curl -N -b cookies.txt -F archive=@wordnet-export.zip -F dataset=wordnet \
  http://localhost:3010/api/en/dictionary/import/upload
```

> [!NOTE]
> Each upload is limited to 512 MiB (the file of a public source on the datasets page: 2 GiB);
> the uploaded files are deleted from the server once the
> import has finished, whether or not it succeeded.

## Datasets on the server (`DICTIONARY_IMPORT_DIR`)

When the zip is already on the server — mounted into a container, copied by a deploy script —
point `DICTIONARY_IMPORT_DIR` at the folder holding it:

```dotenv
DICTIONARY_IMPORT_DIR=/data/dictionary-imports
```

The _Archive_ tab then also lists what the folder offers (zip archives and sub-folders
containing a `manifest.json`, one level deep) next to the upload area, and the request names
the pick relative to that folder:

```bash
curl -N -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"source":{"kind":"file","path":"vocab-bloom-hub-en-export.zip"}}' \
  http://localhost:3010/api/en/dictionary/import
```

> [!NOTE]
> Paths are resolved inside the import directory only: `..`, absolute paths and symlinks pointing
> elsewhere are rejected (`dataset_file_not_found`). Without the variable the request fails with
> `import_dir_not_configured` and the _Archive_ tab offers uploads only. The server never modifies
> or deletes the files in that folder.

`GET /api/en/dictionary/import/sources` returns the same listing the UI shows:

```json
{
  "import_dir_configured": true,
  "files": [
    {
      "path": "vocab-bloom-hub-en-export.zip",
      "kind": "zip",
      "size": 12345678,
      "modified_at": "2026-09-15T18:18:25.486Z"
    },
    { "path": "hand-assembled", "kind": "directory", "size": 0, "modified_at": "2026-09-15T18:18:25.486Z" }
  ],
  "revisions": ["v0.1.0"]
}
```

`revisions` are the version tags of the published dataset repository, newest first (the
_Dataset version_ selector of the HuggingFace tab; `[]` when the HuggingFace refs API is
unreachable).

## Notes

> [!IMPORTANT]
> Importing does not wipe the database first: records that already exist (same word, part of
> speech and form) are skipped, the same way the HuggingFace import behaves. To replace existing
> entries with the dataset content (keeping the entries you edited), run the import in update
> mode — see [operations.md](./operations.md#dataset-updates-vs-code-updates).

> [!TIP]
> With Docker Compose, mount the folder into the server container and set the variable to the
> mount point, e.g. `- ./imports:/data/dictionary-imports` and
> `DICTIONARY_IMPORT_DIR=/data/dictionary-imports`.

> [!NOTE]
> `pg_dump` / `pg_restore` remain the right tool for moving a **whole database** including ids;
> the dataset route is for the dictionary content in its portable, diffable form.
