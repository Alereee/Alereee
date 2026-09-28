# Converters: a dataset from a public source

An instance can serve a dictionary that was not generated for this project: the English
Wiktionary, WordNet. A converter reads what such a source distributes and writes a dataset in the
project's own format — the JSONL files and `manifest.json` the import reads — so the import, the
API and the website need to know nothing about the source.

**An admin does not run a converter.** On the datasets page of the admin UI the instruction of a
dataset says which file to download; the file is attached, and the server converts and imports
it into the dataset's own schema ([`docs/datasets.md`](../../../../docs/datasets.md),
`POST /api/en/datasets/{name}/install`). The command line below is the same code without an
instance — for working on a converter, or for making a dataset on another machine:

```bash
yarn workspace server convert wiktionary --input kaikki.org-dictionary-English.jsonl.gz --out ./wiktionary-en
yarn workspace server convert wordnet --input english-wordnet-2025.zip --cmudict cmudict.dict --out ./wordnet-en
yarn workspace server convert wordnet --edition princeton --input wn3.1.dict.tar.gz --out ./wordnet-3.1
yarn workspace server convert --help
```

`--version` names the version of the dataset; without it the version is the one the file says of
itself — the day the extract of Wiktionary was made, the edition of a WordNet — and the day of
the conversion for a file that does not say. `--limit n` stops after `n` records of the source
for a trial run. The input is the file as it is
downloaded: packed or not, its format is told by its first bytes.

## The sources

| Adapter      | Dataset of the catalog         | What it reads                                                                                                                                            | License of the data        | What it has                                                                                     |
| ------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `wiktionary` | `wiktionary`                   | `kaikki.org-dictionary-English.jsonl.gz` from <https://kaikki.org/dictionary/English/> (0.5 GB; 3.3 GB unpacked)                                         | CC BY-SA 4.0               | definitions, examples, IPA, forms, synonyms and antonyms, translations into the seven languages |
| `wordnet`    | `wordnet`, `wordnet_princeton` | `english-wordnet-<year>.zip` of <https://github.com/globalwordnet/english-wordnet/releases>; `wn3.1.dict.tar.gz` of Princeton with `--edition princeton` | CC BY 4.0; WordNet license | definitions, examples, synonyms and antonyms, irregular plurals and degrees; no translations    |
| `--cmudict`  | an option of `wordnet`         | `cmudict.dict` from <https://github.com/cmusphinx/cmudict>                                                                                               | BSD 2-Clause               | pronunciations of American English, turned from ARPAbet into IPA                                |

The terms of a source — `source`, `license`, `license_url`, `attribution`, `attribution_url`,
`notice` — are stated once, in the catalog of datasets
(`apps/server/core/constants/dataset_catalog.ts`): the converter writes them into the manifest,
the instance shows them in `GET /api/v1/meta` and on the word pages, and nobody types them in.
**Wiktionary is share-alike**: an instance that serves the dataset serves it under CC BY-SA 4.0,
its exports and the corrections its readers send included. Neither source is mixed with the
project's own data: a dataset has one source.

## What a converted entry is

The model of the project asks for a few things no source has, and has no place for a few things
the sources have. The decisions, in one place:

- **One entry per headword and part of speech.** Wiktionary splits a word by etymology; the
  records of one headword follow each other in the extract, so the writer merges the ones that
  share a part of speech: the meanings follow each other, a repeated definition is kept once.
- **A meaning needs a title.** It is the head of its definition: the first clause, cut at a
  word, at most 60 characters (`titleOf`).
- **An inflected form is a form of its entry, not an entry.** The pages Wiktionary keeps for
  "lamps" or "ran" are left out; the forms come from the list of the base word. Forms marked
  obsolete, dialectal or as another spelling are left out too.
- **The forms of a dead word are listed as obsolete.** "limp" has an etymology of its own for
  the obsolete "to happen", past "lamp": merged into the entry of the living verb, those forms
  carry `is_obsolete`, and the irregular flags are read from the living forms only.
- **A headword of several words is regular when the words that change are**: "watch it" →
  "watched it" follows the rule, "wear out" → "wore out" does not.
- **WordNet does not say which irregular form of a verb is which.** Its exception list maps
  "went" and "gone" to "go" and nothing more, so a verb is flagged as irregular and gets no
  forms. Plurals and the degrees of adjectives are unambiguous and are kept.
- **No register is no register.** A meaning the source does not mark is neither formal nor
  informal; the import keeps an empty `language_register` empty.
- **No CEFR level.** Neither source has one: `word_level` and `meaning_level` stay empty.
- **A phrasal verb is a verb followed by particles** ("give up", "look forward to"); it names
  its base verb, and the base verb lists it — when the source has an entry for the base verb.
- **Translations are single words here.** Wiktionary translates a sense with words, not with
  a sentence: a translation has a `title` and `variants_of_words` and an empty `definition`.
  Mandarin is what is filed under `zh`: the varieties Wiktionary files under the same code
  (Dungan, Hokkien, …) are left out, and a translation must be written in the script of its
  language. The notes the editors write into a translation — "resistir (sin ceder)", "общага f"
  — are taken off; what still carries markup after that is left out. The short translation of an entry is the main words of its meanings.
- **Nothing is generated.** `generated` is false and `generated_by_model` empty on every line.

## Adding a source

A source is a converter and an entry of the catalog:

1. **The entry** in `DATASET_CATALOG` (`core/constants/dataset_catalog.ts`): the name of the
   dataset, its `source` in the public API, the license with its link, the attribution line,
   what an entry carries, the files to download — name, direct link, page of the source,
   size — and `update_check`: how an instance learns of a newer file (`last_modified` of a file,
   the `latest_release` of a repository on GitHub, or `none` for a source that is frozen). Read the license of the source, not a summary of it: a share-alike or a non-commercial
   license changes what an instance may do. The datasets page and its instruction are built
   from the entry; the texts that are not data are `about_<name>` in the message catalogs of
   the admin UI, in every interface language.
2. **The adapter**, one module under `sources/` that exports a `SourceAdapterT` (`types.ts`):
   `name`, `description` (one line for `--help`), `provenance` — `termsOfAdapter(name, options)`,
   the terms of the catalog — `versionOf(input, options)` and `convert(input, options, context)`.
   `versionOf` answers the version the file of the source says of itself, or `null`: it reads the
   file as it was downloaded and asks nothing of the source (`version.ts` has what the present
   sources read — the header of a gzip, the names in an archive). It reads the input **as a
   stream** (`readLines` in `input.ts`; the dumps are gigabytes, `context.progress` takes the
   bytes read) and calls `context.emit(entry)` for every entry, in the order of the source, and
   `context.skip(reason)` for every record it leaves out. An entry is a `ConvertedEntryT`:
   `emptyEntry(word, partOfSpeech)` from `normalize.ts` with what the source knows filled in.
   Records of one headword must follow each other. A packed release is unpacked with
   `unpackFiles` (`unpack.ts`: zip and tar.gz).
3. Add the adapter to `SOURCES` in `sources/index.ts`, and teach
   `EnDatasetInstallService.inputOf` to tell the file of the source from another one before
   anything is converted.
4. Tests with a fixture **written for the test** in the format of the source — no text of the
   source is copied into the repository, whose code is MIT. `dataset-install.e2e-spec.ts` in
   `apps/server/test` installs the fixtures through the real route and reads them from the API;
   `dataset_catalog.spec.ts` holds the catalog and the adapters together.

The writer (`writer.ts`) is the only place that knows the dataset files; an adapter never writes
one.
