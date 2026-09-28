import './helpers/clearDatabaseUrl';
import { WordRowsService } from '../word-rows.service';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
  AvailableTranslationLanguagesE,
  EnMeaningT,
  EnPartOfSpeechE,
  EnShortTranslationT,
  EnWordFormsE,
  EnWordT,
} from '../../../../types';

describe('EnService.addWord transactions (issue #180)', () => {
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

  const counts = async () => ({
    entries: await ds.getRepository(EnEntry).count(),
    words: await ds.getRepository(EnWord).count(),
    meanings: await ds.getRepository(EnMeaning).count(),
    meaningTranslations: await ds.getRepository(EnMeaningTranslation).count(),
    shortTranslations: await ds.getRepository(EnShortTranslation).count(),
  });

  const makeWordBody = (word: string, extra: Partial<EnWordT> = {}): EnWordT =>
    ({
      word,
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      forms: [
        {
          word: `${word}s`,
          form_of_word: EnWordFormsE.third_person_singular,
        },
      ] as EnWordT['forms'],
      meanings: [
        {
          title: 'to move fast',
          definition: 'to move fast on foot',
          sort_order: 1,
          examples: [],
          translations: [
            {
              title: 'бежать',
              definition: 'быстро перемещаться',
              language: AvailableTranslationLanguagesE.ru,
            },
          ],
        },
      ] as unknown as EnMeaningT[],
      short_translations: [
        {
          language: AvailableTranslationLanguagesE.ru,
          description: 'бежать',
          variants_of_words: ['бежать'],
        },
      ] as unknown as EnShortTranslationT[],
      ...extra,
    }) as EnWordT;

  it('сохраняет слово с формами, значениями и переводами целиком', async () => {
    await service.addWord(makeWordBody('run'));

    expect(await counts()).toEqual({
      entries: 2, // run + runs
      words: 2, // base + form
      meanings: 1,
      meaningTranslations: 1,
      shortTranslations: 1,
    });
  });

  it('откатывает всё при несуществующей фразовой базе (раньше оставался мусор)', async () => {
    const body = makeWordBody('give up', { base_phrasal: 'give' } as Partial<EnWordT>);

    await expect(service.addWord(body)).rejects.toThrow(BadRequestException);

    // no entry, no word, no forms/meanings/translations — full rollback
    expect(await counts()).toEqual({
      entries: 0,
      words: 0,
      meanings: 0,
      meaningTranslations: 0,
      shortTranslations: 0,
    });
  });

  it('при дубликате слова не оставляет частичных данных', async () => {
    await service.addWord(makeWordBody('run'));
    const before = await counts();

    await expect(service.addWord(makeWordBody('run'))).rejects.toThrow(ConflictException);

    expect(await counts()).toEqual(before);
  });

  it('откатывается, если падает сохранение значения', async () => {
    const body = makeWordBody('jump');
    // sort_order is NOT NULL — null forces a constraint failure mid-transaction
    (body.meanings as unknown as Array<Record<string, unknown>>)[0].sort_order = null;

    await expect(service.addWord(body)).rejects.toThrow();

    expect(await counts()).toEqual({
      entries: 0,
      words: 0,
      meanings: 0,
      meaningTranslations: 0,
      shortTranslations: 0,
    });
  });

  it('links meaning synonyms to existing entries and returns them from getWordById (issue #259)', async () => {
    await service.addWord(makeWordBody('sprint'));
    await service.addWord(makeWordBody('dash'));
    const body = makeWordBody('run');
    (body.meanings as unknown as Array<Record<string, unknown>>)[0].synonyms = ['Dash', 'sprint', 'run'];

    await service.addWord(body);

    const saved = await ds
      .getRepository(EnWord)
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .where('entry.word = :word', { word: 'run' })
      .andWhere('w.form_of_word = :form', { form: EnWordFormsE.base_form })
      .getOneOrFail();
    const word = await service.getWordById(saved.id);
    expect(word.meanings[0].synonyms).toEqual(['dash', 'sprint']);
    // the plain-entity relation does not leak into the API shape
    expect(word.meanings[0]).not.toHaveProperty('createdAt');
  });

  it('links meaning antonyms next to the synonyms and rolls back on a conflict (issue #266)', async () => {
    await service.addWord(makeWordBody('sprint'));
    await service.addWord(makeWordBody('walk'));
    const body = makeWordBody('run');
    const meaning = (body.meanings as unknown as Array<Record<string, unknown>>)[0];
    meaning.synonyms = ['sprint'];
    meaning.antonyms = ['Walk', 'run'];

    await service.addWord(body);

    const saved = await ds
      .getRepository(EnWord)
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .where('entry.word = :word', { word: 'run' })
      .andWhere('w.form_of_word = :form', { form: EnWordFormsE.base_form })
      .getOneOrFail();
    const word = await service.getWordById(saved.id);
    expect(word.meanings[0].synonyms).toEqual(['sprint']);
    expect(word.meanings[0].antonyms).toEqual(['walk']);

    const conflicting = makeWordBody('jog');
    const m = (conflicting.meanings as unknown as Array<Record<string, unknown>>)[0];
    m.synonyms = ['sprint'];
    m.antonyms = ['sprint'];
    await expect(service.addWord(conflicting)).rejects.toThrow(BadRequestException);
    expect(await ds.getRepository(EnEntry).findOneBy({ word: 'jog' })).toBeNull();
  });

  it('rolls back the whole word when a meaning names an unknown synonym (issue #259)', async () => {
    const body = makeWordBody('run');
    (body.meanings as unknown as Array<Record<string, unknown>>)[0].synonyms = ['teleport'];

    await expect(service.addWord(body)).rejects.toThrow(BadRequestException);

    expect(await counts()).toEqual({
      entries: 0,
      words: 0,
      meanings: 0,
      meaningTranslations: 0,
      shortTranslations: 0,
    });
  });
});
