import type { PublicChangeV1T } from 'server/types';

import {
  changedFields,
  changesOfEntry,
  isNamedField,
  recordLanguage,
  recordName,
  valueText,
} from '../wordHistory';

const change = (over: Partial<PublicChangeV1T>): PublicChangeV1T =>
  ({
    created_at: '2026-09-27T10:00:00.000Z',
    word: 'test',
    part_of_speech: 'noun',
    entity: 'word',
    action: 'update',
    record: null,
    diff: {},
    origin: 'admin',
    author: null,
    ...over,
  }) as PublicChangeV1T;

// The history of a headword on its page (issue #531)
describe('the history of a headword', () => {
  it('reads a value as text, and nothing as nothing', () => {
    expect(valueText('a device')).toBe('a device');
    expect(valueText(['light', 'torch'])).toBe('light, torch');
    expect(valueText(2)).toBe('2');
    expect(valueText(true)).toBe('✓');
    expect(valueText({ a: 1 })).toBe('{"a":1}');
    for (const nothing of [null, undefined, '', false, []]) expect(valueText(nothing)).toBeNull();
  });

  it('lists the fields of an edit with the values before and after', () => {
    expect(
      changedFields(
        change({
          diff: {
            description: { before: 'the word lamp', after: 'a device that gives light' },
            transcription: { before: '', after: '/læmp/' },
            synonyms: { before: ['light'], after: [] },
            // says the same before and after: nothing to show
            is_obsolete: { before: null, after: false },
          },
        }),
      ),
    ).toEqual([
      { field: 'description', before: 'the word lamp', after: 'a device that gives light' },
      { field: 'transcription', before: null, after: '/læmp/' },
      { field: 'synonyms', before: 'light', after: null },
    ]);
  });

  it('names a record that was added or deleted instead of listing what it says', () => {
    const diff = { title: { before: null, after: 'a light' } };
    expect(changedFields(change({ action: 'create', diff } as never))).toEqual([]);
    expect(changedFields(change({ action: 'delete', diff } as never))).toEqual([]);
  });

  it('names a record by what it says', () => {
    expect(recordName(null)).toBeNull();
    expect(recordName({ word: 'mice', form_of_word: 'plural_form' })).toBe('mice');
    expect(recordName({ title: 'a light', sort_order: 1 })).toBe('a light');
    expect(recordName({ meaning: { title: 'a light', sort_order: 1 }, language: 'ru', title: 'лампа' })).toBe(
      'a light → лампа',
    );
    expect(recordName({ language: 'es', description: 'lámpara' })).toBe('lámpara');
    expect(recordLanguage({ language: 'es', description: 'lámpara' })).toBe('es');
    expect(recordLanguage({ title: 'a light', sort_order: 1 })).toBeNull();
  });

  it('gives every entry the edits that are its own', () => {
    const noun = change({ diff: { description: { before: 'a', after: 'b' } } });
    const verb = change({ part_of_speech: 'verb' });
    const cricket = change({ word: 'Test' });
    const whole = change({ part_of_speech: null });
    const all = [noun, verb, cricket, whole];

    expect(changesOfEntry(all, { word: 'test', part_of_speech: 'noun' })).toEqual([noun, whole]);
    expect(changesOfEntry(all, { word: 'test', part_of_speech: 'verb' })).toEqual([verb, whole]);
    // "Test" is another word: the edits of "test" are not its own
    expect(changesOfEntry(all, { word: 'Test', part_of_speech: 'noun' })).toEqual([cricket]);
    expect(changesOfEntry(all, { word: 'test', part_of_speech: 'adjective' })).toEqual([whole]);
  });

  it('knows the fields the page has a name for', () => {
    expect(isNamedField('definition')).toBe(true);
    expect(isNamedField('verb___is_irregular')).toBe(false);
  });
});
