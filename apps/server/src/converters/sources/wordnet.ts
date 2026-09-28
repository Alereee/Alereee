import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CategoryE, EnAreaVariantsE, EnPartOfSpeechE, EnWordFormsE, LanguageRegisterE } from '../../../types';
import { readLines } from '../input';
import { emptyEntry, phrasalBaseOf } from '../normalize';
import { termsOfAdapter } from '../terms';
import {
  ConvertedFormT,
  ConvertedMeaningT,
  ConverterContextT,
  HEADWORD_MAX_LENGTH,
  SourceAdapterT,
} from '../types';
import { unpackFiles, WORDNET_FILES } from '../unpack';
import { editionOfOpenEnglishWordnet, releaseEntries, versionOfPrincetonWordnet } from '../version';
import { loadCmudict } from './cmudict';

/**
 * WordNet in its database format (issue #527): the `data.*`, `index.*` and
 * `*.exc` files Princeton defined (wndb(5)) and the Open English WordNet
 * publishes every year — https://en-word.net, CC BY 4.0;
 * `english-wordnet-<year>.zip` of its releases, read packed as it is
 * downloaded (so is the tar.gz of Princeton) or from the folder it unpacks
 * into. A synset is a meaning, its
 * words are each other's synonyms, the antonyms are pointers between words.
 * WordNet has no pronunciations, no translations and no inflected forms but
 * the irregular ones: the pronunciations come from CMUdict when
 * `--cmudict` names the file.
 */

type PosT = 'noun' | 'verb' | 'adj' | 'adv';

const FILES: ReadonlyArray<{ pos: PosT; partOfSpeech: EnPartOfSpeechE }> = [
  { pos: 'noun', partOfSpeech: EnPartOfSpeechE.noun },
  { pos: 'verb', partOfSpeech: EnPartOfSpeechE.verb },
  { pos: 'adj', partOfSpeech: EnPartOfSpeechE.adjective },
  { pos: 'adv', partOfSpeech: EnPartOfSpeechE.adverb },
];

// the letter a pointer names the part of speech of its target by
const POS_LETTERS: Readonly<Record<string, PosT>> = { n: 'noun', v: 'verb', a: 'adj', s: 'adj', r: 'adv' };

type PointerT = { symbol: string; target: string; source: number; targetWord: number };
type SynsetT = { words: string[]; definition: string; examples: string[]; pointers: PointerT[] };

const spelled = (word: string): string =>
  word
    // the syntactic marker of an adjective: galore(ip), former(a)
    .replace(/\([a-z]+\)$/, '')
    .replace(/_/g, ' ');

