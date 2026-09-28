import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseManifest } from '../../modules/EnModule/modules/EnImportDictionary/utils/parseManifest';
import { DATASET_KNOWN_FILE_NAMES } from '../../modules/EnModule/modules/EnImportDictionary/constants';
import { AvailableTranslationLanguagesE, EnWordFormsE } from '../../../types';
import { convert } from '../convert';
import { findSource } from '../sources';
import { cleanTranslation, convertRecord, KaikkiRecordT } from '../sources/wiktionary';

const FIXTURES = path.join(__dirname, 'fixtures');

type LineT = Record<string, unknown>;

const readJsonl = async (dir: string, file: string): Promise<LineT[]> =>
  (await readFile(path.join(dir, file), 'utf-8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LineT);

// what the import reads: a manifest it accepts, the files it knows, the line counts the manifest names
const expectImportable = async (dir: string): Promise<void> => {
  const files = await readdir(dir);
  for (const file of files) expect(DATASET_KNOWN_FILE_NAMES).toContain(file);
  const manifest = parseManifest(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf-8')));
  expect(manifest).not.toBeNull();
  expect(Object.keys(manifest!.files).sort()).toEqual(
    files.filter((file) => !['manifest.json', 'LICENSE'].includes(file)).sort(),
  );
  // the terms of the source travel with the copy, its notices in full (issue #531)
  expect(files).toContain('LICENSE');
  for (const [file, { lines }] of Object.entries(manifest!.files)) {
    expect((await readJsonl(dir, file)).length).toBe(lines);
  }
};

// The English Wiktionary through kaikki.org (issue #527). The fixture is written for the
// test in the format of the extract: no text of Wiktionary is copied into the repository.

describe('wiktionary: the terms of the data', () => {
  it('are share-alike', () => {
    expect(findSource('wiktionary')?.provenance({})).toEqual(
      expect.objectContaining({
        source: 'wiktionary',
        license: 'CC-BY-SA-4.0',
        license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        attribution_url: 'https://en.wiktionary.org',
        notice: '',
      }),
    );
  });
});

// seen in the full extract: the editors annotate translations in place
describe('wiktionary: a translation is the word itself', () => {
  const { ru, es, zh, ar, de } = AvailableTranslationLanguagesE;

  it('takes the notes of the editors off', () => {
    expect(cleanTranslation('resistir (sin ceder)', es)).toBe('resistir');
    expect(cleanTranslation('[un] agua', es)).toBe('agua');
    expect(cleanTranslation('apechugar[se]', es)).toBe('apechugar');
    expect(cleanTranslation('нажатие клавиш(и)', ru)).toBe('нажатие клавиш');
    expect(cleanTranslation('дело труба /business is a pipe/', ru)).toBe('дело труба');
    expect(cleanTranslation('决定(性)因素', zh)).toBe('决定因素');
    expect(cleanTranslation('(日语~)罗马字', zh)).toBe('罗马字');
    expect(cleanTranslation('Lampe', de)).toBe('Lampe');
  });

  it('ends a word of another script where the grammar begins, and leaves a Latin word alone', () => {
    expect(cleanTranslation('общага f', ru)).toBe('общага');
    expect(cleanTranslation('أقواس m pl', ar)).toBe('أقواس');
    expect(cleanTranslation('пердеть impf пёрднуть', ru)).toBe('пердеть');
    expect(cleanTranslation('لِيرَة f or لَيْرَة', ar)).toBe('لِيرَة');
    // a note that does not close is cut with the grammar it follows
    expect(cleanTranslation('общага f (', ru)).toBe('общага');
    expect(cleanTranslation('قَوْس m (plural: أَقْوَاس m pl, قَوْسَانِ', ar)).toBe('قَوْس');
    expect(cleanTranslation('X光', zh)).toBe('X光');
    expect(cleanTranslation('USB-накопитель', ru)).toBe('USB-накопитель');
    expect(cleanTranslation('casa f', es)).toBe('casa f');
  });

  it('keeps the simplified spelling of a Mandarin word and drops the stress mark of a Russian one', () => {
    expect(cleanTranslation('詞典 /词典', zh)).toBe('词典');
    expect(cleanTranslation('ла́мпа', ru)).toBe('лампа');
  });

  it('answers nothing for what is still markup: a flawed translation is no translation', () => {
    expect(cleanTranslation('凶暴而残忍[[', zh)).toBe('');
    expect(cleanTranslation('掷&(colloquial&informal) 扔', zh)).toBe('');
    expect(cleanTranslation('giste (cerveza', es)).toBe('');
    expect(cleanTranslation('Hijazi Arabic وحش', ar)).toBe('');
    expect(cleanTranslation('slang свайпнуть', ru)).toBe('');
    expect(cleanTranslation('(only a note)', es)).toBe('');
    expect(cleanTranslation('a'.repeat(81), es)).toBe('');
  });
});

describe('wiktionary: one record', () => {
  const record = (extra: Partial<KaikkiRecordT>): KaikkiRecordT => ({
    word: 'lamp',
    pos: 'noun',
    lang_code: 'en',
    senses: [{ glosses: ['A device that gives light.'] }],
    ...extra,
  });

  // "limp" of the full extract: a third etymology, "to happen", with the past "lamp"
  it('lists the forms of a dead word as dead, and does not read the irregular flag from them', () => {
    const forms = [
      { form: 'limps', tags: ['present', 'singular', 'third-person'] },
      { form: 'lamp', tags: ['past'] },
      { form: 'lump', tags: ['participle', 'past'] },
    ];
    const dead = convertRecord({
      word: 'limp',
      pos: 'verb',
      lang_code: 'en',
      senses: [{ glosses: ['To happen; to befall.'], tags: ['obsolete'] }],
      forms,
    });
    expect(dead).toEqual(
      expect.objectContaining({
        is_obsolete: true,
        verb___is_irregular: false,
        forms: [
          { word: 'limps', form_of_word: EnWordFormsE.third_person_singular, is_obsolete: true },
          { word: 'lamp', form_of_word: EnWordFormsE.past_simple, is_obsolete: true },
          { word: 'lump', form_of_word: EnWordFormsE.past_participle, is_obsolete: true },
        ],
      }),
    );

    const living = convertRecord({
      word: 'limp',
      pos: 'verb',
      lang_code: 'en',
      senses: [{ glosses: ['To happen; to befall.'] }],
      forms,
    });
    expect(living).toEqual(expect.objectContaining({ is_obsolete: false, verb___is_irregular: true }));
  });

  it('flags a verb of several words by its verb: "watch it" is regular, "wear out" is not', () => {
    const verb = (word: string, past: string) =>
      convertRecord({
        word,
        pos: 'verb',
        lang_code: 'en',
        senses: [{ glosses: ['To do something.'] }],
        forms: [{ form: past, tags: ['past'] }],
      });
    expect(verb('watch it', 'watched it')).toEqual(expect.objectContaining({ verb___is_irregular: false }));
    expect(verb('wear out', 'wore out')).toEqual(expect.objectContaining({ verb___is_irregular: true }));
  });

  it('says why a record is left out', () => {
    expect(convertRecord(record({ lang_code: 'fr' }))).toBe('other_language');
    expect(convertRecord(record({ pos: 'prefix' }))).toBe('unsupported_part_of_speech');
    expect(convertRecord(record({ senses: [{ tags: ['no-gloss'] }] }))).toBe('no_definition');
    expect(
      convertRecord(record({ senses: [{ glosses: ['plural of lamp'], form_of: [{ word: 'lamp' }] }] })),
    ).toBe('form_or_alternative');
    expect(convertRecord(record({ word: 'a'.repeat(129) }))).toBe('headword_too_long');
    expect(convertRecord({ word: 'lamp' })).toBe('malformed');
  });

  it('takes the most particular gloss of a sub-sense as the definition', () => {
    const entry = convertRecord(
      record({ senses: [{ glosses: ['Something that enlightens.', 'A source of spiritual light.'] }] }),
    );
    expect(typeof entry).toBe('object');
    expect((entry as { meanings: Array<{ definition: string }> }).meanings[0].definition).toBe(
      'A source of spiritual light.',
    );
  });

  it('prefers the American pronunciation, then the British one', () => {
    const sounds = [
      { ipa: '/læmp/', tags: ['Received-Pronunciation'] },
      { ipa: '/lɛəmp/', tags: ['General-American'] },
    ];
    expect((convertRecord(record({ sounds })) as { transcription: string }).transcription).toBe('/lɛəmp/');
    expect((convertRecord(record({ sounds: [sounds[0]] })) as { transcription: string }).transcription).toBe(
      '/læmp/',
    );
    expect((convertRecord(record({})) as { transcription: string }).transcription).toBe('');
  });
});

describe('wiktionary: the dataset', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-convert-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('wiktionary: merges the records of a headword, folds its forms in, files the translations', async () => {
    const source = findSource('wiktionary')!;
    const summary = await convert({
      source,
      input: path.join(FIXTURES, 'kaikki.jsonl'),
      outDir,
      version: '2026.09',
    });

    // the plural page, the French word, the prefix, the record without a gloss and the broken line are left out
    expect(summary.skipped).toEqual({
      form_or_alternative: 1,
      other_language: 1,
      unsupported_part_of_speech: 1,
      no_definition: 1,
      malformed: 1,
    });
    // "lamp" the adjective follows the other records of the headword after a broken line: still one entry each
    expect(summary.entries).toBe(8);
    expect(summary.late_duplicates).toBe(0);

    const words = await readJsonl(outDir, 'vocab-bloom-hub-en-words.jsonl');
    expect(words.map((line) => [line.word, line.part_of_speech])).toEqual([
      ['lamp', 'noun'],
      ['lamp', 'verb'],
      ['take', 'verb'],
      ['take off', 'verb'],
      ['Paris', 'noun'],
      ['can', 'modal_verb'],
      ['lamp', 'adjective'],
    ]);
    const [noun, verb, take, takeOff, paris] = words;
    expect(noun).toEqual(
      expect.objectContaining({
        transcription: '/lɛəmp/',
        generated: false,
        generated_by_model: '',
        description: 'A device that gives light.',
        // one of the meanings is slang, the others are not: the entry has no register of its own
        language_register: '',
        forms: [expect.objectContaining({ word: 'lamps', form_of_word: 'plural_form' })],
        noun___irregular_plural: false,
        version: '2026.09',
      }),
    );
    expect(verb).toEqual(
      expect.objectContaining({
        verb___transitivity: 'both',
        verb___is_irregular: false,
        language_register: '',
      }),
    );
    expect((verb.forms as LineT[]).map((form) => form.form_of_word)).toEqual([
      'third_person_singular',
      'present_participle',
      'past_participle',
      'past_simple',
    ]);
    expect(take).toEqual(
      expect.objectContaining({ verb___is_irregular: true, verb___transitivity: 'transitive' }),
    );
    expect(takeOff).toEqual(expect.objectContaining({ verb___is_phrasal: true, base_phrasal: 'take' }));
    expect(paris).toEqual(expect.objectContaining({ noun___is_proper: true }));

    expect(await readJsonl(outDir, 'vocab-bloom-hub-en-phrases.jsonl')).toEqual([
      expect.objectContaining({ phrase: 'better late than never', level: '' }),
    ]);
    expect(await readJsonl(outDir, 'vocab-bloom-hub-en-phrasal-verbs.jsonl')).toEqual([
      { word: 'take', part_of_speech: 'verb', phrasal_variants: ['take off'] },
    ]);

    const meanings = await readJsonl(outDir, 'vocab-bloom-hub-en-meanings.jsonl');
    const ofNoun = meanings.filter((line) => line.word === 'lamp' && line.part_of_speech === 'noun');
    // two etymology sections, one entry; the definition they share is kept once
    expect(ofNoun.map((line) => [line.sort_order, line.title])).toEqual([
      [1, 'A device that gives light'],
      [2, 'A source of spiritual light'],
      [3, 'A heavy blow'],
    ]);
    expect(ofNoun[0]).toEqual(
      expect.objectContaining({
        examples: ['She switched the lamp on.', 'A lamp stood in every window.'],
        // the headword is never its own synonym
        synonyms: [{ word: 'light', part_of_speech: 'noun' }],
        language_register: '',
        area_variant: 'common',
      }),
    );
    expect(ofNoun[1]).toEqual(expect.objectContaining({ language_register: 'formal' }));
    expect(ofNoun[2]).toEqual(
      expect.objectContaining({
        language_register: 'slang',
        area_variant: 'british',
        antonyms: [{ word: 'caress', part_of_speech: 'noun' }],
      }),
    );
    const ofVerb = meanings.filter((line) => line.word === 'lamp' && line.part_of_speech === 'verb');
    expect(ofVerb.map((line) => line.is_obsolete)).toEqual([false, true]);

    // the stress mark is gone, Mandarin is kept in its simplified spelling, Dungan and Finnish are not translations here
    const translation = async (language: string) =>
      (await readJsonl(outDir, `vocab-bloom-hub-en-meaning-translations.${language}.jsonl`)).map((line) => [
        line.meaning_sort_order,
        line.title,
      ]);
    expect(await translation('ru')).toEqual([[1, 'лампа']]);
    expect(await translation('zh')).toEqual([[1, '灯']]);
    expect(await translation('de')).toEqual([[1, 'Lampe']]);
    // filed under the entry with a summary of the sense: the meaning that shares its words takes it
    expect(await translation('es')).toEqual([[1, 'lámpara']]);
    expect(await translation('fr')).toEqual([[2, 'guide']]);
    expect(await readJsonl(outDir, 'vocab-bloom-hub-en-short-translations.ru.jsonl')).toEqual([
      {
        word: 'lamp',
        part_of_speech: 'noun',
        language: 'ru',
        description: 'лампа',
        variants_of_words: ['лампа'],
      },
    ]);

    expect(summary.manifest).toEqual(
      expect.objectContaining({
        version: '2026.09',
        source: 'wiktionary',
        license: 'CC-BY-SA-4.0',
        synonym_links: 1,
        antonym_links: 1,
      }),
    );
    expect(summary.manifest.translations?.ru).toEqual({ meaning_translations: 1, short_translations: 1 });
  });

  it('stops after --limit records of the source', async () => {
    const summary = await convert({
      source: findSource('wiktionary')!,
      input: path.join(FIXTURES, 'kaikki.jsonl'),
      outDir,
      limit: 3,
    });

    expect(summary.entries).toBe(2);
    expect(summary.manifest.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });

  it('names the license of Wiktionary by its link and says that it is share-alike', async () => {
    await convert({ source: findSource('wiktionary')!, input: path.join(FIXTURES, 'kaikki.jsonl'), outDir });

    const license = await readFile(path.join(outDir, 'LICENSE'), 'utf-8');
    expect(license).toContain(
      'License: Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA-4.0)',
    );
    expect(license).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(license).toContain('Attribution: Wiktionary contributors');
    expect(license).toContain('Share-alike: what is made from this data has to stay under the same license.');
  });

  it('writes what the import reads', async () => {
    await convert({ source: findSource('wiktionary')!, input: path.join(FIXTURES, 'kaikki.jsonl'), outDir });
    await expectImportable(outDir);
  });
});
