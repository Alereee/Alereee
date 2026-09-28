import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { LICENSE_FILE_NAME } from '../../core/constants/dataset_catalog';
import * as path from 'node:path';
import { once } from 'node:events';
import {
  AvailableTranslationLanguagesE,
  DatasetManifestT,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  ManifestProvenanceT,
} from '../../types';
import {
  DataSetMeaningT,
  DataSetMeaningTranslationT,
  DataSetPhraseT,
  DataSetShortTranslationT,
  DataSetWordT,
} from '../../types/dictionaries/en/EnDataSetTypes';
import {
  DATASET_FILE_NAMES,
  MANIFEST_FILE_NAME,
  translationFileName,
} from '../modules/EnModule/modules/EnImportDictionary/constants';
import { mergeEntries, titleOf } from './normalize';
import { ConvertedEntryT, HEADWORD_MAX_LENGTH } from './types';

// how many translations of an entry's meanings make its short translation
const SHORT_TRANSLATION_WORDS = 6;

export type WriterOptionsT = {
  outDir: string;
  /** The text of the LICENSE file written next to the manifest: the terms and the notices of the source */
  license?: string | undefined;
  /** The version of the dataset that is written: the source's release, or the day of the conversion */
  version: string;
  provenance: Required<ManifestProvenanceT>;
};

export type WriterSummaryT = {
  entries: number;
  meanings: number;
  /** Records of a headword and part of speech that arrived after their entry was written */
  late_duplicates: number;
  manifest: DatasetManifestT;
};

const keyOf = (entry: { word: string; part_of_speech: string }): string =>
  `${entry.part_of_speech}\u0000${entry.word}`;

/**
 * Writes the dataset of the project's format (issue #527) — the files the
 * import reads and `manifest.json` with their line counts and the terms of
 * the source — from the entries an adapter emits. The records of one
 * headword follow each other in every source the adapters read, so the
 * writer holds the entries of the current headword, merges the ones that
 * share a part of speech and writes them when the headword changes.
 */
export class DatasetWriter {
  private readonly streams = new Map<string, WriteStream>();
  private readonly lines = new Map<string, number>();
  private readonly written = new Set<string>();
  private readonly phrasalVariants = new Map<string, Set<string>>();
  private readonly translations = new Map<
    string,
    { meaning_translations: number; short_translations: number }
  >();
  private pending = new Map<string, ConvertedEntryT>();
  private pendingWord: string | null = null;
  private entries = 0;
  private meanings = 0;
  private synonymLinks = 0;
  private antonymLinks = 0;
  private lateDuplicates = 0;

  constructor(private readonly options: WriterOptionsT) {}

  private async write(file: string, line: object): Promise<void> {
    let stream = this.streams.get(file);
    if (!stream) {
      await mkdir(this.options.outDir, { recursive: true });
      stream = createWriteStream(path.join(this.options.outDir, file), { encoding: 'utf-8' });
      this.streams.set(file, stream);
    }
    this.lines.set(file, (this.lines.get(file) ?? 0) + 1);
    if (!stream.write(`${JSON.stringify(line)}\n`)) await once(stream, 'drain');
  }

  private countTranslation(language: string, kind: 'meaning_translations' | 'short_translations'): void {
    const counts = this.translations.get(language) ?? { meaning_translations: 0, short_translations: 0 };
    counts[kind] += 1;
    this.translations.set(language, counts);
  }

  async add(entry: ConvertedEntryT): Promise<void> {
    if (!entry.word || entry.word.length > HEADWORD_MAX_LENGTH || entry.meanings.length === 0) return;
    if (entry.word !== this.pendingWord) {
      await this.flush();
      this.pendingWord = entry.word;
    }
    const key = keyOf(entry);
    if (this.written.has(key)) {
      this.lateDuplicates += 1;
      return;
    }
    const known = this.pending.get(key);
    this.pending.set(key, known ? mergeEntries(known, entry) : entry);
  }

  private async flush(): Promise<void> {
    const entries = [...this.pending.values()];
    this.pending = new Map();
    for (const entry of entries) await this.writeEntry(entry);
  }

