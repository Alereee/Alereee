import { ChangeDiffT, ChangeRecordT, EnAreaVariantsE } from '../../../../../types';
import { EnMeaning } from '../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../entities/en_short_translation.entity';
import { EnWord } from '../../entities/en_word.entity';

/**
 * What a record says, without what only this database knows about it
 * (issue #531): no ids, no timestamps, related words by their spelling. The
 * history is a part of the data — it is exported, shown to readers and read
 * on another instance — so a value must mean the same everywhere.
 */
export type SnapshotT = Record<string, unknown>;

const sorted = (values: readonly string[] | null | undefined): string[] => [...(values ?? [])].sort();
const kept = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

export const translationSnapshot = (translation: EnMeaningTranslation): SnapshotT => ({
  language: translation.language,
  title: kept(translation.title),
  definition: kept(translation.definition),
  variants_of_words: translation.variants_of_words ?? [],
});

export const shortTranslationSnapshot = (translation: EnShortTranslation): SnapshotT => ({
  language: translation.language,
  description: kept(translation.description),
  variants_of_words: translation.variants_of_words ?? [],
});

/** The meaning itself; its translations are records of their own and come with `withTranslations` */
export const meaningSnapshot = (meaning: EnMeaning, withTranslations = false): SnapshotT => ({
  title: kept(meaning.title),
  definition: kept(meaning.definition),
  sort_order: kept(meaning.sort_order),
  examples: meaning.examples ?? [],
  meaning_level: kept(meaning.meaning_level),
  language_register: kept(meaning.language_register),
  area_variant: kept(meaning.area_variant),
  is_obsolete: Boolean(meaning.is_obsolete),
  categories: sorted(meaning.categories),
  synonyms: sorted(meaning.synonyms?.map((entry) => entry.word)),
  antonyms: sorted(meaning.antonyms?.map((entry) => entry.word)),
  ...(withTranslations && {
    translations: [...(meaning.translations ?? [])]
      .map(translationSnapshot)
      .sort((a, b) =>
        `${String(a.language)} ${String(a.title)}`.localeCompare(`${String(b.language)} ${String(b.title)}`),
      ),
  }),
});

export const formSnapshot = (form: EnWord): SnapshotT => ({
  word: form.word.word,
  form_of_word: form.form_of_word,
  transcription: kept(form.transcription),
  area_variant: kept(form.area_variant),
  is_obsolete: Boolean(form.is_obsolete),
});

/** The fields of the article itself: what the card of a word edits as its common data */
export const wordSnapshot = (word: EnWord): SnapshotT => ({
  description: kept(word.description),
  transcription: kept(word.transcription),
  word_level: kept(word.word_level),
  area_variant: kept(word.area_variant),
  language_register: kept(word.language_register),
  categories: sorted(word.categories),
  is_obsolete: Boolean(word.is_obsolete),
  is_abbreviation: Boolean(word.is_abbreviation),
  pattern: word.pattern ?? null,
  generated: Boolean(word.generated),
  generated_by_model: kept(word.generated_by_model),
  noun___irregular_plural: kept(word.noun___irregular_plural),
  noun___uncountable: kept(word.noun___uncountable),
  noun___is_proper: kept(word.noun___is_proper),
  noun___always_plural: kept(word.noun___always_plural),
  verb___is_irregular: kept(word.verb___is_irregular),
  verb___transitivity: kept(word.verb___transitivity),
  verb___is_phrasal: kept(word.verb___is_phrasal),
  verb___phrasal_object_pattern: kept(word.verb___phrasal_object_pattern),
  base_phrasal: word.base_phrasal?.word?.word ?? null,
});

/**
 * The whole article — what a creation brought in and a deletion took out,
 * with the version it carried: an article that is brought back is the one
 * its dataset had
 */
export const articleSnapshot = (word: EnWord): SnapshotT => ({
  ...wordSnapshot(word),
  version: kept(word.version),
  forms: [...(word.forms ?? [])]
    .map(formSnapshot)
    .sort((a, b) =>
      `${String(a.form_of_word)} ${String(a.word)}`.localeCompare(
        `${String(b.form_of_word)} ${String(b.word)}`,
      ),
    ),
  meanings: [...(word.meanings ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((meaning) => meaningSnapshot(meaning, true)),
  short_translations: [...(word.short_translations ?? [])]
    .map(shortTranslationSnapshot)
    .sort((a, b) => String(a.language).localeCompare(String(b.language))),
});

// the keys of an object in one order: a value read back from the database
// (jsonb) does not keep the order it was written in
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(fields)
        .sort()
        .map((key) => [key, canonical(fields[key])]),
    );
  }
  return value ?? null;
};

/** Whether two values of a snapshot say the same */
export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Nothing, written in the ways it is written: a dataset file has an empty
// string where the database of the instance that made it had no value, a
// flag that is not set is written as `false`, and an import reads "no
// variant" as the common one
const said = (value: unknown, field?: string): unknown => {
  if (value === '' || value === undefined || value === false) return null;
  if (field === 'area_variant' && value === EnAreaVariantsE.common) return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.map((item) => said(item));
  if (value && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).map((key) => [key, said(fields[key], key)]));
  }
  return value;
};

/** Whether two values say the same to a reader: an empty text, an empty list, a flag not set and no value all say nothing */
export const saysTheSame = (a: unknown, b: unknown, field?: string): boolean =>
  sameValue(said(a, field), said(b, field));
const same = sameValue;

/** The fields whose value changed; null when none did */
export const changedFields = (before: SnapshotT, after: SnapshotT): ChangeDiffT | null => {
  const diff: ChangeDiffT = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!same(before[key], after[key])) diff[key] = { before: before[key] ?? null, after: after[key] ?? null };
  }
  return Object.keys(diff).length > 0 ? diff : null;
};

/** Every field of a record that came to be */
export const createdFields = (after: SnapshotT): ChangeDiffT =>
  Object.fromEntries(Object.entries(after).map(([key, value]) => [key, { before: null, after: value }]));

/** Every field of a record that is gone */
export const deletedFields = (before: SnapshotT): ChangeDiffT =>
  Object.fromEntries(Object.entries(before).map(([key, value]) => [key, { before: value, after: null }]));

// What names a record inside its article

export const formRecord = (form: EnWord): ChangeRecordT => ({
  word: form.word.word,
  form_of_word: form.form_of_word,
});

export const meaningRecord = (meaning: EnMeaning): ChangeRecordT => ({
  title: meaning.title ?? '',
  sort_order: meaning.sort_order ?? 0,
});

export const translationRecord = (translation: EnMeaningTranslation, meaning: EnMeaning): ChangeRecordT => ({
  meaning: { title: meaning.title ?? '', sort_order: meaning.sort_order ?? 0 },
  language: translation.language,
  title: translation.title ?? '',
});

export const shortTranslationRecord = (translation: EnShortTranslation): ChangeRecordT => ({
  language: translation.language,
  description: translation.description ?? '',
});
