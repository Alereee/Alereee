import type { ChangeRecordT, PublicChangeV1T } from 'server/types';

// The history of a headword as a reader is shown it (issue #531): what the
// owner of the site changed in what the source of the data says

/** The fields of the history the page has a name for in every language; the others are shown by their key */
export const NAMED_FIELDS = [
  'description',
  'transcription',
  'definition',
  'title',
  'examples',
  'synonyms',
  'antonyms',
  'word',
] as const;

export type NamedFieldT = (typeof NAMED_FIELDS)[number];

export const isNamedField = (field: string): field is NamedFieldT =>
  (NAMED_FIELDS as readonly string[]).includes(field);

const saysNothing = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  value === false ||
  (Array.isArray(value) && value.length === 0);

/** A value of the history as text; null when it says nothing */
export const valueText = (value: unknown): string | null => {
  if (saysNothing(value)) return null;
  if (value === true) return '✓';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(', ');
  return JSON.stringify(value);
};

export type ChangedFieldT = { field: string; before: string | null; after: string | null };

/**
 * The values a reader is shown: those of an edit of a record. A record that
 * was added or deleted is named, not listed field by field — what it says
 * is on the page, or is gone.
 */
export const changedFields = (change: PublicChangeV1T): ChangedFieldT[] => {
  if (change.action !== 'update') return [];
  return Object.entries(change.diff)
    .map(([field, { before, after }]) => ({ field, before: valueText(before), after: valueText(after) }))
    .filter(({ before, after }) => before !== after);
};

/** What names the record of a change inside its entry: the form, the title of the meaning, the translation */
export const recordName = (record: ChangeRecordT | null): string | null => {
  if (!record) return null;
  if ('form_of_word' in record) return record.word;
  if ('meaning' in record) return [record.meaning.title, record.title].filter(Boolean).join(' → ');
  if ('description' in record) return record.description;
  return record.title;
};

/**
 * The edits of one entry among the edits of its headword: a headword is
 * several entries — a noun and a verb, "Test" and "test" — and an edit
 * belongs to the one it names by its spelling and part of speech. An edit
 * that names no part of speech is about every entry of its spelling.
 */
export const changesOfEntry = (
  changes: readonly PublicChangeV1T[],
  entry: { word: string; part_of_speech: string },
): PublicChangeV1T[] =>
  changes.filter(
    (change) =>
      change.word === entry.word &&
      (change.part_of_speech === null || change.part_of_speech === entry.part_of_speech),
  );

/** The language of the translation a change is about, for its flag */
export const recordLanguage = (record: ChangeRecordT | null): string | null =>
  record && 'language' in record ? record.language : null;
