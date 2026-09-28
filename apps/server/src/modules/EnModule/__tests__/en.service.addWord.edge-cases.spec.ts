import './helpers/clearDatabaseUrl';
import { WordRowsService } from '../word-rows.service';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
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
import { CategoryE, EnEntryTypesE, EnPartOfSpeechE, EnWordFormsE, EnWordT } from '../../../../types';

describe('EnService.addWord edge cases and editWord array fields (issue #87)', () => {
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

  const makeWordBody = (word: string, extra: Partial<EnWordT> = {}): EnWordT =>
    ({
      word,
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      forms: [],
      meanings: [],
      short_translations: [],
      ...extra,
    }) as unknown as EnWordT;

  const findEntry = (word: string) => ds.getRepository(EnEntry).findOne({ where: { word } });

  describe('entry type derivation', () => {
    it('stores a phrase under a phrase-typed entry', async () => {
      await service.addWord(makeWordBody('in the long run', { part_of_speech: EnPartOfSpeechE.phrase }));

      expect((await findEntry('in the long run'))?.type).toBe(EnEntryTypesE.phrase);
    });

    it('stores a grammar pattern under a grammar_pattern-typed entry', async () => {
      await service.addWord(
        makeWordBody('would rather + verb', {
          part_of_speech: EnPartOfSpeechE.grammar_pattern,
          pattern: ['would rather', 'verb'],
        }),
      );

      expect((await findEntry('would rather + verb'))?.type).toBe(EnEntryTypesE.grammar_pattern);
    });

    it('stores an ordinary word under a word-typed entry', async () => {
      await service.addWord(makeWordBody('run'));

      expect((await findEntry('run'))?.type).toBe(EnEntryTypesE.word);
    });
  });

  describe('entry reuse', () => {
    it('reuses the same entry when the spelling already exists as another part of speech', async () => {
      await service.addWord(makeWordBody('run', { part_of_speech: EnPartOfSpeechE.verb }));
      await service.addWord(makeWordBody('run', { part_of_speech: EnPartOfSpeechE.noun }));

      expect(await ds.getRepository(EnEntry).count({ where: { word: 'run' } })).toBe(1);
      expect(await ds.getRepository(EnWord).count()).toBe(2);
    });

    it('does not duplicate a form row when the payload repeats the same form', async () => {
      await service.addWord(
        makeWordBody('run', {
          forms: [
            { word: 'ran', form_of_word: EnWordFormsE.past_simple },
            { word: 'ran', form_of_word: EnWordFormsE.past_simple },
          ] as EnWordT['forms'],
        }),
      );

      expect(await ds.getRepository(EnEntry).count({ where: { word: 'ran' } })).toBe(1);
      // base word + a single form row
      expect(await ds.getRepository(EnWord).count()).toBe(2);
    });
  });

  describe('phrasal base linking', () => {
    it('links the new phrasal verb to an existing base verb', async () => {
      await service.addWord(makeWordBody('give'));
      await service.addWord(
        makeWordBody('give up', {
          verb___is_phrasal: true,
          base_phrasal: 'give',
        } as unknown as Partial<EnWordT>),
      );

      const giveUp = await ds
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .leftJoinAndSelect('w.base_phrasal', 'bp')
        .leftJoinAndSelect('bp.word', 'bpEntry')
        .where('entry.word = :word', { word: 'give up' })
        .getOneOrFail();

      expect(giveUp.base_phrasal?.word.word).toBe('give');
    });
  });

  describe('editWord array fields', () => {
    const addPlainWord = async (word: string, extra: Partial<EnWordT> = {}) => {
      await service.addWord(makeWordBody(word, extra));
      return ds
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .where('entry.word = :word', { word })
        .getOneOrFail();
    };

    it('updates the categories array', async () => {
      const word = await addPlainWord('run');

      await service.editWord(word.id, { categories: [CategoryE.sport, CategoryE.medical] });

      const updated = await ds.getRepository(EnWord).findOneByOrFail({ id: word.id });
      expect(updated.categories).toEqual([CategoryE.sport, CategoryE.medical]);
    });

    it('updates the pattern array of a grammar pattern', async () => {
      const word = await addPlainWord('would rather + verb', {
        part_of_speech: EnPartOfSpeechE.grammar_pattern,
        pattern: ['would rather', 'verb'],
      });

      await service.editWord(word.id, { pattern: ['would rather', 'bare infinitive'] });

      const updated = await ds.getRepository(EnWord).findOneByOrFail({ id: word.id });
      expect(updated.pattern).toEqual(['would rather', 'bare infinitive']);
    });

    it('keeps an identical array untouched and ignores empty-string field updates', async () => {
      const word = await addPlainWord('run', {
        categories: [CategoryE.sport],
        description: 'to move fast',
      } as Partial<EnWordT>);

      await service.editWord(word.id, { categories: [CategoryE.sport], description: '' });

      const updated = await ds.getRepository(EnWord).findOneByOrFail({ id: word.id });
      expect(updated.categories).toEqual([CategoryE.sport]);
      // empty strings are treated as "no change", not as clearing the field
      expect(updated.description).toBe('to move fast');
    });
  });
});
