import { describe, expect, it } from '@jest/globals';
import { EnPartOfSpeechE, EnVerbTransitivityE, EnWordFormsE, LanguageRegisterE } from '../../../types';
import { emptyEntry, isRegularForm, mergeEntries, phrasalBaseOf, titleOf } from '../normalize';
import { ConvertedMeaningT } from '../types';

const meaning = (definition: string, extra: Partial<ConvertedMeaningT> = {}): ConvertedMeaningT => ({
  definition,
  examples: [],
  is_obsolete: false,
  area_variant: 'common' as ConvertedMeaningT['area_variant'],
  language_register: '',
  categories: [],
  synonyms: [],
  antonyms: [],
  translations: [],
  ...extra,
});

// What every adapter needs and no source provides (issue #527)
describe('titleOf', () => {
  it('takes the first clause of a definition, without its period', () => {
    expect(titleOf('A device that gives light.')).toBe('A device that gives light');
    expect(titleOf('To move fast; to hurry.')).toBe('To move fast');
    expect(titleOf("move fast by using one's feet, with one foot off the ground")).toBe(
      "move fast by using one's feet, with one foot off the ground",
    );
  });

  it('drops a leading label in parentheses and cuts a long clause at a word', () => {
    expect(titleOf('(slang) (UK) A heavy blow.')).toBe('A heavy blow');
    const long = titleOf(
      'having desirable or positive qualities especially those suitable for a thing specified by the context',
    );
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long).toMatch(/^having desirable or positive qualities.*…$/);
    expect(long).not.toMatch(/\s…$/);
  });

  it('never answers an empty title', () => {
    expect(titleOf('.')).toBe('.');
    expect(titleOf('(obsolete)')).toBe('(obsolete)');
  });
});

describe('mergeEntries', () => {
  it('joins the records of one headword and part of speech into one entry', () => {
    const first = {
      ...emptyEntry('lamp', EnPartOfSpeechE.noun),
      transcription: '/læmp/',
      forms: [{ word: 'lamps', form_of_word: EnWordFormsE.plural_form }],
      meanings: [meaning('A device that gives light.')],
      noun___uncountable: true,
    };
    const second = {
      ...emptyEntry('lamp', EnPartOfSpeechE.noun),
      language_register: LanguageRegisterE.slang,
      forms: [{ word: 'lamps', form_of_word: EnWordFormsE.plural_form }],
      meanings: [meaning('A heavy blow.'), meaning('a device that gives light. ')],
    };

    const merged = mergeEntries(first, second);

    expect(merged.transcription).toBe('/læmp/');
    expect(merged.meanings.map((item) => item.definition)).toEqual([
      'A device that gives light.',
      'A heavy blow.',
    ]);
    expect(merged.forms).toEqual([{ word: 'lamps', form_of_word: EnWordFormsE.plural_form }]);
    // what only one of the records says about every meaning is not true of the entry
    expect(merged.noun___uncountable).toBe(false);
    expect(merged.language_register).toBe(LanguageRegisterE.slang);
  });

  it('calls a verb both transitive and intransitive when its records disagree', () => {
    const transitive = {
      ...emptyEntry('run', EnPartOfSpeechE.verb),
      verb___transitivity: EnVerbTransitivityE.transitive,
    };
    const intransitive = {
      ...emptyEntry('run', EnPartOfSpeechE.verb),
      verb___transitivity: EnVerbTransitivityE.intransitive,
    };
    expect(mergeEntries(transitive, intransitive).verb___transitivity).toBe(EnVerbTransitivityE.both);
    expect(mergeEntries(transitive, emptyEntry('run', EnPartOfSpeechE.verb)).verb___transitivity).toBe(
      EnVerbTransitivityE.transitive,
    );
  });
});

