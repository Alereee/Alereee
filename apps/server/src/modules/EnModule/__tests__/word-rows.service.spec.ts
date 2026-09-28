import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DICTIONARY_ENTITIES } from '../entities/dictionary-entities';
import { EnWord } from '../entities/en_word.entity';
import { EnMeaning } from '../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../entities/en_short_translation.entity';
import { EnService } from '../en.service';
import { EnMeaningService } from '../modules/EnMeaning/enMeaning.service';
import { EnMeaningTranslationService } from '../modules/EnMeaningTranslation/enMeaningTranslation.service';
import { EnShortTranslationService } from '../modules/EnShortTranslation/enShortTranslation.service';
import { FULL_WORD_RELATIONS, RELATION_LOAD_STRATEGY } from '../utils/wordRelations';
import { WordRowsService } from '../word-rows.service';
import {
  AvailableTranslationLanguagesE,
  CategoryE,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnWordFormsE,
  WordLevelE,
} from '../../../../types';

// A plain view of an entity graph: instances become objects, relations are
// sorted by id so the two loaders can be compared field for field
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const sorted = (rows: EnWord[]): EnWord[] => {
  for (const row of rows) {
    row.forms?.sort((a, b) => a.id - b.id);
    row.meanings?.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    row.meanings?.forEach((m) => {
      m.translations?.sort((a, b) => a.id - b.id);
      m.synonyms?.sort((a, b) => a.word.localeCompare(b.word));
      m.antonyms?.sort((a, b) => a.word.localeCompare(b.word));
    });
    row.short_translations?.sort((a, b) => a.id - b.id);
    row.phrasal_variants?.sort((a, b) => a.id - b.id);
  }
  return rows;
};

