import '../../../__tests__/helpers/clearDatabaseUrl';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EnEntry } from '../../../entities/en_entry.entity';
import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnMeaning } from '../../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../../entities/en_meaning_translation.entity';
import { EnMeaningTranslationService } from '../enMeaningTranslation.service';
import {
  AvailableTranslationLanguagesE,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
} from '../../../../../../types';

describe('EnMeaningTranslationService (issue #87)', () => {
  let ds: DataSource;
  let service: EnMeaningTranslationService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();

    service = new EnMeaningTranslationService(
      ds.getRepository(EnMeaning),
      ds.getRepository(EnMeaningTranslation),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.synchronize(true);
  });

  const addMeaningRow = async (): Promise<EnMeaning> => {
    const entry = await ds.getRepository(EnEntry).save({ word: 'run', type: EnEntryTypesE.word });
    const word = await ds.getRepository(EnWord).save({
      word: entry,
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
    });
    return ds.getRepository(EnMeaning).save({
      word,
      title: 'to move fast',
      definition: 'to move fast on foot',
      sort_order: 1,
      examples: [],
    });
  };

  const makeAddBody = (meaning_id: number) => ({
    meaning_id,
    language: AvailableTranslationLanguagesE.ru,
    title: 'бежать',
    definition: 'быстро перемещаться',
    variants_of_words: ['бежать', 'бегать'],
  });

  // AddMeaningTranslationResT is a union with ErrorResT; the service throws instead of returning error objects
  const addedId = (res: Awaited<ReturnType<EnMeaningTranslationService['addMeaningTranslation']>>): number =>
    (res as { id: number }).id;

  describe('addMeaningTranslation', () => {
    it('creates a translation attached to the meaning and returns its id', async () => {
      const meaning = await addMeaningRow();

      const res = await service.addMeaningTranslation(makeAddBody(meaning.id));

      expect(res).toEqual({ success: true, id: expect.any(Number) });
      const saved = await ds.getRepository(EnMeaningTranslation).findOneOrFail({
        where: { id: addedId(res) },
        relations: { meaning: true },
      });
      expect(saved.meaning.id).toBe(meaning.id);
      expect(saved.title).toBe('бежать');
      expect(saved.language).toBe(AvailableTranslationLanguagesE.ru);
      expect(saved.variants_of_words).toEqual(['бежать', 'бегать']);
    });

    it('throws NotFoundException for a missing meaning and creates nothing', async () => {
      await expect(service.addMeaningTranslation(makeAddBody(9999))).rejects.toThrow(NotFoundException);

      expect(await ds.getRepository(EnMeaningTranslation).count()).toBe(0);
    });
  });

  describe('editMeaningTranslation', () => {
    it('updates the changed fields, mapping variant_of_words onto variants_of_words', async () => {
      const meaning = await addMeaningRow();
      const id = addedId(await service.addMeaningTranslation(makeAddBody(meaning.id)));

      const res = await service.editMeaningTranslation({
        id,
        title: 'мчаться',
        definition: 'нестись со всех ног',
        variant_of_words: ['мчаться'],
      });

      expect(res).toEqual({ success: true });
      const updated = await ds.getRepository(EnMeaningTranslation).findOneByOrFail({ id });
      expect(updated.title).toBe('мчаться');
      expect(updated.definition).toBe('нестись со всех ног');
      expect(updated.variants_of_words).toEqual(['мчаться']);
    });

    it('leaves omitted fields untouched', async () => {
      const meaning = await addMeaningRow();
      const id = addedId(await service.addMeaningTranslation(makeAddBody(meaning.id)));

      await service.editMeaningTranslation({ id, title: 'мчаться' });

      const updated = await ds.getRepository(EnMeaningTranslation).findOneByOrFail({ id });
      expect(updated.definition).toBe('быстро перемещаться');
      expect(updated.variants_of_words).toEqual(['бежать', 'бегать']);
    });

    it('throws NotFoundException for a missing translation', async () => {
      await expect(service.editMeaningTranslation({ id: 9999, title: 'nope' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteMeaningTranslation', () => {
    it('removes the translation and keeps the meaning', async () => {
      const meaning = await addMeaningRow();
      const id = addedId(await service.addMeaningTranslation(makeAddBody(meaning.id)));

      const res = await service.deleteMeaningTranslation(id);

      expect(res).toEqual({ success: true });
      expect(await ds.getRepository(EnMeaningTranslation).count()).toBe(0);
      expect(await ds.getRepository(EnMeaning).count()).toBe(1);
    });

    it('reports success for a missing id (idempotent delete)', async () => {
      await expect(service.deleteMeaningTranslation(9999)).resolves.toEqual({ success: true });
    });
  });
});
