import { CategoryE, EnPartOfSpeechE, EnWordFormsE } from '../../types';
import { ConvertedEntryT, ConvertedFormT, ConvertedMeaningT } from './types';

// What every adapter needs and no source provides (issue #527): a title for
// a meaning, the entry two records of one headword merge into, the particles
// that make a verb a phrasal one

const TITLE_MAX_LENGTH = 60;

/**
 * The title of a meaning, which the model requires and neither Wiktionary
 * nor WordNet has: the head of the definition — its first clause, cut at a
 * word, without the closing period
 */
export const titleOf = (definition: string): string => {
  const plain = definition
    .replace(/\s+/g, ' ')
    // a leading label in parentheses says how the word is used, not what it means
    .replace(/^(\([^)]*\)\s*)+/, '')
    .trim();
  const clause = plain.split(/[;:.](\s|$)/)[0].trim() || plain;
  if (clause.length <= TITLE_MAX_LENGTH) return clause.replace(/[.,;:]+$/, '') || definition.trim();
  const cut = clause.slice(0, TITLE_MAX_LENGTH);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 20));
  return `${atWord.replace(/[.,;:\s]+$/, '')}…`;
};

const unique = <T>(items: T[]): T[] => [...new Set(items)];

// a form two records share is listed once, and lives when one of them says so
const mergeForms = (a: ConvertedFormT[], b: ConvertedFormT[]): ConvertedFormT[] => {
  const merged = new Map<string, ConvertedFormT>();
  for (const form of [...a, ...b]) {
    const key = `${form.form_of_word} ${form.word}`;
    const known = merged.get(key);
    if (!known) merged.set(key, { ...form });
    else if (known.is_obsolete && !form.is_obsolete) known.is_obsolete = false;
  }
  return [...merged.values()];
};

const sameMeaning = (a: ConvertedMeaningT, b: ConvertedMeaningT): boolean =>
  a.definition.trim().toLowerCase() === b.definition.trim().toLowerCase();

/**
 * Two records of one headword and part of speech as one entry: a source
 * may split them (the etymology sections of Wiktionary), the model has one
 * entry per pair. The meanings follow each other, a repeated definition is
 * kept once; what one record knows and the other does not is kept
 */
export const mergeEntries = (first: ConvertedEntryT, second: ConvertedEntryT): ConvertedEntryT => ({
  ...first,
  transcription: first.transcription || second.transcription,
  area_variant: first.area_variant || second.area_variant,
  language_register: first.language_register || second.language_register,
  categories: unique([...first.categories, ...second.categories]) as CategoryE[],
  is_obsolete: first.is_obsolete && second.is_obsolete,
  is_abbreviation: first.is_abbreviation || second.is_abbreviation,
  noun___is_proper: first.noun___is_proper || second.noun___is_proper,
  noun___uncountable: first.noun___uncountable && second.noun___uncountable,
  noun___always_plural: first.noun___always_plural && second.noun___always_plural,
  noun___irregular_plural: first.noun___irregular_plural || second.noun___irregular_plural,
  verb___is_irregular: first.verb___is_irregular || second.verb___is_irregular,
  verb___is_phrasal: first.verb___is_phrasal || second.verb___is_phrasal,
  verb___transitivity:
    first.verb___transitivity &&
    second.verb___transitivity &&
    first.verb___transitivity !== second.verb___transitivity
      ? ('both' as ConvertedEntryT['verb___transitivity'])
      : first.verb___transitivity || second.verb___transitivity,
  base_phrasal: first.base_phrasal || second.base_phrasal,
  forms: mergeForms(first.forms, second.forms),
  meanings: [
    ...first.meanings,
    ...second.meanings.filter((meaning) => !first.meanings.some((known) => sameMeaning(known, meaning))),
  ],
});

// the second word of a phrasal verb: an adverb or a preposition
const PARTICLES = new Set(
  (
    'about across after against ahead along among apart around as aside at away back before behind by ' +
    'down for forth forward from in into off on onto out over past round through to together towards ' +
    'under up upon with without'
  ).split(' '),
);

/** The base verb of "give up", "look forward to" — a verb followed by particles only; null otherwise */
export const phrasalBaseOf = (word: string, partOfSpeech: EnPartOfSpeechE): string | null => {
  if (partOfSpeech !== EnPartOfSpeechE.verb) return null;
  const [base, ...rest] = word.split(' ');
  if (rest.length === 0 || rest.length > 2 || !/^[a-z]+$/.test(base)) return null;
  return rest.every((token) => PARTICLES.has(token)) ? base : null;
};

const isRegularWord = (b: string, f: string, kind: EnWordFormsE): boolean => {
  if (kind === EnWordFormsE.plural_form) {
    return f === `${b}s` || f === `${b}es` || (b.endsWith('y') && f === `${b.slice(0, -1)}ies`);
  }
  return (
    f === `${b}ed` ||
    (b.endsWith('e') && f === `${b}d`) ||
    (b.endsWith('y') && f === `${b.slice(0, -1)}ied`) ||
    // a doubled final consonant: stop → stopped; panic → panicked
    (b.length > 1 && f === `${b}${b[b.length - 1]}ed`) ||
    (b.endsWith('c') && f === `${b}ked`)
  );
};

/**
 * Whether the plural / the past of a word is built by the rule, from the
 * form itself. A headword of several words inflects some of them ("watch
 * it" → "watched it", "clean and jerk" → "cleaned and jerked"): it follows
 * the rule when every word that changed does.
 */
export const isRegularForm = (base: string, form: string, kind: EnWordFormsE): boolean => {
  if (
    kind !== EnWordFormsE.plural_form &&
    kind !== EnWordFormsE.past_simple &&
    kind !== EnWordFormsE.past_participle
  ) {
    return true;
  }
  const words = base.toLowerCase().split(' ');
  const inflected = form.toLowerCase().split(' ');
  if (words.length !== inflected.length) return false;
  return words.every((word, index) => word === inflected[index] || isRegularWord(word, inflected[index], kind));
};

/** An entry with nothing set, for an adapter to fill */
export const emptyEntry = (word: string, partOfSpeech: EnPartOfSpeechE): ConvertedEntryT => ({
  word,
  part_of_speech: partOfSpeech,
  transcription: '',
  area_variant: '',
  language_register: '',
  categories: [],
  is_obsolete: false,
  is_abbreviation: false,
  noun___is_proper: false,
  noun___uncountable: false,
  noun___always_plural: false,
  noun___irregular_plural: false,
  verb___is_irregular: false,
  verb___is_phrasal: false,
  verb___transitivity: '',
  base_phrasal: '',
  forms: [],
  meanings: [],
});