// The raw-row loader (issue #424) must answer exactly what find() with the
// same relations answers: every scalar column converted by the driver
// (booleans, enums, arrays, JSON, dates), every relation grouped under its
// owner, absent relations left out
describe('WordRowsService (issue #424)', () => {
  let ds: DataSource;
  let loader: WordRowsService;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();
    loader = new WordRowsService(ds);
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
    const enService = new EnService(
      ds.getRepository(EnWord),
      ds,
      shortTranslationService,
      meaningService,
      loader,
    );
    const add = async (body: object): Promise<number> =>
      ((await enService.addWord(body as never)) as { id: number }).id;

    ids.sprint = await add({
      word: 'sprint',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      meanings: [
        {
          title: 'to run fast',
          definition: 'd',
          is_obsolete: false,
          sort_order: 1,
          examples: [],
          translations: [],
        },
      ],
    });
    ids.give = await add({
      word: 'give',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
    });
    ids.run = await add({
      word: 'run',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      word_level: WordLevelE.A1,
      categories: [CategoryE.sport, CategoryE.IT],
      pattern: ['run + adverb'],
      transcription: 'rʌn',
      is_abbreviation: false,
      noun___uncountable: true,
      forms: [
        { word: 'ran', form_of_word: EnWordFormsE.past_simple, area_variant: EnAreaVariantsE.common },
        {
          word: 'running',
          form_of_word: EnWordFormsE.present_participle,
          area_variant: EnAreaVariantsE.british,
        },
      ],
      meanings: [
        {
          title: 'to manage',
          definition: 'd2',
          is_obsolete: true,
          sort_order: 2,
          examples: ['run a shop', 'run a country'],
          area_variant: EnAreaVariantsE.common,
          categories: [CategoryE.IT],
          translations: [
            {
              language: AvailableTranslationLanguagesE.ru,
              title: 'управлять',
              definition: 'у',
              variants_of_words: ['вести'],
            },
          ],
          antonyms: ['sprint'],
        },
        {
          title: 'to move fast',
          definition: 'd1',
          is_obsolete: false,
          sort_order: 1,
          examples: [],
          area_variant: EnAreaVariantsE.common,
          translations: [
            {
              language: AvailableTranslationLanguagesE.ru,
              title: 'бежать',
              definition: 'б',
              variants_of_words: ['бежать'],
            },
          ],
          synonyms: ['sprint', 'give'],
        },
      ],
      short_translations: [
        {
          language: AvailableTranslationLanguagesE.ru,
          description: 'бежать',
          variants_of_words: ['бежать', 'бегать'],
        },
      ],
    });
    ids.giveUp = await add({
      word: 'give up',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      verb___is_phrasal: true,
      base_phrasal: 'give',
    });
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const findAll = async (wanted: number[], relations: typeof FULL_WORD_RELATIONS): Promise<EnWord[]> => {
    const rows = await ds.getRepository(EnWord).find({
      relations,
      relationLoadStrategy: RELATION_LOAD_STRATEGY,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return sorted(wanted.map((id) => byId.get(id)).filter((row): row is EnWord => row !== undefined));
  };

  it('answers the same rows as find() with every relation', async () => {
    const wanted = [ids.run, ids.giveUp, ids.give, ids.sprint];
    const expected = await findAll(wanted, FULL_WORD_RELATIONS);
    const loaded = sorted(await loader.load(wanted, FULL_WORD_RELATIONS));
    expect(plain(loaded)).toEqual(plain(expected));
    // the conversions the driver applies to raw values survived
    const run = loaded.find((row) => row.id === ids.run)!;
    expect(run.categories).toEqual([CategoryE.sport, CategoryE.IT]);
    expect(run.pattern).toEqual(['run + adverb']);
    expect(run.noun___uncountable).toBe(true);
    expect(run.is_abbreviation).toBe(false);
    expect(run.createdAt).toBeInstanceOf(Date);
    expect(run.meanings[1].examples).toEqual(['run a shop', 'run a country']);
    expect(run.meanings[1].is_obsolete).toBe(true);
    expect(run.meanings[0].synonyms.map((entry) => entry.word)).toEqual(['give', 'sprint']);
    expect(run.meanings[1].antonyms.map((entry) => entry.word)).toEqual(['sprint']);
    expect(run.short_translations[0].variants_of_words).toEqual(['бежать', 'бегать']);
    expect(run.forms.map((form) => form.word.word)).toEqual(['ran', 'running']);
    // the entry row of the headword came along (added through the admin service, hence flagged)
    expect(run.word.user_modified).toBe(true);
    const giveUp = loaded.find((row) => row.id === ids.giveUp)!;
    expect(giveUp.base_phrasal?.word.word).toBe('give');
    expect(loaded.find((row) => row.id === ids.give)!.phrasal_variants?.map((v) => v.word.word)).toEqual([
      'give up',
    ]);
  });

  it('answers the same rows as find() with a subset of relations, in the order of the ids', async () => {
    const relations = { word: true, forms: { word: true }, meanings: { translations: true } } as const;
    const wanted = [ids.giveUp, ids.run];
    const expected = await findAll(wanted, relations);
    const loaded = sorted(await loader.load(wanted, relations));
    expect(plain(loaded)).toEqual(plain(expected));
    expect(loaded.map((row) => row.id)).toEqual(wanted);
    expect(loaded[1]).not.toHaveProperty('short_translations');
    expect(loaded[1].meanings[0]).not.toHaveProperty('synonyms');
  });

  it('carries the base-form rows of the linked entries when a link asks for them (issue #442)', async () => {
    const relations = { word: true, meanings: { synonyms: { entries: true }, antonyms: true } } as const;
    const [run] = await loader.load([ids.run], relations);
    const expected = (await findAll([ids.run], relations))[0];
    // the same rows find() joins in, minus what only an entity carries
    expect(
      plain(run.meanings[0].synonyms.map((e) => e.entries.map((w) => [w.word, w.part_of_speech]))),
    ).toEqual(
      plain(expected.meanings[0].synonyms.map((e) => e.entries.map((w) => [w.word, w.part_of_speech]))),
    );
    expect(run.meanings[0].synonyms.map((e) => e.entries.map((w) => w.form_of_word))).toEqual([
      [EnWordFormsE.base_form],
      [EnWordFormsE.base_form],
    ]);
    // the antonyms were asked for without their rows
    expect(run.meanings[1].antonyms[0]).not.toHaveProperty('entries');
  });

  it('skips unknown ids and answers nothing for none', async () => {
    expect(await loader.load([], FULL_WORD_RELATIONS)).toEqual([]);
    expect((await loader.load([999_999, ids.run], { word: true })).map((row) => row.id)).toEqual([ids.run]);
  });
});
