import '../../../__tests__/helpers/clearDatabaseUrl';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EnEntry } from '../../../entities/en_entry.entity';
import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnMeaning } from '../../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../../entities/en_meaning_translation.entity';
import { EnMeaningService } from '../enMeaning.service';
import { EnMeaningTranslationService } from '../../EnMeaningTranslation/enMeaningTranslation.service';
import { AddMeaningReqDTO } from '../dto/AddMeaningReq.dto';
import { ErrorCodes } from '../../../../../../core/constants/error_codes';
import {
  AvailableTranslationLanguagesE,
  CategoryE,
  EnAreaVariantsE,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
  LanguageRegisterE,
  WordLevelE,
} from '../../../../../../types';

describe('EnMeaningService (issue #87)', () => {
  let ds: DataSource;
  let service: EnMeaningService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
      // mirrors AppModule: cascade deletes rely on this pragma
      prepareDatabase: (db) => {
        db.pragma('foreign_keys = ON');
      },
    });
    await ds.initialize();

    const meaningTranslationService = new EnMeaningTranslationService(
      ds.getRepository(EnMeaning),
      ds.getRepository(EnMeaningTranslation),
    );
    service = new EnMeaningService(
      ds.getRepository(EnWord),
      ds.getRepository(EnMeaning),
      meaningTranslationService,
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.synchronize(true);
  });

  const addWordRow = async (word = 'run'): Promise<EnWord> => {
    const entry = await ds.getRepository(EnEntry).save({ word, type: EnEntryTypesE.word });
    return ds.getRepository(EnWord).save({
      word: entry,
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
    });
  };

  const makeAddBody = (word_id: number, extra: Partial<AddMeaningReqDTO> = {}): AddMeaningReqDTO =>
    ({
      word_id,
      title: 'to move fast',
      definition: 'to move fast on foot',
      examples: ['I run every morning'],
      sort_order: 1,
      is_obsolete: false,
      meaning_level: WordLevelE.A1,
      area_variant: EnAreaVariantsE.common,
      language_register: LanguageRegisterE.informal,
      categories: [CategoryE.sport],
      translations: [],
      ...extra,
    }) as AddMeaningReqDTO;

  // AddMeaningResT is a union with ErrorResT; the service throws instead of returning error objects
  const addedId = (res: Awaited<ReturnType<EnMeaningService['addMeaning']>>): number =>
    (res as { id: number }).id;

  describe('addMeaning', () => {
    it('creates a meaning attached to the word and returns its id', async () => {
      const word = await addWordRow();

      const res = await service.addMeaning(makeAddBody(word.id));

      expect(res).toEqual({ success: true, id: expect.any(Number) });
      const saved = await ds.getRepository(EnMeaning).findOneOrFail({
        where: { id: addedId(res) },
        relations: { word: true },
      });
      expect(saved.word.id).toBe(word.id);
      expect(saved.title).toBe('to move fast');
      expect(saved.examples).toEqual(['I run every morning']);
      expect(saved.categories).toEqual([CategoryE.sport]);
      expect(saved.language_register).toBe(LanguageRegisterE.informal);
    });

    it('creates the nested translations through the translation service', async () => {
      const word = await addWordRow();

      const res = await service.addMeaning(
        makeAddBody(word.id, {
          translations: [
            {
              language: AvailableTranslationLanguagesE.ru,
              title: 'бежать',
              definition: 'быстро перемещаться',
              variants_of_words: ['бежать'],
            },
          ] as AddMeaningReqDTO['translations'],
        }),
      );

      const translations = await ds.getRepository(EnMeaningTranslation).find({
        relations: { meaning: true },
      });
      expect(translations).toHaveLength(1);
      expect(translations[0].meaning.id).toBe(addedId(res));
      expect(translations[0].title).toBe('бежать');
    });

    it('throws NotFoundException for a missing word and creates nothing', async () => {
      await expect(service.addMeaning(makeAddBody(9999))).rejects.toThrow(NotFoundException);

      expect(await ds.getRepository(EnMeaning).count()).toBe(0);
    });
  });

  describe('editMeaning', () => {
    it('updates the changed fields', async () => {
      const word = await addWordRow();
      const id = addedId(await service.addMeaning(makeAddBody(word.id)));

      const res = await service.editMeaning({
        id,
        title: 'to jog',
        definition: 'to run at a slow pace',
        sort_order: 2,
        meaning_level: WordLevelE.B2,
        area_variant: EnAreaVariantsE.british,
        examples: ['He jogs daily'],
        categories: [CategoryE.medical],
      });

      expect(res).toEqual({ success: true });
      const updated = await ds.getRepository(EnMeaning).findOneByOrFail({ id });
      expect(updated.title).toBe('to jog');
      expect(updated.definition).toBe('to run at a slow pace');
      expect(updated.sort_order).toBe(2);
      expect(updated.meaning_level).toBe(WordLevelE.B2);
      expect(updated.area_variant).toBe(EnAreaVariantsE.british);
      expect(updated.examples).toEqual(['He jogs daily']);
      expect(updated.categories).toEqual([CategoryE.medical]);
    });

    it('keeps the stored language_register when the field is omitted and clears it on explicit null', async () => {
      const word = await addWordRow();
      const id = addedId(await service.addMeaning(makeAddBody(word.id)));

      await service.editMeaning({ id, title: 'to sprint' });
      expect((await ds.getRepository(EnMeaning).findOneByOrFail({ id })).language_register).toBe(
        LanguageRegisterE.informal,
      );

      await service.editMeaning({ id, language_register: null });
      expect((await ds.getRepository(EnMeaning).findOneByOrFail({ id })).language_register).toBeNull();
    });

    it('updates examples even when the stored row has examples = NULL', async () => {
      const word = await addWordRow();
      const meaning = await ds.getRepository(EnMeaning).save({
        word,
        title: 'imported meaning',
        definition: 'imported without examples',
        sort_order: 1,
        examples: null as unknown as string[],
      });

      await service.editMeaning({ id: meaning.id, examples: ['brand new example'] });

      const updated = await ds.getRepository(EnMeaning).findOneByOrFail({ id: meaning.id });
      expect(updated.examples).toEqual(['brand new example']);
    });

    it('throws NotFoundException for a missing meaning', async () => {
      await expect(service.editMeaning({ id: 9999, title: 'nope' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('synonyms (issue #259)', () => {
    const junctionRows = async () =>
      ds
        .getRepository(EnMeaning)
        .find({ relations: { synonyms: true } })
        .then((rows) => rows.flatMap((m) => m.synonyms.map((e) => e.word).sort()));

    it('links the meaning to the existing entries and stores them normalized', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');
      await addWordRow('dash');

      const res = await service.addMeaning(
        makeAddBody(word.id, { synonyms: [' Sprint ', 'dash', 'sprint', 'RUN', ''] }),
      );

      const saved = await ds.getRepository(EnMeaning).findOneOrFail({
        where: { id: addedId(res) },
        relations: { synonyms: true },
      });
      // trimmed + lowercase + unique, without the headword itself, sorted
      expect(saved.synonyms.map((e) => e.word).sort()).toEqual(['dash', 'sprint']);
    });

    it('accepts a meaning without synonyms', async () => {
      const word = await addWordRow();
      const res = await service.addMeaning(makeAddBody(word.id));
      const saved = await ds.getRepository(EnMeaning).findOneOrFail({
        where: { id: addedId(res) },
        relations: { synonyms: true },
      });
      expect(saved.synonyms).toEqual([]);
    });

    it('rejects synonyms missing from the dictionary and creates nothing', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');

      await expect(
        service.addMeaning(makeAddBody(word.id, { synonyms: ['sprint', 'teleport'] })),
      ).rejects.toThrow(BadRequestException);

      expect(await ds.getRepository(EnMeaning).count()).toBe(0);
    });

    it('rejects an inflected form that exists only as a form entry', async () => {
      const word = await addWordRow('run');
      const sprint = await addWordRow('sprint');
      // "sprinted" has an entry row, but only as the past simple of "sprint"
      const formEntry = await ds.getRepository(EnEntry).save({ word: 'sprinted', type: EnEntryTypesE.word });
      await ds.getRepository(EnWord).save({
        word: formEntry,
        part_of_speech: EnPartOfSpeechE.verb,
        form_of_word: EnWordFormsE.past_simple,
        base_form: sprint,
      });

      await expect(service.addMeaning(makeAddBody(word.id, { synonyms: ['sprinted'] }))).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.addMeaning(makeAddBody(word.id, { synonyms: ['sprint'] }))).resolves.toMatchObject({
        success: true,
      });
    });

    it('resolves spelling variants to the dictionary headword and stores that spelling', async () => {
      const word = await addWordRow('run');
      await addWordRow('absentminded');
      await addWordRow('about turn');
      await addWordRow('add-in');
      await addWordRow('sprint');

      const res = await service.addMeaning(
        makeAddBody(word.id, {
          // hyphen dropped, hyphen -> space, space -> hyphen, article dropped, exact + variant of one word
          synonyms: ['absent-minded', 'about-turn', 'add in', 'the sprint', 'sprint', 'to run'],
        }),
      );

      expect(await junctionRows()).toEqual(['about turn', 'absentminded', 'add-in', 'sprint']);
      expect(res).toMatchObject({ success: true });
    });

    it('never drops a particle to find a match', async () => {
      const word = await addWordRow('run');
      await addWordRow('put up');

      await expect(service.addMeaning(makeAddBody(word.id, { synonyms: ['put up with'] }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('replaces the whole synonym set on edit and leaves it untouched when omitted', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');
      await addWordRow('dash');
      await addWordRow('jog');
      const id = addedId(await service.addMeaning(makeAddBody(word.id, { synonyms: ['sprint', 'dash'] })));

      await service.editMeaning({ id, title: 'to move quickly' });
      expect(await junctionRows()).toEqual(['dash', 'sprint']);

      await service.editMeaning({ id, synonyms: ['jog', 'dash', 'run'] });
      expect(await junctionRows()).toEqual(['dash', 'jog']);

      await service.editMeaning({ id, synonyms: [] });
      expect(await junctionRows()).toEqual([]);
    });

    it('rejects an edit naming an unknown synonym and keeps the stored links', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');
      const id = addedId(await service.addMeaning(makeAddBody(word.id, { synonyms: ['sprint'] })));

      await expect(service.editMeaning({ id, synonyms: ['teleport'] })).rejects.toThrow(BadRequestException);
      expect(await junctionRows()).toEqual(['sprint']);
    });

    it('drops the links when the synonym word or the meaning is deleted', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');
      const id = addedId(await service.addMeaning(makeAddBody(word.id, { synonyms: ['sprint'] })));

      // removing the entry (cascade from its word rows) removes the junction row
      await ds.getRepository(EnEntry).delete({ word: 'sprint' });
      expect(await junctionRows()).toEqual([]);

      await addWordRow('dash');
      await service.editMeaning({ id, synonyms: ['dash'] });
      expect(await junctionRows()).toEqual(['dash']);
      await service.deleteMeaning(id);
      expect(await ds.getRepository(EnEntry).findOneBy({ word: 'dash' })).not.toBeNull();
      expect(await junctionRows()).toEqual([]);
    });
  });

  describe('antonyms (issue #266)', () => {
    const linkRows = async (kind: 'synonyms' | 'antonyms') =>
      ds
        .getRepository(EnMeaning)
        .find({ relations: { [kind]: true } })
        .then((rows) => rows.flatMap((m) => m[kind].map((e) => e.word).sort()));

    it('links antonyms to existing entries, normalized, next to the synonyms', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');
      await addWordRow('walk');
      await addWordRow('stand');

      const res = await service.addMeaning(
        makeAddBody(word.id, { synonyms: ['sprint'], antonyms: [' Walk ', 'stand', 'walk', 'RUN', ''] }),
      );

      const saved = await ds.getRepository(EnMeaning).findOneOrFail({
        where: { id: addedId(res) },
        relations: { synonyms: true, antonyms: true },
      });
      expect(saved.synonyms.map((e) => e.word)).toEqual(['sprint']);
      expect(saved.antonyms.map((e) => e.word).sort()).toEqual(['stand', 'walk']);
    });

    it('rejects antonyms missing from the dictionary with the antonym error code', async () => {
      const word = await addWordRow('run');

      await expect(service.addMeaning(makeAddBody(word.id, { antonyms: ['teleport'] }))).rejects.toThrow(
        new BadRequestException(ErrorCodes.antonym_doesnt_exist),
      );
      expect(await ds.getRepository(EnMeaning).count()).toBe(0);
    });

    it('rejects a word listed as both synonym and antonym, also through a spelling variant', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');
      await addWordRow('absentminded');

      await expect(
        service.addMeaning(makeAddBody(word.id, { synonyms: ['sprint'], antonyms: ['Sprint'] })),
      ).rejects.toThrow(new BadRequestException(ErrorCodes.synonym_antonym_conflict));
      await expect(
        service.addMeaning(makeAddBody(word.id, { synonyms: ['absentminded'], antonyms: ['absent-minded'] })),
      ).rejects.toThrow(new BadRequestException(ErrorCodes.synonym_antonym_conflict));
      expect(await ds.getRepository(EnMeaning).count()).toBe(0);
    });

    it('replaces the antonym set on edit, leaves it untouched when omitted and checks the conflict against stored links', async () => {
      const word = await addWordRow('run');
      await addWordRow('sprint');
      await addWordRow('walk');
      await addWordRow('stand');
      const id = addedId(
        await service.addMeaning(makeAddBody(word.id, { synonyms: ['sprint'], antonyms: ['walk'] })),
      );

      await service.editMeaning({ id, title: 'to move quickly' });
      expect(await linkRows('antonyms')).toEqual(['walk']);

      await service.editMeaning({ id, antonyms: ['stand', 'walk', 'run'] });
      expect(await linkRows('antonyms')).toEqual(['stand', 'walk']);
      expect(await linkRows('synonyms')).toEqual(['sprint']);

      // the stored synonym collides with the new antonym, and vice versa
      await expect(service.editMeaning({ id, antonyms: ['sprint'] })).rejects.toThrow(
        new BadRequestException(ErrorCodes.synonym_antonym_conflict),
      );
      await expect(service.editMeaning({ id, synonyms: ['walk'] })).rejects.toThrow(
        new BadRequestException(ErrorCodes.synonym_antonym_conflict),
      );
      expect(await linkRows('antonyms')).toEqual(['stand', 'walk']);
      expect(await linkRows('synonyms')).toEqual(['sprint']);

      // swapping both sides in one request is fine
      await service.editMeaning({ id, synonyms: ['walk'], antonyms: ['sprint'] });
      expect(await linkRows('synonyms')).toEqual(['walk']);
      expect(await linkRows('antonyms')).toEqual(['sprint']);

      await service.editMeaning({ id, antonyms: [] });
      expect(await linkRows('antonyms')).toEqual([]);
    });

    it('drops the antonym links when the word or the meaning is deleted', async () => {
      const word = await addWordRow('run');
      await addWordRow('walk');
      const id = addedId(await service.addMeaning(makeAddBody(word.id, { antonyms: ['walk'] })));

      await ds.getRepository(EnEntry).delete({ word: 'walk' });
      expect(await linkRows('antonyms')).toEqual([]);

      await addWordRow('stand');
      await service.editMeaning({ id, antonyms: ['stand'] });
      expect(await linkRows('antonyms')).toEqual(['stand']);
      await service.deleteMeaning(id);
      expect(await ds.getRepository(EnEntry).findOneBy({ word: 'stand' })).not.toBeNull();
      expect(await linkRows('antonyms')).toEqual([]);
    });
  });

  describe('deleteMeaning', () => {
    it('removes the meaning together with its translations', async () => {
      const word = await addWordRow();
      const id = addedId(
        await service.addMeaning(
          makeAddBody(word.id, {
            translations: [
              {
                language: AvailableTranslationLanguagesE.ru,
                title: 'бежать',
                definition: 'быстро перемещаться',
                variants_of_words: ['бежать'],
              },
            ] as AddMeaningReqDTO['translations'],
          }),
        ),
      );

      const res = await service.deleteMeaning(id);

      expect(res).toEqual({ success: true });
      expect(await ds.getRepository(EnMeaning).count()).toBe(0);
      // FK cascade wipes the orphaned translations
      expect(await ds.getRepository(EnMeaningTranslation).count()).toBe(0);
      // the word itself survives
      expect(await ds.getRepository(EnWord).count()).toBe(1);
    });

    it('reports success for a missing id (idempotent delete)', async () => {
      await expect(service.deleteMeaning(9999)).resolves.toEqual({ success: true });
    });
  });
});
