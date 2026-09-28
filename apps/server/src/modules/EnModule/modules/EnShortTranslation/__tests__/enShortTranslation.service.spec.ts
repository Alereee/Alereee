import '../../../__tests__/helpers/clearDatabaseUrl';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EnEntry } from '../../../entities/en_entry.entity';
import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnShortTranslation } from '../../../entities/en_short_translation.entity';
import { EnShortTranslationService } from '../enShortTranslation.service';
import {
  AvailableTranslationLanguagesE,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
} from '../../../../../../types';

describe('EnShortTranslationService (issue #87)', () => {
  let ds: DataSource;
  let service: EnShortTranslationService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();

    service = new EnShortTranslationService(ds.getRepository(EnWord), ds.getRepository(EnShortTranslation));
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

  const makeAddBody = (word_id: number) => ({
    word_id,
    language: AvailableTranslationLanguagesE.ru,
    description: 'бежать',
    variant_of_words: ['бежать', 'бегать'],
  });

  // AddShortTranslationResT is a union with ErrorResT; the service throws instead of returning error objects
  const addedId = (res: Awaited<ReturnType<EnShortTranslationService['addShortTranslation']>>): number =>
    (res as { id: number }).id;

  describe('addShortTranslation', () => {
    it('creates a short translation attached to the word, mapping variant_of_words onto variants_of_words', async () => {
      const word = await addWordRow();

      const res = await service.addShortTranslation(makeAddBody(word.id));

      expect(res).toEqual({ success: true, id: expect.any(Number) });
      const saved = await ds.getRepository(EnShortTranslation).findOneOrFail({
        where: { id: addedId(res) },
        relations: { word: true },
      });
      expect(saved.word.id).toBe(word.id);
      expect(saved.description).toBe('бежать');
      expect(saved.language).toBe(AvailableTranslationLanguagesE.ru);
      expect(saved.variants_of_words).toEqual(['бежать', 'бегать']);
    });

    it('throws NotFoundException for a missing word and creates nothing', async () => {
      await expect(service.addShortTranslation(makeAddBody(9999))).rejects.toThrow(NotFoundException);

      expect(await ds.getRepository(EnShortTranslation).count()).toBe(0);
    });
  });

  describe('editShortTranslation', () => {
    it('updates the changed fields', async () => {
      const word = await addWordRow();
      const id = addedId(await service.addShortTranslation(makeAddBody(word.id)));

      const res = await service.editShortTranslation({
        id,
        description: 'мчаться',
        variant_of_words: ['мчаться'],
      });

      expect(res).toEqual({ success: true });
      const updated = await ds.getRepository(EnShortTranslation).findOneByOrFail({ id });
      expect(updated.description).toBe('мчаться');
      expect(updated.variants_of_words).toEqual(['мчаться']);
    });

    it('leaves omitted fields untouched', async () => {
      const word = await addWordRow();
      const id = addedId(await service.addShortTranslation(makeAddBody(word.id)));

      await service.editShortTranslation({ id, description: 'мчаться' });

      const updated = await ds.getRepository(EnShortTranslation).findOneByOrFail({ id });
      expect(updated.language).toBe(AvailableTranslationLanguagesE.ru);
      expect(updated.variants_of_words).toEqual(['бежать', 'бегать']);
    });

    it('throws NotFoundException for a missing translation', async () => {
      await expect(service.editShortTranslation({ id: 9999, description: 'nope' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteShortTranslation', () => {
    it('removes the translation and keeps the word', async () => {
      const word = await addWordRow();
      const id = addedId(await service.addShortTranslation(makeAddBody(word.id)));

      const res = await service.deleteShortTranslation(id);

      expect(res).toEqual({ success: true });
      expect(await ds.getRepository(EnShortTranslation).count()).toBe(0);
      expect(await ds.getRepository(EnWord).count()).toBe(1);
    });

    it('reports success for a missing id (idempotent delete)', async () => {
      await expect(service.deleteShortTranslation(9999)).resolves.toEqual({ success: true });
    });
  });
});
