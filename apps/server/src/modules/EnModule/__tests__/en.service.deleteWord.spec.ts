import './helpers/clearDatabaseUrl';
import { WordRowsService } from '../word-rows.service';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { EnEntry } from '../entities/en_entry.entity';
import { DICTIONARY_ENTITIES } from '../entities/dictionary-entities';
import { EnWord } from '../entities/en_word.entity';
import { EnService } from '../en.service';
import { EnShortTranslationService } from '../modules/EnShortTranslation/enShortTranslation.service';
import { EnMeaningService } from '../modules/EnMeaning/enMeaning.service';
import { EnEntryTypesE, EnPartOfSpeechE, EnWordFormsE } from '../../../../types';

describe('EnService.deleteWord (issue #164)', () => {
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

    service = new EnService(
      ds.getRepository(EnWord),
      ds,
      null as unknown as EnShortTranslationService,
      null as unknown as EnMeaningService,
      new WordRowsService(ds),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.synchronize(true);
  });

  const addEntry = (word: string) => ds.getRepository(EnEntry).save({ word, type: EnEntryTypesE.word });

  const addWord = (
    entry: EnEntry,
    pos: EnPartOfSpeechE,
    formOfWord = EnWordFormsE.base_form,
    baseForm?: EnWord,
  ) =>
    ds.getRepository(EnWord).save({
      word: entry,
      part_of_speech: pos,
      form_of_word: formOfWord,
      ...(baseForm && { base_form: baseForm }),
    });

  it('не удаляет entry и чужие слова, если entry делят несколько слов', async () => {
    const entry = await addEntry('run');
    const verb = await addWord(entry, EnPartOfSpeechE.verb);
    const noun = await addWord(entry, EnPartOfSpeechE.noun);

    const res = await service.deleteWord(verb.id);

    expect(res).toEqual({ success: true });
    expect(await ds.getRepository(EnWord).findOne({ where: { id: verb.id } })).toBeNull();
    expect(await ds.getRepository(EnWord).findOne({ where: { id: noun.id } })).not.toBeNull();
    expect(await ds.getRepository(EnEntry).findOne({ where: { word: 'run' } })).not.toBeNull();
  });

  it('удаляет entry, когда на него больше никто не ссылается', async () => {
    const entry = await addEntry('jump');
    const verb = await addWord(entry, EnPartOfSpeechE.verb);

    const res = await service.deleteWord(verb.id);

    expect(res).toEqual({ success: true });
    expect(await ds.getRepository(EnWord).findOne({ where: { id: verb.id } })).toBeNull();
    expect(await ds.getRepository(EnEntry).findOne({ where: { word: 'jump' } })).toBeNull();
  });

  it('удаляет формы слова, но сохраняет entry формы, если его использует другое слово', async () => {
    const runEntry = await addEntry('run');
    const runsEntry = await addEntry('runs');

    const verb = await addWord(runEntry, EnPartOfSpeechE.verb);
    const verbForm = await addWord(runsEntry, EnPartOfSpeechE.verb, EnWordFormsE.third_person_singular, verb);
    const standaloneNoun = await addWord(runsEntry, EnPartOfSpeechE.noun);

    const res = await service.deleteWord(verb.id);

    expect(res).toEqual({ success: true });
    // the word itself and its form are deleted
    expect(await ds.getRepository(EnWord).findOne({ where: { id: verb.id } })).toBeNull();
    expect(await ds.getRepository(EnWord).findOne({ where: { id: verbForm.id } })).toBeNull();
    // entry 'run' is not referenced anymore — deleted
    expect(await ds.getRepository(EnEntry).findOne({ where: { word: 'run' } })).toBeNull();
    // entry 'runs' is still used by the standalone noun — kept along with it
    expect(await ds.getRepository(EnWord).findOne({ where: { id: standaloneNoun.id } })).not.toBeNull();
    expect(await ds.getRepository(EnEntry).findOne({ where: { word: 'runs' } })).not.toBeNull();
  });

  it('возвращает success: false для несуществующего id', async () => {
    expect(await service.deleteWord(9999)).toEqual({ success: false });
  });
});
