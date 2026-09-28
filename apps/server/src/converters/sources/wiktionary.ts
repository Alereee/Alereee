import {
  AvailableTranslationLanguagesE,
  CategoryE,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnVerbTransitivityE,
  EnWordFormsE,
  LanguageRegisterE,
} from '../../../types';
import { readLines } from '../input';
import { emptyEntry, isRegularForm, phrasalBaseOf } from '../normalize';
import { termsOfAdapter } from '../terms';
import { versionOfExtract } from '../version';
import {
  ConvertedEntryT,
  ConvertedFormT,
  ConvertedMeaningT,
  ConvertedTranslationT,
  HEADWORD_MAX_LENGTH,
  SourceAdapterT,
} from '../types';

/**
 * Wiktionary through kaikki.org (issue #527): the machine-readable extract
 * of the English Wiktionary that wiktextract publishes, one JSON object per
 * line, a line per word, part of speech and etymology section —
 * https://kaikki.org/dictionary/English/. CC BY-SA 4.0, like the wiki it is
 * extracted from: a share-alike license, so an instance that serves this
 * dataset serves it under the same terms.
 */

// ------------------------------------------------ the shape of a record

type KaikkiLinkT = { word?: string };
type KaikkiTranslationT = {
  lang?: string;
  lang_code?: string;
  code?: string;
  word?: string;
  sense?: string;
  tags?: string[];
};
type KaikkiSenseT = {
  glosses?: string[];
  tags?: string[];
  topics?: string[];
  examples?: Array<{ text?: string; type?: string }>;
  synonyms?: KaikkiLinkT[];
  antonyms?: KaikkiLinkT[];
  translations?: KaikkiTranslationT[];
  form_of?: KaikkiLinkT[];
  alt_of?: KaikkiLinkT[];
};
export type KaikkiRecordT = {
  word?: string;
  pos?: string;
  lang_code?: string;
  senses?: KaikkiSenseT[];
  forms?: Array<{ form?: string; tags?: string[] }>;
  sounds?: Array<{ ipa?: string; tags?: string[] }>;
  translations?: KaikkiTranslationT[];
  synonyms?: Array<KaikkiLinkT & { sense?: string }>;
  antonyms?: Array<KaikkiLinkT & { sense?: string }>;
};

// ------------------------------------------------------------ the mapping

const PARTS_OF_SPEECH: Readonly<Record<string, EnPartOfSpeechE>> = {
  noun: EnPartOfSpeechE.noun,
  // a proper noun: a noun with its flag
  name: EnPartOfSpeechE.noun,
  verb: EnPartOfSpeechE.verb,
  adj: EnPartOfSpeechE.adjective,
  adv: EnPartOfSpeechE.adverb,
  pron: EnPartOfSpeechE.pronoun,
  num: EnPartOfSpeechE.numeral,
  det: EnPartOfSpeechE.determiner,
  intj: EnPartOfSpeechE.interjection,
  article: EnPartOfSpeechE.article,
  prep: EnPartOfSpeechE.preposition,
  conj: EnPartOfSpeechE.conjunction,
  character: EnPartOfSpeechE.letter,
  phrase: EnPartOfSpeechE.phrase,
  proverb: EnPartOfSpeechE.phrase,
  prep_phrase: EnPartOfSpeechE.phrase,
};

const MODAL_VERBS = new Set([
  'can',
  'could',
  'may',
  'might',
  'must',
  'shall',
  'should',
  'will',
  'would',
  'ought',
]);

const REGISTERS: ReadonlyArray<[LanguageRegisterE, string[]]> = [
  [LanguageRegisterE.slang, ['slang', 'vulgar']],
  [LanguageRegisterE.informal, ['informal', 'colloquial', 'childish', 'humorous']],
  [LanguageRegisterE.formal, ['formal', 'literary']],
];

const AREAS: ReadonlyArray<[EnAreaVariantsE, string[]]> = [
  [EnAreaVariantsE.british, ['UK', 'British', 'Britain']],
  [EnAreaVariantsE.american, ['US', 'American']],
  [EnAreaVariantsE.australian, ['Australia', 'Australian']],
];

