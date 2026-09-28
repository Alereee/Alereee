import './helpers/clearDatabaseUrl';
import { WordRowsService } from '../word-rows.service';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { DICTIONARY_ENTITIES } from '../entities/dictionary-entities';
import { EnChange } from '../entities/en_change.entity';
import { EnEntry } from '../entities/en_entry.entity';
import { EnWord } from '../entities/en_word.entity';
import { EnMeaning } from '../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../entities/en_short_translation.entity';
import { EnService } from '../en.service';
import { EnShortTranslationService } from '../modules/EnShortTranslation/enShortTranslation.service';
import { EnMeaningService } from '../modules/EnMeaning/enMeaning.service';
import { EnMeaningTranslationService } from '../modules/EnMeaningTranslation/enMeaningTranslation.service';
import { withChangeSource } from '../utils/changes/context';
import {
  AvailableTranslationLanguagesE,
  ChangeOriginE,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnWordFormsE,
  LanguageRegisterE,
} from '../../../../types';
import { AddWordReqDTO } from '../dto/AddWordReq.dto';

// The history of edits (issue #531): every edit of the content leaves a row
// with the values it changed, named by what the record says — a license
// asks that a reader is told what differs from the source
describe('the history of edits', () => {
  let ds: DataSource;
  let words: EnService;
  let meanings: EnMeaningService;
  let translations: EnMeaningTranslationService;
  let shorts: EnShortTranslationService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();

    shorts = new EnShortTranslationService(ds.getRepository(EnWord), ds.getRepository(EnShortTranslation));
    translations = new EnMeaningTranslationService(
      ds.getRepository(EnMeaning),
      ds.getRepository(EnMeaningTranslation),
    );
    meanings = new EnMeaningService(ds.getRepository(EnWord), ds.getRepository(EnMeaning), translations);
    words = new EnService(ds.getRepository(EnWord), ds, shorts, meanings, new WordRowsService(ds));
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.synchronize(true);
  });

  // the add routes answer the id of what they made, or an error
  const idOf = (res: object): number => (res as { id: number }).id;
  const history = async (): Promise<EnChange[]> => ds.getRepository(EnChange).find({ order: { id: 'ASC' } });
  const last = async (): Promise<EnChange> => (await history()).at(-1) as EnChange;

  // an entry as an import leaves it: no history, not kept through updates
  const imported = async (word: string, pos = EnPartOfSpeechE.noun): Promise<EnWord> => {
    const entry = await ds.getRepository(EnEntry).save({ word });
    return ds.getRepository(EnWord).save({
      word: entry,
      part_of_speech: pos,
      form_of_word: EnWordFormsE.base_form,
      description: `the word ${word}`,
      generated: false,
    });
  };

  const lamp = (): AddWordReqDTO =>
    ({
      word: 'lamp',
      part_of_speech: EnPartOfSpeechE.noun,
      form_of_word: EnWordFormsE.base_form,
      description: 'a device that gives light',
      transcription: '/læmp/',
      forms: [{ word: 'lamps', form_of_word: EnWordFormsE.plural_form, area_variant: EnAreaVariantsE.common }],
      meanings: [
        {
          title: 'a light',
          definition: 'A device that gives light.',
          sort_order: 1,
          is_obsolete: false,
          examples: ['Turn on the lamp.'],
          area_variant: EnAreaVariantsE.common,
          translations: [
            {
              language: AvailableTranslationLanguagesE.ru,
              title: 'лампа',
              definition: 'Устройство, дающее свет.',
              variants_of_words: ['лампа'],
            },
          ],
        },
      ],
      short_translations: [
        { language: AvailableTranslationLanguagesE.ru, description: 'лампа', variants_of_words: ['лампа'] },
      ],
    }) as unknown as AddWordReqDTO;

  it('holds everything a word came with when it is created: one row, not one per part', async () => {
    await words.addWord(lamp());

    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        headword: 'lamp',
        part_of_speech: 'noun',
        entity: 'word',
        action: 'create',
        record: null,
        origin: 'admin',
        suggestion_id: null,
        author: null,
        superseded_at: null,
      }),
    );
    const diff = rows[0].diff!;
    expect(diff.description).toEqual({ before: null, after: 'a device that gives light' });
    expect(diff.transcription).toEqual({ before: null, after: '/læmp/' });
    expect(diff.forms.after).toEqual([expect.objectContaining({ word: 'lamps', form_of_word: 'plural_form' })]);
    expect(diff.meanings.after).toEqual([
      expect.objectContaining({
        title: 'a light',
        definition: 'A device that gives light.',
        examples: ['Turn on the lamp.'],
        translations: [expect.objectContaining({ language: 'ru', title: 'лампа' })],
      }),
    ]);
    expect(diff.short_translations.after).toEqual([
      expect.objectContaining({ language: 'ru', description: 'лампа' }),
    ]);
    // no id of this database is a part of the history
    expect(JSON.stringify(diff)).not.toMatch(/"id"|"createdAt"|"word_id"/);
    expect((await ds.getRepository(EnEntry).findOneByOrFail({ word: 'lamp' })).user_modified).toBe(true);
  });

  it('holds the values before and after an edit of the word, and only the fields that changed', async () => {
    const word = await imported('lamp');

    await words.editWord(word.id, { description: 'a device that produces light', is_obsolete: true });

    expect(await history()).toHaveLength(1);
    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'lamp',
        part_of_speech: 'noun',
        entity: 'word',
        action: 'update',
        record: null,
        diff: {
          description: { before: 'the word lamp', after: 'a device that produces light' },
          is_obsolete: { before: false, after: true },
          // the entry became the owner's version of it: the history keeps the one it had
          version: { before: word.version, after: 'custom_version' },
        },
      }),
    );

    // …once: the next edit finds the entry the owner's already
    await words.editWord(word.id, { description: 'a device that gives light' });
    expect((await last()).diff).toEqual({
      description: { before: 'a device that produces light', after: 'a device that gives light' },
    });
  });

  it('leaves nothing behind an edit that changed nothing: no row, and the entry still follows its dataset', async () => {
    const word = await imported('lamp');
    const flagged = async () =>
      (await ds.getRepository(EnEntry).findOneByOrFail({ word: 'lamp' })).user_modified;

    // a dialog saved as it was opened
    await words.editWord(word.id, { description: 'the word lamp' });

    expect(await history()).toEqual([]);
    expect(await flagged()).toBe(false);
    // …nor is the entry stamped as the owner's version of it
    const stored = async () => ds.getRepository(EnWord).findOneByOrFail({ id: word.id });
    expect((await stored()).version).toBe(word.version);

    // …and an edit that did change something keeps the entry through the updates
    await words.editWord(word.id, { description: 'a device that gives light' });
    expect(await history()).toHaveLength(1);
    expect(await flagged()).toBe(true);
    expect((await stored()).version).toBe('custom_version');
  });

  it('holds what a deleted word said', async () => {
    const created = await words.addWord(lamp());

    await words.deleteWord(idOf(created));

    const row = await last();
    expect(row).toEqual(
      expect.objectContaining({ headword: 'lamp', part_of_speech: 'noun', entity: 'word', action: 'delete' }),
    );
    expect(row.diff!.description).toEqual({ before: 'a device that gives light', after: null });
    expect(row.diff!.meanings.before).toEqual([
      expect.objectContaining({
        title: 'a light',
        translations: [expect.objectContaining({ title: 'лампа' })],
      }),
    ]);
    expect(row.diff!.forms.before).toEqual([expect.objectContaining({ word: 'lamps' })]);
  });

  it('files an edit of a form under the article of its base word, and names the form', async () => {
    const word = await imported('mouse');

    const added = await words.addWordForm({
      base_word_id: word.id,
      word: 'mice',
      form_of_word: EnWordFormsE.plural_form,
      area_variant: EnAreaVariantsE.common,
      transcription: '/maɪs/',
    });
    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'mouse',
        part_of_speech: 'noun',
        entity: 'word_form',
        action: 'create',
        record: { word: 'mice', form_of_word: 'plural_form' },
      }),
    );
    expect((await last()).diff!.transcription).toEqual({ before: null, after: '/maɪs/' });

    const formId = idOf(added);
    await words.editWordForm({ id: formId, word: 'mouses' });
    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'mouse',
        entity: 'word_form',
        action: 'update',
        // the form as it was called before the edit
        record: { word: 'mice', form_of_word: 'plural_form' },
        diff: { word: { before: 'mice', after: 'mouses' } },
      }),
    );

    await words.deleteWord(formId);
    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'mouse',
        entity: 'word_form',
        action: 'delete',
        record: { word: 'mouses', form_of_word: 'plural_form' },
      }),
    );
    expect((await last()).diff!.word).toEqual({ before: 'mouses', after: null });
    expect(await history()).toHaveLength(3);
  });

  it('holds a meaning with its translations when it is added and when it is deleted, and its fields when edited', async () => {
    const word = await imported('lamp');
    await imported('light');
    await imported('shade');

    const added = await meanings.addMeaning({
      word_id: word.id,
      title: 'a light',
      definition: 'A device that gives light.',
      sort_order: 1,
      is_obsolete: false,
      examples: [],
      area_variant: EnAreaVariantsE.common,
      synonyms: ['light'],
      translations: [
        {
          language: AvailableTranslationLanguagesE.de,
          title: 'Lampe',
          definition: '',
          variants_of_words: ['Lampe'],
        },
      ],
    } as never);
    // the translation is a part of the meaning that was added: one row
    expect(await history()).toHaveLength(1);
    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'lamp',
        part_of_speech: 'noun',
        entity: 'meaning',
        action: 'create',
        record: { title: 'a light', sort_order: 1 },
      }),
    );
    expect((await last()).diff!.synonyms).toEqual({ before: null, after: ['light'] });
    expect((await last()).diff!.translations.after).toEqual([
      expect.objectContaining({ language: 'de', title: 'Lampe' }),
    ]);

    await meanings.editMeaning({
      id: idOf(added),
      definition: 'A device that produces light, usually electric.',
      examples: ['The lamp went out.'],
      synonyms: [],
      antonyms: ['shade'],
    } as never);
    expect(await last()).toEqual(
      expect.objectContaining({
        entity: 'meaning',
        action: 'update',
        record: { title: 'a light', sort_order: 1 },
        diff: {
          definition: {
            before: 'A device that gives light.',
            after: 'A device that produces light, usually electric.',
          },
          examples: { before: [], after: ['The lamp went out.'] },
          synonyms: { before: ['light'], after: [] },
          antonyms: { before: [], after: ['shade'] },
        },
      }),
    );

    await meanings.deleteMeaning(idOf(added));
    const deleted = await last();
    expect(deleted).toEqual(expect.objectContaining({ entity: 'meaning', action: 'delete' }));
    expect(deleted.diff!.definition.before).toBe('A device that produces light, usually electric.');
    expect(deleted.diff!.translations.before).toEqual([expect.objectContaining({ title: 'Lampe' })]);
    expect(deleted.diff!.antonyms).toEqual({ before: ['shade'], after: null });
    expect(await history()).toHaveLength(3);
  });

  it('records what was changed and nothing else: a synonym added from the card leaves the register alone', async () => {
    const word = await imported('lamp');
    await imported('light');
    const added = await meanings.addMeaning({
      word_id: word.id,
      title: 'a light',
      definition: 'A device that gives light.',
      sort_order: 1,
      is_obsolete: false,
      examples: [],
      area_variant: EnAreaVariantsE.common,
      language_register: LanguageRegisterE.informal,
      translations: [],
    } as never);

    // the card sends the links alone
    await meanings.editMeaning({ id: idOf(added), synonyms: ['light'] } as never);

    expect((await last()).diff).toEqual({ synonyms: { before: [], after: ['light'] } });
    const stored = await ds.getRepository(EnMeaning).findOneByOrFail({ id: idOf(added) });
    expect(stored.language_register).toBe('informal');

    // the register is cleared when the body says so
    await meanings.editMeaning({ id: idOf(added), language_register: null } as never);
    expect((await last()).diff).toEqual({ language_register: { before: 'informal', after: null } });

    // a dialog saved as it was opened changes nothing and leaves no row
    const rows = (await history()).length;
    await meanings.editMeaning({
      id: idOf(added),
      title: 'a light',
      definition: 'A device that gives light.',
      sort_order: 1,
      examples: [],
      categories: [],
      language_register: null,
      area_variant: EnAreaVariantsE.common,
    } as never);
    expect(await history()).toHaveLength(rows);
  });

  it('names a translation by its meaning, its language and its title', async () => {
    const word = await imported('lamp');
    const meaning = await meanings.addMeaning({
      word_id: word.id,
      title: 'a light',
      definition: 'A device that gives light.',
      sort_order: 2,
      is_obsolete: false,
      examples: [],
      area_variant: EnAreaVariantsE.common,
      translations: [],
    } as never);

    const added = await translations.addMeaningTranslation({
      meaning_id: idOf(meaning),
      language: AvailableTranslationLanguagesE.ru,
      title: 'лампа',
      definition: 'Устройство, дающее свет.',
      variants_of_words: ['лампа'],
    } as never);
    const key = { meaning: { title: 'a light', sort_order: 2 }, language: 'ru', title: 'лампа' };
    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'lamp',
        part_of_speech: 'noun',
        entity: 'meaning_translation',
        action: 'create',
        record: key,
      }),
    );

    await translations.editMeaningTranslation({ id: idOf(added), title: 'светильник' } as never);
    expect(await last()).toEqual(
      expect.objectContaining({
        action: 'update',
        record: key,
        diff: { title: { before: 'лампа', after: 'светильник' } },
      }),
    );

    await translations.deleteMeaningTranslation(idOf(added));
    expect(await last()).toEqual(
      expect.objectContaining({
        action: 'delete',
        record: { ...key, title: 'светильник' },
      }),
    );
    expect((await last()).diff!.definition).toEqual({ before: 'Устройство, дающее свет.', after: null });
  });

  it('holds the short translations the same way', async () => {
    const word = await imported('lamp');

    const added = await shorts.addShortTranslation({
      word_id: word.id,
      language: AvailableTranslationLanguagesE.es,
      description: 'lámpara',
      variant_of_words: ['lámpara'],
    } as never);
    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'lamp',
        entity: 'short_translation',
        action: 'create',
        record: { language: 'es', description: 'lámpara' },
      }),
    );

    await shorts.editShortTranslation({ id: idOf(added), description: 'lámpara, farol' } as never);
    expect(await last()).toEqual(
      expect.objectContaining({
        action: 'update',
        record: { language: 'es', description: 'lámpara' },
        diff: { description: { before: 'lámpara', after: 'lámpara, farol' } },
      }),
    );

    await shorts.deleteShortTranslation(idOf(added));
    expect((await last()).diff!.variants_of_words).toEqual({ before: ['lámpara'], after: null });
  });

  it('names the base verb a phrasal verb was linked to', async () => {
    const give = await imported('give', EnPartOfSpeechE.verb);
    const giveUp = await imported('give up', EnPartOfSpeechE.verb);

    await words.editPhrasalBase({ id: giveUp.id, phrasal_base_id: give.id });

    expect(await last()).toEqual(
      expect.objectContaining({
        headword: 'give up',
        part_of_speech: 'verb',
        entity: 'word',
        action: 'update',
        diff: { base_phrasal: { before: null, after: 'give' } },
      }),
    );
  });

  it('says where an edit came from: a correction of a reader, with the one who sent it', async () => {
    const word = await imported('lamp');

    await withChangeSource({ origin: ChangeOriginE.suggestion, suggestion_id: 7, author: 'Ada' }, () =>
      words.editWord(word.id, { description: 'a device that produces light' }),
    );
    await words.editWord(word.id, { description: 'a lamp' });

    expect((await history()).map((row) => [row.origin, row.suggestion_id, row.author])).toEqual([
      ['suggestion', 7, 'Ada'],
      ['admin', null, null],
    ]);
  });

  it('takes the edit back with the history row when the edit fails', async () => {
    await imported('lamp');
    const dto = lamp();

    // the word exists: the transaction of the creation rolls back, and its row with it
    await expect(words.addWord(dto)).rejects.toThrow();

    expect(await history()).toEqual([]);
  });
});