describe('phrasalBaseOf', () => {
  it('names the base verb of a verb followed by particles', () => {
    expect(phrasalBaseOf('give up', EnPartOfSpeechE.verb)).toBe('give');
    expect(phrasalBaseOf('look forward to', EnPartOfSpeechE.verb)).toBe('look');
  });

  it('is null for anything else', () => {
    expect(phrasalBaseOf('give', EnPartOfSpeechE.verb)).toBeNull();
    expect(phrasalBaseOf('rain cats and dogs', EnPartOfSpeechE.verb)).toBeNull();
    expect(phrasalBaseOf('black market', EnPartOfSpeechE.verb)).toBeNull();
    expect(phrasalBaseOf('hot up', EnPartOfSpeechE.noun)).toBeNull();
  });
});

describe('mergeEntries: the forms', () => {
  it('lists a form once, alive when one of the records says so', () => {
    const living = {
      ...emptyEntry('limp', EnPartOfSpeechE.verb),
      forms: [{ word: 'limped', form_of_word: EnWordFormsE.past_simple }],
    };
    const dead = {
      ...emptyEntry('limp', EnPartOfSpeechE.verb),
      forms: [
        { word: 'limped', form_of_word: EnWordFormsE.past_simple, is_obsolete: true },
        { word: 'lamp', form_of_word: EnWordFormsE.past_simple, is_obsolete: true },
      ],
    };

    const expected = [
      { word: 'limped', form_of_word: EnWordFormsE.past_simple },
      { word: 'lamp', form_of_word: EnWordFormsE.past_simple, is_obsolete: true },
    ];
    expect(mergeEntries(living, dead).forms).toEqual(expected);
    expect(mergeEntries(dead, living).forms).toEqual([
      { word: 'limped', form_of_word: EnWordFormsE.past_simple, is_obsolete: false },
      { word: 'lamp', form_of_word: EnWordFormsE.past_simple, is_obsolete: true },
    ]);
  });
});

describe('isRegularForm', () => {
  it('knows the plural and the past that follow the rule', () => {
    expect(isRegularForm('lamp', 'lamps', EnWordFormsE.plural_form)).toBe(true);
    expect(isRegularForm('box', 'boxes', EnWordFormsE.plural_form)).toBe(true);
    expect(isRegularForm('city', 'cities', EnWordFormsE.plural_form)).toBe(true);
    expect(isRegularForm('mouse', 'mice', EnWordFormsE.plural_form)).toBe(false);
    expect(isRegularForm('walk', 'walked', EnWordFormsE.past_simple)).toBe(true);
    expect(isRegularForm('bake', 'baked', EnWordFormsE.past_simple)).toBe(true);
    expect(isRegularForm('stop', 'stopped', EnWordFormsE.past_participle)).toBe(true);
    expect(isRegularForm('carry', 'carried', EnWordFormsE.past_simple)).toBe(true);
    expect(isRegularForm('take', 'took', EnWordFormsE.past_simple)).toBe(false);
    expect(isRegularForm('take', 'taken', EnWordFormsE.past_participle)).toBe(false);
    expect(isRegularForm('panic', 'panicked', EnWordFormsE.past_simple)).toBe(true);
  });

  // seen in the full extract of Wiktionary: a third of the verbs flagged as irregular
  it('judges a headword of several words by the words that changed', () => {
    expect(isRegularForm('watch it', 'watched it', EnWordFormsE.past_simple)).toBe(true);
    expect(isRegularForm('play around', 'played around', EnWordFormsE.past_participle)).toBe(true);
    expect(isRegularForm('clean and jerk', 'cleaned and jerked', EnWordFormsE.past_simple)).toBe(true);
    expect(isRegularForm('clean and jerk', 'clean and jerked', EnWordFormsE.past_simple)).toBe(true);
    expect(isRegularForm('attorney general', 'attorneys general', EnWordFormsE.plural_form)).toBe(true);
    expect(isRegularForm('wear out', 'wore out', EnWordFormsE.past_simple)).toBe(false);
    expect(isRegularForm('grow apart', 'grown apart', EnWordFormsE.past_participle)).toBe(false);
    expect(isRegularForm('give up', 'gave', EnWordFormsE.past_simple)).toBe(false);
  });

  it('has nothing to say about the forms every word builds the same way', () => {
    expect(isRegularForm('run', 'running', EnWordFormsE.present_participle)).toBe(true);
    expect(isRegularForm('good', 'better', EnWordFormsE.comparative_form)).toBe(true);
  });
});
