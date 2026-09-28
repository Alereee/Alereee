import './helpers/clearDatabaseUrl';
import { WordRowsService } from '../word-rows.service';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EnEntry } from '../entities/en_entry.entity';
import { DICTIONARY_ENTITIES } from '../entities/dictionary-entities';
import { EnWord } from '../entities/en_word.entity';
import { EnMeaning } from '../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../entities/en_short_translation.entity';
import { EnService } from '../en.service';
import { EnShortTranslationService } from '../modules/EnShortTranslation/enShortTranslation.service';
import { EnMeaningService } from '../modules/EnMeaning/enMeaning.service';
import { EnMeaningTranslationService } from '../modules/EnMeaningTranslation/enMeaningTranslation.service';
import {
  CustomVersionDictionaryOfWord,
  EnAreaVariantsE,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
  WordLevelE,
} from '../../../../types';

describe('EnService word CRUD (issue #187)', () => {
  let ds: DataSource;
  let service: EnService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();

    const shortTranslationService = new EnShortTranslationService(
      ds.getRepository(EnWord),
      ds.getRepository(EnShortTranslation),
    );
    const meaningTranslationService = new EnMeaningTranslationService(
      ds.getRepository(EnMeaning),
      ds.getRepository(EnMeaningTranslation),
    );
    const meaningService = new EnMeaningService(
      ds.getRepository(EnWord),
      ds.getRepository(EnMeaning),
      meaningTranslationService,
    );

    service = new EnService(
      ds.getRepository(EnWord),
      ds,
      shortTranslationService,
      meaningService,
      new WordRowsService(ds),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.synchronize(true);
  });

  const addEntry = (word: string, type = EnEntryTypesE.word) => ds.getRepository(EnEntry).save({ word, type });

  const addWord = (
    entry: EnEntry,
    pos: EnPartOfSpeechE,
    formOfWord = EnWordFormsE.base_form,
    extra: Partial<EnWord> = {},
  ) =>
    ds.getRepository(EnWord).save({
      word: entry,
      part_of_speech: pos,
      form_of_word: formOfWord,
      ...extra,
    });

  describe('editWord', () => {
    it('updates changed fields and stamps the custom version', async () => {
      const entry = await addEntry('run');
      const word = await addWord(entry, EnPartOfSpeechE.verb);

      const res = await service.editWord(word.id, {
        description: 'to move fast on foot',
        word_level: WordLevelE.A1,
        verb___is_irregular: true,
      });

      expect(res).toEqual({ success: true });
      const updated = await ds.getRepository(EnWord).findOneByOrFail({ id: word.id });
      expect(updated.description).toBe('to move fast on foot');
      expect(updated.word_level).toBe(WordLevelE.A1);
      expect(updated.verb___is_irregular).toBe(true);
      expect(updated.version).toBe(CustomVersionDictionaryOfWord);
    });

    it('allows switching boolean flags back to false', async () => {
      const entry = await addEntry('run');
      const word = await addWord(entry, EnPartOfSpeechE.verb, EnWordFormsE.base_form, {
        verb___is_phrasal: true,
      });

      await service.editWord(word.id, { verb___is_phrasal: false });

      const updated = await ds.getRepository(EnWord).findOneByOrFail({ id: word.id });
      expect(updated.verb___is_phrasal).toBe(false);
    });

    it('throws NotFoundException for a missing word', async () => {
      await expect(service.editWord(9999, {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('addWordForm', () => {
    it('creates a form row reusing an existing entry', async () => {
      const entry = await addEntry('run');
      const base = await addWord(entry, EnPartOfSpeechE.verb);
      // the form spelling already exists as an unrelated entry
      await addEntry('ran');

      const res = await service.addWordForm({
        word: 'ran',
        form_of_word: EnWordFormsE.past_simple,
        transcription: 'ræn',
        area_variant: EnAreaVariantsE.common,
        base_word_id: base.id,
      });

      expect(res).toMatchObject({ success: true });
      const form = await ds.getRepository(EnWord).findOneOrFail({
        where: { id: (res as { id: number }).id },
        relations: { word: true, base_form: true },
      });
      expect(form.word.word).toBe('ran');
      expect(form.form_of_word).toBe(EnWordFormsE.past_simple);
      expect(form.part_of_speech).toBe(EnPartOfSpeechE.verb);
      expect(form.base_form?.id).toBe(base.id);
      // no duplicate entry was created
      expect(await ds.getRepository(EnEntry).count({ where: { word: 'ran' } })).toBe(1);
    });

    it('creates a new entry when the form spelling is not known yet', async () => {
      const entry = await addEntry('jump');
      const base = await addWord(entry, EnPartOfSpeechE.verb);

      await service.addWordForm({
        word: 'jumped',
        form_of_word: EnWordFormsE.past_simple,
        transcription: 'dʒʌmpt',
        area_variant: EnAreaVariantsE.common,
        base_word_id: base.id,
      });

      expect(await ds.getRepository(EnEntry).count({ where: { word: 'jumped' } })).toBe(1);
    });

    it('throws ConflictException when the same form already exists for the base word', async () => {
      const entry = await addEntry('run');
      const base = await addWord(entry, EnPartOfSpeechE.verb);
      const body = {
        word: 'ran',
        form_of_word: EnWordFormsE.past_simple,
        transcription: 'ræn',
        area_variant: EnAreaVariantsE.common,
        base_word_id: base.id,
      };
      await service.addWordForm(body);

      await expect(service.addWordForm(body)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for a missing base word', async () => {
      await expect(
        service.addWordForm({
          word: 'ran',
          form_of_word: EnWordFormsE.past_simple,
          transcription: 'ræn',
          area_variant: EnAreaVariantsE.common,
          base_word_id: 9999,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('editWordForm', () => {
    it('renames the form and deletes the orphaned old entry', async () => {
      const entry = await addEntry('runed');
      const form = await addWord(entry, EnPartOfSpeechE.verb, EnWordFormsE.past_simple);

      const res = await service.editWordForm({ id: form.id, word: 'ran' });

      expect(res).toEqual({ success: true });
      const updated = await ds.getRepository(EnWord).findOneOrFail({
        where: { id: form.id },
        relations: { word: true },
      });
      expect(updated.word.word).toBe('ran');
      // old misspelled entry is not referenced anymore — removed
      expect(await ds.getRepository(EnEntry).findOne({ where: { word: 'runed' } })).toBeNull();
      expect(await ds.getRepository(EnEntry).findOne({ where: { word: 'ran' } })).not.toBeNull();
    });

    it('keeps the old entry when another word still references it', async () => {
      const entry = await addEntry('run');
      await addWord(entry, EnPartOfSpeechE.noun);
      const form = await addWord(entry, EnPartOfSpeechE.verb, EnWordFormsE.past_simple);

      await service.editWordForm({ id: form.id, word: 'ran' });

      expect(await ds.getRepository(EnEntry).findOne({ where: { word: 'run' } })).not.toBeNull();
    });

    it('updates transcription and area variant', async () => {
      const entry = await addEntry('ran');
      const form = await addWord(entry, EnPartOfSpeechE.verb, EnWordFormsE.past_simple);

      await service.editWordForm({
        id: form.id,
        transcription: 'ræn',
        area_variant: EnAreaVariantsE.british,
      });

      const updated = await ds.getRepository(EnWord).findOneByOrFail({ id: form.id });
      expect(updated.transcription).toBe('ræn');
      expect(updated.area_variant).toBe(EnAreaVariantsE.british);
    });

    it('throws NotFoundException for a missing form', async () => {
      await expect(service.editWordForm({ id: 9999 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('editPhrasalBase', () => {
    it('links the word to the given phrasal base', async () => {
      const giveUpEntry = await addEntry('give up');
      const giveEntry = await addEntry('give');
      const giveUp = await addWord(giveUpEntry, EnPartOfSpeechE.verb);
      const give = await addWord(giveEntry, EnPartOfSpeechE.verb);

      const res = await service.editPhrasalBase({ id: giveUp.id, phrasal_base_id: give.id });

      expect(res).toEqual({ success: true });
      const updated = await ds.getRepository(EnWord).findOneOrFail({
        where: { id: giveUp.id },
        relations: { base_phrasal: true },
      });
      expect(updated.base_phrasal?.id).toBe(give.id);
    });

    it('throws NotFoundException when the word or the base is missing', async () => {
      const entry = await addEntry('give');
      const give = await addWord(entry, EnPartOfSpeechE.verb);

      await expect(service.editPhrasalBase({ id: 9999, phrasal_base_id: give.id })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.editPhrasalBase({ id: give.id, phrasal_base_id: 9999 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getWordById', () => {
    it('returns the word with prepared forms and relations', async () => {
      const runEntry = await addEntry('run');
      const ranEntry = await addEntry('ran');
      const base = await addWord(runEntry, EnPartOfSpeechE.verb);
      const form = await addWord(ranEntry, EnPartOfSpeechE.verb, EnWordFormsE.past_simple, {
        base_form: base,
      });

      const res = await service.getWordById(base.id);

      expect(res.word).toBe('run');
      expect(res.part_of_speech).toBe(EnPartOfSpeechE.verb);
      expect(res.forms).toEqual([
        {
          id: form.id,
          word: 'ran',
          form_of_word: EnWordFormsE.past_simple,
          // a form saved without a region reads as common (the form contract is non-null)
          area_variant: EnAreaVariantsE.common,
          transcription: null,
        },
      ]);
      // raw DB service fields must not leak into the API shape
      expect(res).not.toHaveProperty('createdAt');
      expect(res).not.toHaveProperty('updateAt');
    });

    it('throws NotFoundException for a missing id', async () => {
      await expect(service.getWordById(9999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkWord', () => {
    it('returns the id of an existing word and false for a missing one', async () => {
      const entry = await addEntry('run');
      const verb = await addWord(entry, EnPartOfSpeechE.verb);

      expect(await service.checkWord('run', EnPartOfSpeechE.verb, false)).toBe(verb.id);
      expect(await service.checkWord('run', EnPartOfSpeechE.noun, false)).toBe(false);
      expect(await service.checkWord('walk', EnPartOfSpeechE.verb, false)).toBe(false);
    });

    it('with forPhrasal=true skips verbs already marked or linked as phrasal', async () => {
      const giveEntry = await addEntry('give');
      const giveUpEntry = await addEntry('give up');
      const give = await addWord(giveEntry, EnPartOfSpeechE.verb);
      await addWord(giveUpEntry, EnPartOfSpeechE.verb, EnWordFormsE.base_form, {
        verb___is_phrasal: true,
        base_phrasal: give,
      });

      expect(await service.checkWord('give', EnPartOfSpeechE.verb, true)).toBe(give.id);
      expect(await service.checkWord('give up', EnPartOfSpeechE.verb, true)).toBe(false);
    });
  });
});