const CATEGORIES: ReadonlyArray<[CategoryE, string[]]> = [
  [CategoryE.medical, ['medicine', 'pathology', 'anatomy', 'pharmacology', 'surgery', 'dentistry']],
  [CategoryE.legal, ['law', 'legal']],
  [CategoryE.IT, ['computing', 'programming', 'software', 'Internet', 'networking', 'databases']],
  [CategoryE.business, ['business', 'finance', 'economics', 'accounting', 'banking', 'marketing']],
  [
    CategoryE.scientific,
    ['sciences', 'physics', 'chemistry', 'biology', 'mathematics', 'astronomy', 'geology', 'botany', 'zoology'],
  ],
  [CategoryE.technical, ['engineering', 'technology', 'electronics', 'mechanics', 'electricity']],
  [CategoryE.art, ['arts', 'art', 'music', 'literature', 'architecture', 'painting', 'theater', 'film']],
  [CategoryE.political, ['politics', 'government']],
  [CategoryE.sport, ['sports', 'sport']],
  [CategoryE.culinary, ['cooking', 'food', 'cuisine', 'culinary']],
];

// the translation languages of the project by the codes Wiktionary files them under
const LANGUAGES: Readonly<Record<string, AvailableTranslationLanguagesE>> = {
  ru: AvailableTranslationLanguagesE.ru,
  es: AvailableTranslationLanguagesE.es,
  fr: AvailableTranslationLanguagesE.fr,
  de: AvailableTranslationLanguagesE.de,
  pt: AvailableTranslationLanguagesE.pt,
  zh: AvailableTranslationLanguagesE.zh,
  cmn: AvailableTranslationLanguagesE.zh,
  ar: AvailableTranslationLanguagesE.ar,
};

// how many words of one language a meaning keeps, and examples a meaning
const TRANSLATION_WORDS = 6;
const EXAMPLES = 3;
const EXAMPLE_MAX_LENGTH = 300;

const has = (tags: string[] | undefined, ...wanted: string[]): boolean =>
  !!tags && wanted.some((tag) => tags.includes(tag));

const firstMatch = <T>(table: ReadonlyArray<[T, string[]]>, tags: string[]): T | '' =>
  table.find(([, names]) => names.some((name) => tags.includes(name)))?.[0] ?? '';

const categoriesOf = (topics: string[]): CategoryE[] =>
  CATEGORIES.filter(([, names]) => names.some((name) => topics.includes(name))).map(([category]) => category);

const linkedWords = (links: KaikkiLinkT[] | undefined, own: string): string[] => [
  ...new Set(
    (links ?? [])
      .map((link) => (link.word ?? '').trim())
      .filter((word) => word && word !== own && word.length <= HEADWORD_MAX_LENGTH),
  ),
];

// the script a translation into a language is written in: Wiktionary files
// Dungan, which is written in Cyrillic, under the code of Chinese
const SCRIPTS: Readonly<Record<AvailableTranslationLanguagesE, RegExp>> = {
  [AvailableTranslationLanguagesE.ru]: /\p{Script=Cyrillic}/u,
  [AvailableTranslationLanguagesE.zh]: /\p{Script=Han}/u,
  [AvailableTranslationLanguagesE.ar]: /\p{Script=Arabic}/u,
  [AvailableTranslationLanguagesE.es]: /\p{Script=Latin}/u,
  [AvailableTranslationLanguagesE.fr]: /\p{Script=Latin}/u,
  [AvailableTranslationLanguagesE.de]: /\p{Script=Latin}/u,
  [AvailableTranslationLanguagesE.pt]: /\p{Script=Latin}/u,
};

// the varieties Wiktionary files under `zh` next to Mandarin
const CHINESE_VARIETIES = ['Dungan', 'Hokkien', 'Cantonese', 'Hakka', 'Wu', 'Gan', 'Xiang', 'Teochew', 'Jin'];