  private async writeEntry(entry: ConvertedEntryT): Promise<void> {
    this.written.add(keyOf(entry));
    this.entries += 1;
    const { version } = this.options;
    const description = entry.meanings[0].definition;
    const shared = {
      categories: [...entry.categories].sort(),
      // converted from a source written by people: nothing here is generated
      generated: false,
      generated_by_model: '',
      transcription: entry.transcription,
      area_variant: entry.area_variant,
      description,
      language_register: entry.language_register,
      is_obsolete: entry.is_obsolete,
      version,
    };

    if (entry.part_of_speech === EnPartOfSpeechE.phrase) {
      const line: DataSetPhraseT = { ...shared, level: '', phrase: entry.word };
      await this.write(DATASET_FILE_NAMES.phrases, line);
    } else {
      const line: DataSetWordT = {
        ...shared,
        word: entry.word,
        part_of_speech: entry.part_of_speech,
        word_level: '',
        is_abbreviation: entry.is_abbreviation,
        noun___is_proper: entry.noun___is_proper,
        noun___uncountable: entry.noun___uncountable,
        noun___always_plural: entry.noun___always_plural,
        noun___irregular_plural: entry.noun___irregular_plural,
        verb___is_irregular: entry.verb___is_irregular,
        verb___is_phrasal: entry.verb___is_phrasal,
        verb___transitivity: entry.verb___transitivity,
        verb___phrasal_object_pattern: '',
        base_phrasal: entry.base_phrasal,
        // the variants of a base verb travel in the link map, written at the end
        phrasal_variants: [],
        forms: entry.forms.map((form) => ({
          word: form.word,
          form_of_word: form.form_of_word,
          area_variant: EnAreaVariantsE.common,
          transcription: '',
          is_obsolete: form.is_obsolete ?? false,
        })),
      };
      await this.write(DATASET_FILE_NAMES.words, line);
      if (entry.verb___is_phrasal && entry.base_phrasal) {
        const variants = this.phrasalVariants.get(entry.base_phrasal) ?? new Set<string>();
        variants.add(entry.word);
        this.phrasalVariants.set(entry.base_phrasal, variants);
      }
    }

    const wordKey = { word: entry.word, part_of_speech: entry.part_of_speech };
    const shortWords = new Map<AvailableTranslationLanguagesE, string[]>();
    for (const [index, meaning] of entry.meanings.entries()) {
      this.meanings += 1;
      const sortOrder = index + 1;
      const title = titleOf(meaning.definition);
      const link = (word: string) => ({ word, part_of_speech: entry.part_of_speech });
      const line: DataSetMeaningT = {
        ...wordKey,
        title,
        definition: meaning.definition,
        sort_order: sortOrder,
        examples: meaning.examples,
        is_obsolete: meaning.is_obsolete,
        area_variant: meaning.area_variant,
        meaning_level: '',
        language_register: meaning.language_register,
        categories: [...meaning.categories].sort(),
        synonyms: meaning.synonyms.map(link),
        antonyms: meaning.antonyms.map(link),
      };
      this.synonymLinks += meaning.synonyms.length;
      this.antonymLinks += meaning.antonyms.length;
      await this.write(DATASET_FILE_NAMES.meanings, line);

      for (const translation of meaning.translations) {
        if (translation.words.length === 0) continue;
        const translated: DataSetMeaningTranslationT = {
          ...wordKey,
          meaning_sort_order: sortOrder,
          meaning_title: title,
          language: translation.language,
          title: translation.words[0],
          definition: '',
          variants_of_words: translation.words,
        };
        await this.write(translationFileName('meaningTranslations', translation.language), translated);
        this.countTranslation(translation.language, 'meaning_translations');
        const known = shortWords.get(translation.language) ?? [];
        if (!known.includes(translation.words[0])) known.push(translation.words[0]);
        shortWords.set(translation.language, known);
      }
    }

    // the translation of the entry as a whole: the main words of its meanings, in their order
    for (const [language, words] of shortWords) {
      const kept = words.slice(0, SHORT_TRANSLATION_WORDS);
      const line: DataSetShortTranslationT = {
        ...wordKey,
        language,
        description: kept.join(', '),
        variants_of_words: kept,
      };
      await this.write(translationFileName('shortTranslations', language), line);
      this.countTranslation(language, 'short_translations');
    }
  }

  /** Writes what is pending, the link map of the phrasal verbs and the manifest; closes the files */
  async close(): Promise<WriterSummaryT> {
    await this.flush();
    for (const [base, variants] of this.phrasalVariants) {
      // a base verb the source has no entry for cannot carry its variants
      if (!this.written.has(keyOf({ word: base, part_of_speech: EnPartOfSpeechE.verb }))) continue;
      await this.write(DATASET_FILE_NAMES.phrasalVerbs, {
        word: base,
        part_of_speech: EnPartOfSpeechE.verb,
        phrasal_variants: [...variants].sort(),
      });
    }
    await Promise.all(
      [...this.streams.values()].map(
        (stream) =>
          new Promise<void>((resolve, reject) => {
            stream.on('error', reject);
            stream.end(resolve);
          }),
      ),
    );

    const manifest: DatasetManifestT = {
      version: this.options.version,
      generatedAt: new Date().toISOString(),
      ...this.options.provenance,
      synonym_links: this.synonymLinks,
      antonym_links: this.antonymLinks,
      translations: Object.fromEntries([...this.translations.entries()].sort(([a], [b]) => a.localeCompare(b))),
      files: Object.fromEntries(
        [...this.lines.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, lines]) => [file, { lines }]),
      ),
    };
    await mkdir(this.options.outDir, { recursive: true });
    await writeFile(
      path.join(this.options.outDir, MANIFEST_FILE_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8',
    );
    if (this.options.license) {
      await writeFile(path.join(this.options.outDir, LICENSE_FILE_NAME), this.options.license, 'utf-8');
    }
    return { entries: this.entries, meanings: this.meanings, late_duplicates: this.lateDuplicates, manifest };
  }
}
