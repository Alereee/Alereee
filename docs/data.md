# Dictionary data: provenance and quality

What the dictionary is made of, where it comes from, what is known to be wrong with it and how
to report errors. The terms of use are in [`DATA_LICENSE.md`](../DATA_LICENSE.md): the data is
**CC BY 4.0**, the code is MIT. The published copy of the data is the HuggingFace dataset
[`Fristail27/vocab-bloom-hub-en`](https://huggingface.co/datasets/Fristail27/vocab-bloom-hub-en);
its dataset card is the full, revision-specific version of this page (counts per model, field
statistics, content notes).

This page is about **the project's own dataset**, the one an instance is born with. An instance
can hold datasets of other sources next to it — the English Wiktionary, WordNet — each under the
terms of its source: [Datasets from other sources](#datasets-from-other-sources).

## Where the data comes from

Every entry is produced by an **LLM-assisted pipeline** — a model is asked for the entry
(transcription, CEFR level, senses with definitions and examples, translations,
inflected forms), the answer is stored in the Hub database, and the database is what gets
exported and published. Nothing is scraped or copied from other dictionaries.

Two columns on every base-form word record the provenance:

| Field                | Meaning                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `generated`          | `true` when the entry was produced by a model; `false` for entries authored by hand in the admin  |
| `generated_by_model` | The model behind the entry, as an OpenRouter-style id (`deepseek/deepseek-v4-flash`); may be null |

The published data is generated with DeepSeek models — the bulk with DeepSeek v4 Flash, smaller batches with
`deepseek/deepseek-v4-pro`; early batches were labelled by hand, so the same model can appear
under several spellings. The exact numbers for a revision are on the dataset card. Only models
whose terms are compatible with the data license are used — why that rules some providers out
is recorded in [`DATA_LICENSE.md`](../DATA_LICENSE.md#provenance).

Meanings link to other headwords as **synonyms and antonyms** (~509k and ~183k links in the
`v0.1.0` revision, counted in `manifest.json` as `synonym_links` / `antonym_links`); the API
serves them under every entry and as `/words/{word}/synonyms` / `/antonyms`, and the dataset
carries them in the `meanings` file (earlier datasets nested the meanings in the `words`,
`phrases` and `grammar-patterns` lines).

> [!IMPORTANT]
> **Tell your readers.** The terms of the generating models ask that end users know the text is
> AI-generated and may be wrong. `GET /api/v1/meta` carries the line to show as `notice`, the
> word pages of the website show it next to the license note, and so does the dataset card.

> [!NOTE]
> **Human review** so far is spot-checking and targeted fixes through the admin UI; there is no
> systematic reviewed subset yet, so treat every entry as machine-generated. A review pass over
> the A1–B2 vocabulary is on the roadmap.

## Known limitations

- **Not a lexicographic authority.** Definitions, examples, CEFR levels, register and domain
  labels are model judgements. Hallucinated senses and invented examples are possible; do not
  use the data as ground truth for evaluating other dictionaries or as a citable source of
  English usage.
- **Translations are generated too** and have not been reviewed by a translator. The schema
  carries seven translation languages, Russian, Spanish, French, German, Portuguese, Chinese and
  Arabic (`GET /api/v1/meta` lists them under `available_languages`). The published dataset
  ships all seven since the tagged `v0.2.0` revision (`v0.1.0` holds the first five), one file
  per language, and `manifest.json` counts the rows per language (`translations`) — the dataset
  card gives the coverage of each. Translations ship in files of their own, one per language
  (`meaning-translations.<lang>`, `short-translations.<lang>`, [offline-import.md](./offline-import.md#dataset-format)), so a language
  can be loaded on its own into an instance that already has the entries.
- **Entry-level `language_register` is unreliable on words** — almost every word says `formal`
  because the field defaulted that way during generation. The per-sense register inside
  `meanings` is the meaningful one.
- **No frequency data.** CEFR levels are model judgements, not corpus-derived; there is no
  frequency ranking or attestation.
- **`""` means "not set"** for every enum field (level, transitivity, phrasal object pattern).
- **Offensive vocabulary is included** — the word list aims at broad coverage, so it contains
  slurs and vulgar and outdated terms, described rather than endorsed. Applications that surface
  random entries should filter on `language_register`, `is_obsolete` and their sense-level
  equivalents; a dedicated sensitivity flag does not exist yet.
- **Bias.** Model-generated text inherits the biases of the generating models, most visibly in
  which senses are listed first and in the connotations attached to social, political and
  religious vocabulary.

### Personal data

The published dataset of the project contains no personal information. The data of **an
instance** may come to hold one kind: the name a reader asked to be credited by for a
correction. It is taken only with an explicit consent on the form — the form says that the name
is shown next to the correction and travels with the copies of the dictionary data, and that a
published name cannot be taken back from the copies others have made. A report without a name
is as welcome. The name is stored with the report and, once the owner applies the correction,
in the history of the entry: shown on the word page, served by
`GET /api/v1/words/{word}/history` — and by
`GET /api/v1/words/{word}/datasets/{dataset}/history` for every dataset the instance holds,
active or not — written into the history file of an export.

On request the owner removes a name with _Take a name out of the history_ (Admin → _History_,
`POST /api/en/changes/forget-author`): it leaves the history and the reports of every dataset
of the instance, the corrections stay. Exports made before that still carry it — whoever
received one is asked separately.

## Datasets from other sources

An instance on PostgreSQL keeps several datasets, one of them active
([`datasets.md`](./datasets.md)). The datasets page of the admin UI installs a dataset of a
public source from the file the source distributes — the server converts it:

| Source                     | License of the data | What an entry has                                                                        | What it lacks                                     |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| English Wiktionary         | CC BY-SA 4.0        | definitions, examples, IPA, forms, synonyms and antonyms, translations as single words   | CEFR levels, definitions of the translated senses |
| Open English WordNet       | CC BY 4.0           | definitions, examples, synonyms and antonyms, irregular plurals and degrees              | translations, levels, registers, verb forms       |
| Princeton WordNet 3.x      | WordNet license     | the same                                                                                 | the same                                          |
| CMU Pronouncing Dictionary | BSD 2-Clause        | pronunciations of American English for the WordNet entries, turned from ARPAbet into IPA | —                                                 |

Such data is written by people, not generated: `generated` is false on every entry and the
notice about language models does not apply — a dataset carries the notice of its own source,
or none. The instance keeps it that way: an entry marked as generated is refused in a dataset
of a public source, by the forms, the API and the import alike. Three things follow from
keeping the sources apart:

- **A dataset has one source and one license.** Nothing of the project's dataset is added to a
  Wiktionary entry, no translation is borrowed from one dataset for another.
- **The license of the active dataset is the license of what the instance serves**: the API
  answers, the exports, the corrections the readers send. Wiktionary is share-alike — a product
  built on an instance that serves it keeps derived data under CC BY-SA 4.0.
- **Fields the source does not have stay empty** (`""` for the enums, as everywhere): no level
  is guessed, no register is assumed, an irregular verb of WordNet is flagged without forms
  because the source does not say which form is which.

## Edits made on an instance

The owner of an instance may edit any entry, and apply the corrections readers send. The
licenses of the datasets ask that such changes are indicated, so an instance keeps **a history
of edits** with every dataset: what was changed, with the values before and after. An entry
that was changed or added says so — `modified` on a word of the public API, a line on the word
page — and its history is public (`GET /api/v1/words/{word}/history`; for a dataset that is not
the served one, `GET /api/v1/words/{word}/datasets/{dataset}/history`). The history travels with
an export and is read by an import, so a copy of the data keeps the indication. How it works,
how a change is taken back:
[`datasets.md`](./datasets.md#editing-a-dataset-the-history-of-edits).

**If you use the data of an instance**, the indication is yours to keep: credit the source, say
of a changed entry that it was changed, keep it under the license of its dataset. What the
instance gives for that and what to do with it:
[`DATA_LICENSE.md`](../DATA_LICENSE.md#using-data-that-was-changed-on-an-instance).

## Dataset versions

Each published revision of the HuggingFace dataset carries its version in `manifest.json`
(`manifest.version`) and is **git-tagged with that version** on the dataset repository
(HF datasets are git repos; the publishing step ends with
`git tag <version> && git push origin <version>` there — `v0.1.0` is the first tagged
revision). The tags make revisions addressable:

- HF serves any revision via `resolve/<revision>/…`, and the server imports one with
  `POST /api/en/dictionary/import` `{ "source": { "kind": "huggingface", "revision": "<tag>" } }`
  — the admin import page offers the tags in a _Dataset version_ selector;
- `DICTIONARY_DATASET_VERSION=<tag>` pins the automatic first-start import
  ([environment.md](./environment.md)); unset means the moving `main`;
- the list of tags comes from the HF refs API
  (`https://huggingface.co/api/datasets/Fristail27/vocab-bloom-hub-en/refs`).

The dataset version is independent of the application version: it is bumped at the next
export after a release.

## Reporting errors

Fixes land in the Hub database, never in the published JSONL files (they are overwritten by the
next export):

- **A reader of a word page** has two flows right on the page, both landing in
  that instance's own moderation queue (`POST /api/v1/suggestions` — no account, strictly
  rate-limited): _Report a mistake_ opens one form with two modes — a free-text report, or
  the whole entry opened in editable fields to **suggest corrected values** — the admin sees the
  before/after diff on the _Suggestions_ page and applies it in one click (the change goes
  through the normal edit flow: it is recorded in the history of the dataset as a correction of
  a reader, and the entry is marked as the owner's). A reader who wants to be credited gives a
  name and agrees to have it published ([Personal data](#personal-data)). The loop
  stays inside the instance deliberately: its dictionary may hold the owner's edits the
  published dataset does not have. An applied correction is dictionary data like the rest and
  takes the license of the dataset it corrects — CC BY 4.0 for the project's own, the license
  of the source for another; the form names it.
- **Against the published dataset itself** (a wrong definition, translation, level or missing
  word in what HuggingFace serves) →
  [open an issue](https://github.com/Fristail27/vocab-bloom-hub/issues) with the bug template,
  quoting the headword, the field and what it should be.
- On your own instance, fix it in the admin UI (which marks the entry as yours and keeps it
  through dataset updates, see
  [`operations.md`](./operations.md#dataset-updates-vs-code-updates)) and re-export.

## Where the terms are exposed

| Place                           | What it carries                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest.json` of every export | `source`, `license`, `license_url`, `attribution`, `attribution_url`, `notice`; `modified_entries` when the data was edited                                  |
| `LICENSE` of every export       | The license and the notices of the source in full                                                                                                            |
| `GET /api/v1/meta`              | `dataset`, `source`, `license`, `license_url`, `attribution`, `attribution_url`, `notice`, `license_text`, `modified_entries` ([`api.md`](api.md))           |
| Every word of `/api/v1`         | `source`, and `modified` when the entry was changed or added on the instance — on the parts of an entry, in the searches and on the edits of the history too |
| Word pages of the website       | The license and the attribution of the dataset under every entry and next to _Report a mistake_; what was changed on the site                                |
| `/dataset-terms` of the website | The terms of the active dataset, with the notices of its source in full                                                                                      |
| Admin → _Datasets_              | The terms of every dataset of the catalog, as the code states them                                                                                           |
| Admin → _Export dictionary_     | License, link and attribution line next to the download                                                                                                      |
| HuggingFace dataset card        | `license: cc-by-4.0` front matter, `LICENSE`, `NOTICE`, this notice (the project's dataset)                                                                  |

All of them but the dataset card carry the terms of the **active dataset**, and those are the
ones the catalog of the code states for it (`apps/server/core/constants/dataset_catalog.ts`;
`DATA_LICENSE` of `data_license.ts` for the project's own dataset). Nothing about the terms is
typed by an admin or taken from an imported file.