const NON_LATIN = new Set([
  AvailableTranslationLanguagesE.ru,
  AvailableTranslationLanguagesE.zh,
  AvailableTranslationLanguagesE.ar,
]);
// what is left of the wiki markup and of the notes of an editor when their brackets do not close
const MARKUP = /[[\](){}<>|&=*#/\\]/;
const TRANSLATION_MAX_LENGTH = 80;

/**
 * A translation as the word itself. The editors of Wiktionary annotate
 * translations in place — "resistir (sin ceder)", "[un] agua", "общага f",
 * "дело труба /business is a pipe/" — and the extract hands the text on as
 * it is. The notes are taken off; what still carries markup after that is
 * not a word ('' is answered) rather than a translation with a flaw.
 */
export const cleanTranslation = (word: string, language: AvailableTranslationLanguagesE): string => {
  let plain = word.normalize('NFC').trim();
  // "詞典 /词典": the traditional and the simplified spelling; the simplified one is kept
  if (language === AvailableTranslationLanguagesE.zh && /^[^/]+\/[^/]+$/.test(plain)) {
    plain = plain.split('/')[1];
  }
  plain = plain
    // a note in brackets, a gloss between slashes
    .replace(/\([^()]*\)|\[[^[\]]*\]|\/[^/]+\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // the stress mark of a Russian headword is a reading aid, not a part of the spelling
  if (language === AvailableTranslationLanguagesE.ru) plain = plain.replace(/\u0301/g, '');
  // a word written in another script ends where the grammar of the editor begins: the gender,
  // the aspect, another spelling — "общага f", "пердеть impf пёрднуть", "لِيرَة f or لَيْرَة"
  if (NON_LATIN.has(language)) {
    // a label in front names a dialect or a register: "Hijazi Arabic وحش" is not the standard word
    if (/^[A-Za-z][A-Za-z.:]*\s/.test(plain)) return '';
    plain = plain.replace(/\s+[a-z]+(?:\s.*)?$/, '');
  }
  plain = plain.replace(/^[\s,;:.~-]+|[\s,;:~-]+$/g, '');
  if (!plain || plain.length > TRANSLATION_MAX_LENGTH || MARKUP.test(plain)) return '';
  return plain;
};

const translationsOf = (items: KaikkiTranslationT[]): ConvertedTranslationT[] => {
  const byLanguage = new Map<AvailableTranslationLanguagesE, string[]>();
  for (const item of items) {
    const language = LANGUAGES[item.lang_code ?? item.code ?? ''];
    if (!language) continue;
    if (
      language === AvailableTranslationLanguagesE.zh &&
      ((item.lang !== undefined && !/^Chinese( Mandarin)?$/.test(item.lang)) ||
        has(item.tags, ...CHINESE_VARIETIES))
    ) {
      continue;
    }
    const word = cleanTranslation(item.word ?? '', language);
    if (!word || !SCRIPTS[language].test(word)) continue;
    const words = byLanguage.get(language) ?? [];
    if (!words.includes(word) && words.length < TRANSLATION_WORDS) words.push(word);
    byLanguage.set(language, words);
  }
  return [...byLanguage.entries()].map(([language, words]) => ({ language, words }));
};

const tokens = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((token) => token.length > 2),
  );

/**
 * The meaning a translation filed under the entry belongs to. Wiktionary
 * groups the translations of a page under short summaries of its senses
 * ("to move quickly"), not under the senses themselves: the meaning whose
 * definition shares the most words with the summary takes them, the first
 * meaning when none shares any
 */
const meaningOf = (summary: string, meanings: ConvertedMeaningT[]): ConvertedMeaningT => {
  const wanted = tokens(summary);
  let best = meanings[0];
  let bestScore = 0;
  for (const meaning of meanings) {
    const found = tokens(meaning.definition);
    let score = 0;
    for (const token of wanted) if (found.has(token)) score += 1;
    if (score > bestScore) {
      best = meaning;
      bestScore = score;
    }
  }
  return best;
};

const FORMS: ReadonlyArray<[EnWordFormsE, string[]]> = [
  [EnWordFormsE.third_person_singular, ['present', 'singular', 'third-person']],
  [EnWordFormsE.present_participle, ['participle', 'present']],
  [EnWordFormsE.past_participle, ['participle', 'past']],
  [EnWordFormsE.past_simple, ['past']],
  [EnWordFormsE.plural_form, ['plural']],
  [EnWordFormsE.comparative_form, ['comparative']],
  [EnWordFormsE.superlative_form, ['superlative']],
];

// a form the dictionary does not list as the word's own: another spelling, a dialect, a dead one
const FORM_NOISE = [
  'alternative',
  'obsolete',
  'archaic',
  'dialectal',
  'dated',
  'rare',
  'nonstandard',
  'colloquial',
];

const formsOf = (record: KaikkiRecordT): ConvertedFormT[] => {
  const forms: ConvertedFormT[] = [];
  for (const form of record.forms ?? []) {
    const word = (form.form ?? '').trim();
    const tags = form.tags ?? [];
    if (!word || word === '-' || word.length > HEADWORD_MAX_LENGTH || has(tags, ...FORM_NOISE)) continue;
    // the exact set of tags: "past" alone is the simple past, with "participle" the participle
    const kind = FORMS.find(
      ([, wanted]) => wanted.length === tags.length && wanted.every((tag) => tags.includes(tag)),
    )?.[0];
    if (kind && !forms.some((known) => known.word === word && known.form_of_word === kind)) {
      forms.push({ word, form_of_word: kind });
    }
  }
  return forms;
};

const transcriptionOf = (record: KaikkiRecordT): string => {
  const sounds = (record.sounds ?? []).filter((sound) => sound.ipa);
  const preferred =
    sounds.find((sound) => has(sound.tags, 'General-American', 'US')) ??
    sounds.find((sound) => has(sound.tags, 'Received-Pronunciation', 'UK')) ??
    sounds[0];
  return preferred?.ipa?.trim() ?? '';
};

/** One record of the extract as an entry; a string says why it is left out */
export const convertRecord = (
  record: KaikkiRecordT,
):
  | ConvertedEntryT
  | 'other_language'
  | 'unsupported_part_of_speech'
  | 'no_definition'
  | 'form_or_alternative'
  | 'headword_too_long'
  | 'malformed' => {
  const word = (record.word ?? '').trim();
  if (!word || !record.pos || !Array.isArray(record.senses)) return 'malformed';
  if (record.lang_code !== 'en') return 'other_language';
  if (word.length > HEADWORD_MAX_LENGTH) return 'headword_too_long';
  let partOfSpeech = PARTS_OF_SPEECH[record.pos];
  if (!partOfSpeech) return 'unsupported_part_of_speech';

  // an inflected form or another spelling of a word has a page of its own in
  // Wiktionary; here it is a form of its entry, or nothing
  const own = record.senses.filter((sense) => !sense.form_of?.length && !sense.alt_of?.length);
  if (own.length === 0) return 'form_or_alternative';

  const meanings: ConvertedMeaningT[] = [];
  for (const sense of own) {
    // the glosses of a sub-sense run from the general to the particular
    const definition = (sense.glosses ?? []).at(-1)?.trim();
    if (!definition || has(sense.tags, 'no-gloss')) continue;
    const tags = sense.tags ?? [];
    meanings.push({
      definition,
      examples: (sense.examples ?? [])
        .map((example) => (example.text ?? '').replace(/\s+/g, ' ').trim())
        .filter((text) => text && text.length <= EXAMPLE_MAX_LENGTH)
        .slice(0, EXAMPLES),
      is_obsolete: has(tags, 'obsolete', 'archaic'),
      area_variant: firstMatch(AREAS, tags) || EnAreaVariantsE.common,
      language_register: firstMatch(REGISTERS, tags),
      categories: categoriesOf(sense.topics ?? []),
      synonyms: linkedWords(sense.synonyms, word),
      antonyms: linkedWords(sense.antonyms, word),
      translations: translationsOf(sense.translations ?? []),
    });
  }
  if (meanings.length === 0) return 'no_definition';

  // what the page files under the entry rather than under a sense
  const bySummary = new Map<string, KaikkiTranslationT[]>();
  for (const translation of record.translations ?? []) {
    const summary = translation.sense ?? '';
    bySummary.set(summary, [...(bySummary.get(summary) ?? []), translation]);
  }
  for (const [summary, items] of bySummary) {
    const meaning = meaningOf(summary, meanings);
    for (const translation of translationsOf(items)) {
      const known = meaning.translations.find((item) => item.language === translation.language);
      if (!known) meaning.translations.push(translation);
      else {
        for (const item of translation.words) {
          if (!known.words.includes(item) && known.words.length < TRANSLATION_WORDS) known.words.push(item);
        }
      }
    }
  }
  for (const kind of ['synonyms', 'antonyms'] as const) {
    for (const link of record[kind] ?? []) {
      const linked = linkedWords([link], word);
      if (linked.length === 0) continue;
      const meaning = meaningOf(link.sense ?? '', meanings);
      if (!meaning[kind].includes(linked[0])) meaning[kind].push(linked[0]);
    }
  }
  // a word is not both a synonym and an antonym of one meaning: the synonym stays
  for (const meaning of meanings) {
    meaning.antonyms = meaning.antonyms.filter((antonym) => !meaning.synonyms.includes(antonym));
  }

  const allTags = own.flatMap((sense) => sense.tags ?? []);
  if (partOfSpeech === EnPartOfSpeechE.verb && MODAL_VERBS.has(word) && allTags.includes('modal')) {
    partOfSpeech = EnPartOfSpeechE.modal_verb;
  }
  const entry = emptyEntry(word, partOfSpeech);
  entry.meanings = meanings;
  entry.transcription = transcriptionOf(record);
  entry.is_obsolete = meanings.every((meaning) => meaning.is_obsolete);
  // a word of one etymology nobody uses any more ("limp" as "to happen", past "lamp"): its forms
  // are listed as dead, and say nothing about the living word of the same spelling
  const forms = partOfSpeech === EnPartOfSpeechE.phrase ? [] : formsOf(record);
  entry.forms = entry.is_obsolete ? forms.map((form) => ({ ...form, is_obsolete: true })) : forms;
  const living = entry.forms.filter((form) => !form.is_obsolete);
  entry.is_abbreviation = own.every((sense) => has(sense.tags, 'abbreviation', 'initialism', 'acronym'));
  // what every meaning shares is the entry's own
  const shared = <T>(values: T[]): T | '' => (values.every((value) => value === values[0]) ? values[0] : '');
  entry.language_register = shared(meanings.map((meaning) => meaning.language_register));
  const area = shared(meanings.map((meaning) => meaning.area_variant));
  entry.area_variant = area === EnAreaVariantsE.common ? '' : area;
  entry.categories = [...new Set(meanings.flatMap((meaning) => meaning.categories))];

  if (partOfSpeech === EnPartOfSpeechE.noun) {
    entry.noun___is_proper = record.pos === 'name';
    entry.noun___uncountable = allTags.includes('uncountable') && !allTags.includes('countable');
    entry.noun___always_plural = own.every((sense) => has(sense.tags, 'plural-only'));
    entry.noun___irregular_plural = living.some(
      (form) =>
        form.form_of_word === EnWordFormsE.plural_form &&
        !isRegularForm(word, form.word, EnWordFormsE.plural_form),
    );
  }
  if (partOfSpeech === EnPartOfSpeechE.verb) {
    const transitive = allTags.includes('transitive') || allTags.includes('ambitransitive');
    const intransitive = allTags.includes('intransitive') || allTags.includes('ambitransitive');
    entry.verb___transitivity =
      transitive && intransitive
        ? EnVerbTransitivityE.both
        : transitive
          ? EnVerbTransitivityE.transitive
          : intransitive
            ? EnVerbTransitivityE.intransitive
            : '';
    entry.verb___is_irregular = living.some(
      (form) =>
        (form.form_of_word === EnWordFormsE.past_simple ||
          form.form_of_word === EnWordFormsE.past_participle) &&
        !isRegularForm(word, form.word, form.form_of_word),
    );
    const base = phrasalBaseOf(word, partOfSpeech);
    if (base) {
      entry.verb___is_phrasal = true;
      entry.base_phrasal = base;
    }
  }
  return entry;
};

export const wiktionary: SourceAdapterT = {
  name: 'wiktionary',
  description:
    'the English Wiktionary as kaikki.org extracts it: kaikki.org-dictionary-English.jsonl (or .jsonl.gz)',
  provenance: (options) => termsOfAdapter('wiktionary', options),
  // the extract carries no date in its lines; the gzip it travels in does
  versionOf: (input) => versionOfExtract(input),
  async convert(input, _options, context) {
    let read = 0;
    for await (const line of readLines(input, context.progress)) {
      if (!line.trim()) continue;
      if (context.limit !== undefined && read >= context.limit) break;
      read += 1;
      let record: KaikkiRecordT;
      try {
        record = JSON.parse(line) as KaikkiRecordT;
      } catch {
        context.skip('malformed');
        continue;
      }
      const converted = convertRecord(record);
      if (typeof converted === 'string') context.skip(converted);
      else await context.emit(converted);
      if (read % 100_000 === 0) context.log(`${read} records read`);
    }
  },
};
