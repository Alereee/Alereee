import './helpers/clearDatabaseUrl';
import { WordRowsService } from '../word-rows.service';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { DICTIONARY_ENTITIES } from '../entities/dictionary-entities';
import { EnChange } from '../entities/en_change.entity';
import { EnEntry } from '../entities/en_entry.entity';
import { EnWord } from '../entities/en_word.entity';
import { EnMeaning } from '../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../entities/en_short_translation.entity';
import { Suggestion } from '../../SuggestionsModule/entities/suggestion.entity';
import { EnService } from '../en.service';
import { EnShortTranslationService } from '../modules/EnShortTranslation/enShortTranslation.service';
import { EnMeaningService } from '../modules/EnMeaning/enMeaning.service';
import { EnMeaningTranslationService } from '../modules/EnMeaningTranslation/enMeaningTranslation.service';
import { EnChangesService } from '../modules/EnChanges/enChanges.service';
import { ARTICLE_RELATIONS, findArticle } from '../utils/changes/articles';
import { articleSnapshot } from '../utils/changes/snapshots';
import { withChangeSource } from '../utils/changes/context';
import {
  AvailableTranslationLanguagesE,
  ChangeActionE,
  ChangeEntityE,
  ChangeOriginE,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnWordFormsE,
} from '../../../../types';
import { AddWordReqDTO } from '../dto/AddWordReq.dto';