/** One line of a data file: `offset lex_filenum ss_type w_cnt word lex_id … p_cnt pointer… | gloss` */
export const parseSynset = (line: string, pos: PosT): { key: string; synset: SynsetT } | null => {
  // the license text at the head of every file is indented
  if (!line || line.startsWith(' ')) return null;
  const bar = line.indexOf('|');
  const fields = (bar === -1 ? line : line.slice(0, bar)).trim().split(' ');
  const gloss = bar === -1 ? '' : line.slice(bar + 1).trim();
  const wordCount = parseInt(fields[3], 16);
  if (!Number.isFinite(wordCount) || fields.length < 4 + wordCount * 2 + 1) return null;
  const words: string[] = [];
  for (let index = 0; index < wordCount; index += 1) words.push(spelled(fields[4 + index * 2]));
  const pointerCount = parseInt(fields[4 + wordCount * 2], 10);
  const pointers: PointerT[] = [];
  let at = 5 + wordCount * 2;
  for (let index = 0; index < pointerCount && at + 3 < fields.length + 1; index += 1, at += 4) {
    const targetPos = POS_LETTERS[fields[at + 2]];
    const link = fields[at + 3] ?? '0000';
    if (!targetPos) continue;
    pointers.push({
      symbol: fields[at],
      target: `${targetPos} ${fields[at + 1]}`,
      source: parseInt(link.slice(0, 2), 16),
      targetWord: parseInt(link.slice(2), 16),
    });
  }
  // the gloss: the definition, then the examples in quotes
  const [definition, ...rest] = gloss.split(/;\s*(?=")/);
  const examples = rest
    .map((example) => example.trim().replace(/^"|"$/g, '').replace(/";?$/, '').trim())
    .filter(Boolean);
  if (!definition?.trim()) return null;
  return {
    key: `${pos} ${fields[0]}`,
    synset: { words, definition: definition.trim().replace(/;$/, ''), examples, pointers },
  };
};

const REGISTERS: ReadonlyArray<[LanguageRegisterE, string[]]> = [
  [LanguageRegisterE.slang, ['slang', 'vulgarism', 'obscenity']],
  [LanguageRegisterE.informal, ['colloquialism', 'informality']],
  [LanguageRegisterE.formal, ['formality']],
];
const OBSOLETE = ['archaism', 'obsolete'];
const AREAS: ReadonlyArray<[EnAreaVariantsE, string[]]> = [
  [EnAreaVariantsE.british, ['britain', 'great britain', 'united kingdom', 'england']],
  [EnAreaVariantsE.american, ['united states', 'america', 'united states of america']],
  [EnAreaVariantsE.australian, ['australia']],
];
const CATEGORIES: ReadonlyArray<[CategoryE, string[]]> = [
  [
    CategoryE.medical,
    ['medicine', 'pathology', 'anatomy', 'pharmacology', 'surgery', 'dentistry', 'psychiatry'],
  ],
  [CategoryE.legal, ['law', 'jurisprudence']],
  [CategoryE.IT, ['computer science', 'computing', 'computer', 'internet']],
  [CategoryE.business, ['business', 'finance', 'economics', 'accounting', 'banking', 'commerce']],
  [
    CategoryE.scientific,
    ['physics', 'chemistry', 'biology', 'mathematics', 'astronomy', 'geology', 'botany', 'zoology', 'science'],
  ],
  [CategoryE.technical, ['engineering', 'technology', 'electronics', 'mechanics', 'electricity']],
  [CategoryE.art, ['art', 'music', 'literature', 'architecture', 'painting', 'theater', 'poetry']],
  [CategoryE.political, ['politics', 'government']],
  [CategoryE.sport, ['sport', 'athletics', 'baseball', 'football', 'tennis', 'golf', 'boxing']],
  [CategoryE.culinary, ['cooking', 'cookery', 'cuisine']],
];

const named = <T>(table: ReadonlyArray<[T, string[]]>, names: string[]): T[] =>
  table.filter(([, wanted]) => wanted.some((name) => names.includes(name))).map(([value]) => value);

/** The folder with the database files: the input itself, or what its archive unpacks into */
const openRelease = async (input: string): Promise<{ dir: string; close: () => Promise<void> }> => {
  if (!existsSync(input)) throw new Error(`"${input}" does not exist`);
  if (statSync(input).isDirectory()) {
    if (existsSync(path.join(input, 'data.noun'))) return { dir: input, close: async () => undefined };
    throw new Error(`"${input}" has no data.noun: name the folder the release unpacks its files into`);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-wordnet-'));
  const close = (): Promise<void> => rm(dir, { recursive: true, force: true });
  try {
    const found = await unpackFiles(input, dir, WORDNET_FILES);
    if (!found.includes('data.noun') || !found.includes('index.noun')) {
      throw new Error(
        `"${input}" has no data.noun and index.noun: not a release in the WordNet database format`,
      );
    }
  } catch (error) {
    await close();
    throw error;
  }
  return { dir, close };
};

const loadExceptions = async (dir: string, pos: PosT): Promise<Map<string, string[]>> => {
  const forms = new Map<string, string[]>();
  const file = path.join(dir, `${pos}.exc`);
  if (!existsSync(file)) return forms;
  for await (const line of readLines(file)) {
    const [inflected, ...bases] = line.trim().split(/\s+/);
    for (const base of bases) forms.set(base, [...(forms.get(base) ?? []), spelled(inflected)]);
  }
  return forms;
};

const convertWordnet = async (
  input: string,
  options: Record<string, string>,
  context: ConverterContextT,
): Promise<void> => {
  const release = await openRelease(input);
  try {
    await convertRelease(release.dir, options, context);
  } finally {
    await release.close();
  }
};

const convertRelease = async (
  dir: string,
  options: Record<string, string>,
  context: ConverterContextT,
): Promise<void> => {
  const pronunciations = options.cmudict ? await loadCmudict(options.cmudict) : new Map<string, string>();
  if (options.cmudict) context.log(`${pronunciations.size} pronunciations read from CMUdict`);

  const synsets = new Map<string, SynsetT>();
  for (const { pos } of FILES) {
    for await (const line of readLines(path.join(dir, `data.${pos}`))) {
      const parsed = parseSynset(line, pos);
      if (parsed) synsets.set(parsed.key, parsed.synset);
    }
  }
  context.log(`${synsets.size} synsets read`);

  let read = 0;
  for (const { pos, partOfSpeech } of FILES) {
    const exceptions = await loadExceptions(dir, pos);
    for await (const line of readLines(path.join(dir, `index.${pos}`))) {
      if (!line || line.startsWith(' ')) continue;
      if (context.limit !== undefined && read >= context.limit) return;
      read += 1;
      // lemma pos synset_cnt p_cnt [symbol…] sense_cnt tagsense_cnt offset…
      const fields = line.trim().split(' ');
      const lemma = fields[0];
      const pointerSymbols = parseInt(fields[3], 10);
      const offsets = fields.slice(6 + pointerSymbols);
      const senses = offsets.map((offset) => synsets.get(`${pos} ${offset}`)).filter((s): s is SynsetT => !!s);
      if (senses.length === 0) {
        context.skip('no_definition');
        continue;
      }

      // the index folds the case: the synsets know how the word is written
      const folded = spelled(lemma);
      const spellings = senses.map(
        (synset) => synset.words.find((word) => word.toLowerCase() === folded.toLowerCase()) ?? folded,
      );
      const word = spellings[0];
      if (word.length > HEADWORD_MAX_LENGTH) {
        context.skip('headword_too_long');
        continue;
      }

      const meanings: ConvertedMeaningT[] = senses.map((synset, index) => {
        const own = synset.words.findIndex((item) => item === spellings[index]) + 1;
        const domain = (symbol: string): string[] =>
          synset.pointers
            .filter((pointer) => pointer.symbol === symbol)
            .flatMap((pointer) => synsets.get(pointer.target)?.words ?? [])
            .map((item) => item.toLowerCase());
        const usage = domain(';u');
        const antonyms = synset.pointers
          .filter((pointer) => pointer.symbol === '!' && (pointer.source === 0 || pointer.source === own))
          .map((pointer) => {
            const target = synsets.get(pointer.target);
            return pointer.targetWord ? target?.words[pointer.targetWord - 1] : target?.words[0];
          })
          .filter((item): item is string => !!item && item !== word);
        const synonyms = synset.words.filter((item) => item.toLowerCase() !== folded.toLowerCase());
        return {
          definition: synset.definition,
          examples: synset.examples.slice(0, 3),
          is_obsolete: OBSOLETE.some((name) => usage.includes(name)),
          area_variant: named(AREAS, domain(';r'))[0] ?? EnAreaVariantsE.common,
          language_register: named(REGISTERS, usage)[0] ?? '',
          categories: named(CATEGORIES, domain(';c')),
          synonyms: [...new Set(synonyms)],
          antonyms: [...new Set(antonyms)].filter((item) => !synonyms.includes(item)),
          translations: [],
        };
      });

      const entry = emptyEntry(word, partOfSpeech);
      entry.meanings = meanings;
      entry.transcription = word.includes(' ') ? '' : (pronunciations.get(word.toLowerCase()) ?? '');
      entry.is_obsolete = meanings.every((meaning) => meaning.is_obsolete);
      entry.categories = [...new Set(meanings.flatMap((meaning) => meaning.categories))];
      const irregular = exceptions.get(lemma) ?? [];
      if (partOfSpeech === EnPartOfSpeechE.noun) {
        entry.noun___is_proper = spellings.every((spelling) => /^\p{Lu}/u.test(spelling));
        entry.forms = irregular.map((form) => ({ word: form, form_of_word: EnWordFormsE.plural_form }));
        entry.noun___irregular_plural = irregular.length > 0;
      }
      if (partOfSpeech === EnPartOfSpeechE.adjective || partOfSpeech === EnPartOfSpeechE.adverb) {
        // better, best: the ending says which degree an irregular form is
        entry.forms = irregular.flatMap((form): ConvertedFormT[] =>
          form.endsWith('est')
            ? [{ word: form, form_of_word: EnWordFormsE.superlative_form }]
            : form.endsWith('er')
              ? [{ word: form, form_of_word: EnWordFormsE.comparative_form }]
              : [],
        );
      }
      if (partOfSpeech === EnPartOfSpeechE.verb) {
        // the exception list names the irregular forms of a verb without
        // saying which is the past and which the participle: the entry is
        // flagged, the forms are not guessed
        entry.verb___is_irregular = irregular.length > 0;
        const base = phrasalBaseOf(word, partOfSpeech);
        if (base) {
          entry.verb___is_phrasal = true;
          entry.base_phrasal = base;
        }
      }
      await context.emit(entry);
      if (read % 50_000 === 0) context.log(`${read} lemmas read`);
    }
  }
};

export const wordnet: SourceAdapterT = {
  name: 'wordnet',
  description:
    'WordNet in its database format: english-wordnet-<year>.zip of the Open English WordNet, or the tar.gz of ' +
    'Princeton WordNet with --edition princeton (packed or unpacked); --cmudict <file> adds pronunciations',
  provenance: (options) => termsOfAdapter('wordnet', options),
  // the pronunciations of CMUdict have no version and are not a part of this one
  versionOf: async (input, options) => {
    const entries = await releaseEntries(input);
    return options.edition === 'princeton'
      ? versionOfPrincetonWordnet(entries)
      : editionOfOpenEnglishWordnet(entries);
  },
  convert: convertWordnet,
};
