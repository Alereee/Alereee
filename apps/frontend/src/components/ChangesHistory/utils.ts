import { ChangeDiffT, ChangeRecordT } from 'server/types';

const MAX_LENGTH = 80;

/** Whether a value says nothing: no value, an empty text, an empty list, a flag that is not set */
export const saysNothing = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  value === false ||
  (Array.isArray(value) && value.length === 0);

/** A value of the history the way a table cell holds it */
export const shortValue = (value: unknown): string => {
  if (saysNothing(value)) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 3)}…` : text;
};

export const fullValue = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/** The fields of a change worth a line: a creation lists every field of the record, most of them empty */
export const shownFields = (diff: ChangeDiffT): Array<[string, { before: unknown; after: unknown }]> =>
  Object.entries(diff).filter(([, { before, after }]) => !(saysNothing(before) && saysNothing(after)));

/** What names the record of a change inside its entry: the form, the title of the meaning, the translation */
export const recordName = (record: ChangeRecordT | null): string | null => {
  if (!record) return null;
  if ('form_of_word' in record) return record.word;
  if ('meaning' in record) return `${record.meaning.title} · ${record.language} · ${record.title}`;
  if ('description' in record) return `${record.language} · ${record.description}`;
  return record.title;
};