// Taking a change back (issue #531): the record gets the values it had, the
// history says so, and the entry stops being shown as modified
describe('taking a change back', () => {
  let ds: DataSource;
  let words: EnService;
  let meanings: EnMeaningService;
  let translations: EnMeaningTranslationService;
  let shorts: EnShortTranslationService;
  let changes: EnChangesService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [...DICTIONARY_ENTITIES, Suggestion],
      synchronize: true,
    });
    await ds.initialize();

    shorts = new EnShortTranslationService(ds.getRepository(EnWord), ds.getRepository(EnShortTranslation));
    translations = new EnMeaningTranslationService(
      ds.getRepository(EnMeaning),
      ds.getRepository(EnMeaningTranslation),
    );
    meanings = new EnMeaningService(ds.getRepository(EnWord), ds.getRepository(EnMeaning), translations);
    words = new EnService(ds.getRepository(EnWord), ds, shorts, meanings, new WordRowsService(ds));
    changes = new EnChangesService(ds);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.synchronize(true);
  });

  const idOf = (res: object): number => (res as { id: number }).id;
  const history = async (): Promise<EnChange[]> => ds.getRepository(EnChange).find({ order: { id: 'ASC' } });
  const last = async (): Promise<EnChange> => (await history()).at(-1) as EnChange;
  const entry = async (word: string): Promise<EnEntry | null> => ds.getRepository(EnEntry).findOneBy({ word });
  const article = async (word: string, pos = 'noun'): Promise<EnWord | null> =>
    findArticle(ds.manager, word, pos);

  // an entry as an import leaves it: no history, not kept through updates
  const imported = async (word: string, pos = EnPartOfSpeechE.noun): Promise<EnWord> => {
    const saved = await ds.getRepository(EnEntry).save({ word });
    return ds.getRepository(EnWord).save({
      word: saved,
      part_of_speech: pos,
      form_of_word: EnWordFormsE.base_form,
      description: `the word ${word}`,
      generated: false,
    });
  };

  const lamp = (): AddWordReqDTO =>
    ({
      word: 'lamp',
      part_of_speech: EnPartOfSpeechE.noun,
      form_of_word: EnWordFormsE.base_form,
      description: 'a device that gives light',
      transcription: '/læmp/',
      generated: false,
      forms: [{ word: 'lamps', form_of_word: EnWordFormsE.plural_form, area_variant: EnAreaVariantsE.common }],
      meanings: [
        {
          title: 'a light',
          definition: 'A device that gives light.',
          sort_order: 1,
          is_obsolete: false,
          examples: ['Turn on the lamp.'],
          area_variant: EnAreaVariantsE.common,
          synonyms: ['light'],
          translations: [
            {
              language: AvailableTranslationLanguagesE.ru,
              title: 'лампа',
              definition: 'Устройство, дающее свет.',
              variants_of_words: ['лампа'],
            },
          ],
        },
      ],
      short_translations: [
        { language: AvailableTranslationLanguagesE.ru, description: 'лампа', variants_of_words: ['лампа'] },
      ],
    }) as unknown as AddWordReqDTO;

  const addMeaning = async (wordId: number, title = 'a light', sortOrder = 1) =>
    idOf(
      await meanings.addMeaning({
        word_id: wordId,
        title,
        definition: 'A device that gives light.',
        sort_order: sortOrder,
        is_obsolete: false,
        examples: ['Turn on the lamp.'],
        area_variant: EnAreaVariantsE.common,
        synonyms: ['light'],
        translations: [
          {
            language: AvailableTranslationLanguagesE.de,
            title: 'Lampe',
            definition: 'Ein Gerät.',
            variants_of_words: ['Lampe'],
          },
        ],
      } as never),
    );

  it('gives a word the values it had, and the entry is what its source says again', async () => {
    const word = await imported('lamp');
    await words.editWord(word.id, {
      description: 'a device that produces light',
      transcription: '/læmp/',
      is_obsolete: true,
    });
    const edit = await last();

    expect(await changes.revert(edit.id)).toEqual({ success: true });

    const now = (await article('lamp')) as EnWord;
    expect(now.description).toBe('the word lamp');
    // a value that was empty is empty again, which no edit form can do
    expect(now.transcription).toBeNull();
    expect(now.is_obsolete).toBe(false);

    const rows = await history();
    expect(rows).toHaveLength(2);
    expect(rows[0].superseded_at).not.toBeNull();
    expect(rows[1]).toEqual(
      expect.objectContaining({
        headword: 'lamp',
        part_of_speech: 'noun',
        entity: 'word',
        action: 'update',
        origin: 'revert',
        diff: {
          description: { before: 'a device that produces light', after: 'the word lamp' },
          transcription: { before: '/læmp/', after: null },
          is_obsolete: { before: true, after: false },
          // the last change of the entry: it is the one its dataset had again
          version: { before: 'custom_version', after: word.version },
        },
      }),
    );
    expect(now.version).toBe(word.version);
    // what restores is no modification
    expect(rows[1].superseded_at).not.toBeNull();
    expect((await entry('lamp'))?.user_modified).toBe(false);
  });

  it('gives the entry its version back with the last change of it, not before', async () => {
    const word = await imported('lamp');
    await imported('light');
    const version = async () => ((await article('lamp')) as EnWord).version;

    await words.editWord(word.id, { description: 'a device that produces light' });
    const common = await last();
    const meaningId = await addMeaning(word.id);
    const meaning = await last();
    expect(await version()).toBe('custom_version');

    // a change of the entry still shows: the entry is the owner's version of it
    await changes.revert(common.id);
    expect(((await article('lamp')) as EnWord).description).toBe('the word lamp');
    expect(await version()).toBe('custom_version');
    expect((await last()).diff).toEqual({
      description: { before: 'a device that produces light', after: 'the word lamp' },
    });

    await changes.revert(meaning.id);
    expect(await ds.getRepository(EnMeaning).countBy({ id: meaningId })).toBe(0);
    expect(await version()).toBe(word.version);
    expect((await entry('lamp'))?.user_modified).toBe(false);

    // the next edit makes the entry the owner's again, and records the version anew
    await words.editWord(word.id, { description: 'a lamp' });
    expect(await version()).toBe('custom_version');
    expect((await last()).diff!.version).toEqual({ before: word.version, after: 'custom_version' });
  });

  it('leaves the version of an entry that was edited before the history kept it', async () => {
    const word = await imported('lamp');
    await ds.getRepository(EnWord).update({ id: word.id }, { version: 'custom_version' });
    await words.editWord(word.id, { description: 'a device that produces light' });
    const edit = await last();
    expect(edit.diff).toEqual({
      description: { before: 'the word lamp', after: 'a device that produces light' },
    });

    await changes.revert(edit.id);

    // what the version was is not known: nothing is guessed
    expect(((await article('lamp')) as EnWord).version).toBe('custom_version');
    expect(((await article('lamp')) as EnWord).description).toBe('the word lamp');
  });

  it('brings a deleted word back under the version it had', async () => {
    const word = await imported('lamp');
    await ds.getRepository(EnWord).update({ id: word.id }, { version: '2026.09.27' });
    await words.deleteWord(word.id);
    const deletion = await last();
    expect(deletion.diff!.version).toEqual({ before: '2026.09.27', after: null });

    await changes.revert(deletion.id);

    expect(((await article('lamp')) as EnWord).version).toBe('2026.09.27');
  });

  it('undoes a history from its end: a later edit of the same field goes first', async () => {
    const word = await imported('lamp');
    await words.editWord(word.id, { description: 'first' });
    const first = await last();
    await words.editWord(word.id, { description: 'second' });
    const second = await last();

    await expect(changes.revert(first.id)).rejects.toMatchObject({ message: 'change_outdated' });
    expect(((await article('lamp')) as EnWord).description).toBe('second');
    expect(await history()).toHaveLength(2);

    await changes.revert(second.id);
    // one edit still shows: the entry stays kept through the updates
    expect((await entry('lamp'))?.user_modified).toBe(true);
    await changes.revert(first.id);
    expect(((await article('lamp')) as EnWord).description).toBe('the word lamp');
    expect((await entry('lamp'))?.user_modified).toBe(false);
  });

  it('leaves an edit of another field alone', async () => {
    const word = await imported('lamp');
    await words.editWord(word.id, { description: 'a device that produces light' });
    const first = await last();
    await words.editWord(word.id, { transcription: '/læmp/' });

    await changes.revert(first.id);

    const now = (await article('lamp')) as EnWord;
    expect(now.description).toBe('the word lamp');
    expect(now.transcription).toBe('/læmp/');
  });

  it('takes a created word out, with the entries of its forms', async () => {
    await imported('light');
    await words.addWord(lamp());
    const creation = await last();

    await changes.revert(creation.id);

    expect(await article('lamp')).toBeNull();
    expect(await entry('lamp')).toBeNull();
    expect(await entry('lamps')).toBeNull();
    expect(await entry('light')).not.toBeNull();
    expect(await ds.getRepository(EnMeaning).count()).toBe(0);
    expect(await last()).toEqual(
      expect.objectContaining({ entity: 'word', action: 'delete', origin: 'revert', headword: 'lamp' }),
    );
    expect((await last()).diff!.description).toEqual({ before: 'a device that gives light', after: null });
  });

  it('does not take a created word out while an edit of it stands', async () => {
    await imported('light');
    const created = await words.addWord(lamp());
    const creation = await last();
    await words.editWord(idOf(created), { description: 'a device that produces light' });

    await expect(changes.revert(creation.id)).rejects.toMatchObject({ message: 'change_outdated' });
    expect(await article('lamp')).not.toBeNull();
  });

  it('brings a deleted word back with everything it said', async () => {
    await imported('light');
    const created = await words.addWord(lamp());
    const said = articleSnapshot((await article('lamp')) as EnWord);
    await words.deleteWord(idOf(created));
    const deletion = await last();
    expect(await article('lamp')).toBeNull();

    await changes.revert(deletion.id);

    const back = (await article('lamp')) as EnWord;
    expect(articleSnapshot(back)).toEqual(said);
    expect(back.forms.map((form) => form.word.word)).toEqual(['lamps']);
    expect(back.meanings[0].synonyms.map((link) => link.word)).toEqual(['light']);
    expect(back.meanings[0].translations[0].title).toBe('лампа');
    expect(await last()).toEqual(
      expect.objectContaining({ entity: 'word', action: 'create', origin: 'revert' }),
    );

    // the word is there: the deletion cannot be taken back twice
    await expect(changes.revert(deletion.id)).rejects.toMatchObject({ message: 'change_not_revertible' });
  });

  it('takes back what was done to a form', async () => {
    const word = await imported('mouse');
    const added = await words.addWordForm({
      base_word_id: word.id,
      word: 'mice',
      form_of_word: EnWordFormsE.plural_form,
      area_variant: EnAreaVariantsE.common,
      transcription: '/maɪs/',
    });
    const creation = await last();
    await words.editWordForm({ id: idOf(added), word: 'mouses' });
    const edit = await last();

    await changes.revert(edit.id);
    expect(((await article('mouse')) as EnWord).forms.map((form) => form.word.word)).toEqual(['mice']);
    expect(await entry('mouses')).toBeNull();
    expect(await last()).toEqual(
      expect.objectContaining({
        entity: 'word_form',
        action: 'update',
        record: { word: 'mouses', form_of_word: 'plural_form' },
        diff: { word: { before: 'mouses', after: 'mice' } },
      }),
    );

    await words.deleteWord(idOf(added));
    const deletion = await last();
    await changes.revert(deletion.id);
    const forms = ((await article('mouse')) as EnWord).forms;
    expect(forms).toHaveLength(1);
    expect(forms[0]).toEqual(expect.objectContaining({ form_of_word: 'plural_form', transcription: '/maɪs/' }));

    await changes.revert(creation.id);
    expect(((await article('mouse')) as EnWord).forms).toEqual([]);
    expect(await entry('mice')).toBeNull();
    expect((await entry('mouse'))?.user_modified).toBe(false);
  });

  it('takes back what was done to a meaning, its links and its translations', async () => {
    const word = await imported('lamp');
    await imported('light');
    await imported('shade');
    const meaningId = await addMeaning(word.id);
    const creation = await last();

    await meanings.editMeaning({
      id: meaningId,
      title: 'a source of light',
      definition: 'Anything that gives light.',
      synonyms: [],
      antonyms: ['shade'],
    } as never);
    const edit = await last();

    await changes.revert(edit.id);
    let meaning = ((await article('lamp')) as EnWord).meanings[0];
    expect(meaning.title).toBe('a light');
    expect(meaning.definition).toBe('A device that gives light.');
    expect(meaning.synonyms.map((link) => link.word)).toEqual(['light']);
    expect(meaning.antonyms).toEqual([]);
    expect((await last()).record).toEqual({ title: 'a source of light', sort_order: 1 });

    await meanings.deleteMeaning(meaningId);
    const deletion = await last();
    await changes.revert(deletion.id);
    meaning = ((await article('lamp')) as EnWord).meanings[0];
    expect(meaning.title).toBe('a light');
    expect(meaning.examples).toEqual(['Turn on the lamp.']);
    expect(meaning.translations.map((translation) => translation.title)).toEqual(['Lampe']);
    expect(meaning.synonyms.map((link) => link.word)).toEqual(['light']);

    await changes.revert(creation.id);
    expect(((await article('lamp')) as EnWord).meanings).toEqual([]);
    expect(await ds.getRepository(EnMeaningTranslation).count()).toBe(0);
  });

  it('does not restore a link to a word that is gone, and says what it restored', async () => {
    const word = await imported('lamp');
    const light = await imported('light');
    const meaningId = await addMeaning(word.id);
    await meanings.deleteMeaning(meaningId);
    const deletion = await last();
    await ds.getRepository(EnWord).delete({ id: light.id });
    await ds.getRepository(EnEntry).delete({ word: 'light' });

    await changes.revert(deletion.id);

    expect(((await article('lamp')) as EnWord).meanings[0].synonyms).toEqual([]);
    expect((await last()).diff!.synonyms).toEqual({ before: null, after: [] });
  });

  it('takes back what was done to the translations', async () => {
    const word = await imported('lamp');
    await imported('light');
    const meaningId = await addMeaning(word.id);
    const added = await translations.addMeaningTranslation({
      meaning_id: meaningId,
      language: AvailableTranslationLanguagesE.ru,
      title: 'лампа',
      definition: 'Устройство, дающее свет.',
      variants_of_words: ['лампа'],
    } as never);
    const creation = await last();
    await translations.editMeaningTranslation({ id: idOf(added), title: 'светильник' } as never);
    await changes.revert((await last()).id);
    const titles = async () =>
      ((await article('lamp')) as EnWord).meanings[0].translations
        .map((translation) => translation.title)
        .sort();
    expect(await titles()).toEqual(['Lampe', 'лампа']);

    await translations.deleteMeaningTranslation(idOf(added));
    expect(await titles()).toEqual(['Lampe']);
    await changes.revert((await last()).id);
    expect(await titles()).toEqual(['Lampe', 'лампа']);

    await changes.revert(creation.id);
    expect(await titles()).toEqual(['Lampe']);

    const short = await shorts.addShortTranslation({
      word_id: word.id,
      language: AvailableTranslationLanguagesE.es,
      description: 'lámpara',
      variant_of_words: ['lámpara'],
    } as never);
    const shortCreation = await last();
    await shorts.editShortTranslation({ id: idOf(short), description: 'lámpara, farol' } as never);
    await changes.revert((await last()).id);
    const descriptions = async () =>
      ((await article('lamp')) as EnWord).short_translations.map((translation) => translation.description);
    expect(await descriptions()).toEqual(['lámpara']);

    await shorts.deleteShortTranslation(idOf(short));
    await changes.revert((await last()).id);
    expect(await descriptions()).toEqual(['lámpara']);
    expect(((await article('lamp')) as EnWord).short_translations[0].variants_of_words).toEqual(['lámpara']);

    await changes.revert(shortCreation.id);
    expect(await descriptions()).toEqual([]);
  });

  it('takes back neither what no longer shows nor an edit that names no article', async () => {
    const word = await imported('lamp');
    await words.editWord(word.id, { description: 'a device that produces light' });
    const edit = await last();
    await ds.getRepository(EnChange).update({ id: edit.id }, { superseded_at: new Date() });
    // a row as the file of another instance could carry it: about the headword as a whole
    const whole = await ds.getRepository(EnChange).save({
      headword: 'lamp',
      part_of_speech: null,
      entity: ChangeEntityE.word,
      action: ChangeActionE.update,
      record: null,
      diff: { description: { before: 'the word lamp', after: 'a device that produces light' } },
      origin: ChangeOriginE.admin,
      suggestion_id: null,
      author: null,
      superseded_at: null,
    });

    await expect(changes.revert(edit.id)).rejects.toMatchObject({ message: 'change_not_revertible' });
    await expect(changes.revert(whole.id)).rejects.toMatchObject({ message: 'change_not_revertible' });
    await expect(changes.revert(9999)).rejects.toMatchObject({ message: 'change_doesnt_found' });
    expect(((await article('lamp')) as EnWord).description).toBe('a device that produces light');
  });

  it('writes nothing but the listed columns of a record, whatever the row says', async () => {
    const word = await imported('lamp');
    await words.editWord(word.id, { description: 'a device that produces light' });
    const edit = await last();
    const rows = ds.getRepository(EnChange);
    // rows as the file of another instance could carry them
    await rows.update(
      { id: edit.id },
      {
        diff: {
          description: { before: 'the word lamp', after: 'a device that produces light' },
          part_of_speech: { before: 'verb', after: 'noun' },
        } as never,
      },
    );
    // a field the record does not have is a record that says something else
    await expect(changes.revert(edit.id)).rejects.toMatchObject({ message: 'change_outdated' });

    await rows.update(
      { id: edit.id },
      {
        diff: {
          description: { before: 'the word lamp', after: 'a device that produces light' },
          id: { before: 777, after: null },
          version: { before: '0.0.1', after: null },
        } as never,
      },
    );
    await changes.revert(edit.id);

    const row = await ds.getRepository(EnWord).findOneOrFail({
      where: { id: word.id },
      relations: ARTICLE_RELATIONS,
    });
    expect(row.description).toBe('the word lamp');
    expect(row.id).toBe(word.id);
    expect(row.version).not.toBe('0.0.1');
    expect((await last()).diff).toEqual({
      description: { before: 'a device that produces light', after: 'the word lamp' },
    });
  });

  it('lists the history, the latest first, by headword and by what still shows', async () => {
    const lampWord = await imported('lamp');
    const lightWord = await imported('light');
    await words.editWord(lampWord.id, { description: 'first' });
    await words.editWord(lightWord.id, { description: 'bright' });
    await words.editWord(lampWord.id, { description: 'second' });
    await changes.revert((await last()).id);

    const all = await changes.list({});
    expect(all.total).toBe(4);
    expect(all.items.map((item) => item.origin)).toEqual(['revert', 'admin', 'admin', 'admin']);
    expect(all.items.map((item) => item.revertible)).toEqual([false, false, true, true]);

    expect((await changes.list({ headword: 'lamp', part_of_speech: 'verb' })).total).toBe(0);
    expect((await changes.list({ headword: 'lamp', part_of_speech: 'noun' })).total).toBe(3);
    const ofLamp = await changes.list({ headword: 'lamp' });
    expect(ofLamp.items.map((item) => item.headword)).toEqual(['lamp', 'lamp', 'lamp']);
    expect((await changes.list({ search: 'LI' })).items.map((item) => item.headword)).toEqual(['light']);

    const active = await changes.list({ active: true });
    expect(active.items.map((item) => [item.headword, item.diff?.description?.after])).toEqual([
      ['light', 'bright'],
      ['lamp', 'first'],
    ]);
    expect((await changes.list({ active: false })).total).toBe(2);
    expect((await changes.list({ origin: [ChangeOriginE.revert] })).total).toBe(1);

    const paged = await changes.list({ page: 2, limit: 3 });
    expect(paged).toEqual(expect.objectContaining({ page: 2, limit: 3, total: 4, has_more: false }));
    expect(paged.items).toHaveLength(1);
  });

  it('takes a name out of the history and of the reports; the edits stay', async () => {
    const word = await imported('lamp');
    await withChangeSource({ origin: ChangeOriginE.suggestion, suggestion_id: 1, author: 'Ada' }, () =>
      words.editWord(word.id, { description: 'a device that produces light' }),
    );
    await withChangeSource({ origin: ChangeOriginE.suggestion, suggestion_id: 2, author: 'Grace' }, () =>
      words.editWord(word.id, { transcription: '/læmp/' }),
    );
    const suggestions = ds.getRepository(Suggestion);
    await suggestions.save(
      suggestions.create({
        headword: 'lamp',
        kind: 'report',
        message: 'a mistake',
        author_name: 'Ada',
      } as never),
    );

    // the history is found by the one who sent a correction, whatever the case of the letters
    expect((await changes.list({ author: 'ada' })).items.map((item) => item.author)).toEqual(['Ada']);
    expect((await changes.list({ author: ' GR ' })).items.map((item) => item.author)).toEqual(['Grace']);
    expect((await changes.list({ author: 'a' })).total).toBe(1);
    expect((await changes.list({ author: '%' })).total).toBe(0);
    expect((await changes.list({ author: '  ' })).total).toBe(2);

    expect(await changes.forgetAuthor(' Ada ')).toEqual({ success: true, forgotten: 2 });

    expect((await history()).map((row) => row.author)).toEqual([null, 'Grace']);
    expect((await history())[0].diff).not.toBeNull();
    expect((await suggestions.find()).map((row) => row.author_name)).toEqual([null]);
    expect(await changes.forgetAuthor('Ada')).toEqual({ success: true, forgotten: 0 });
  });
});
