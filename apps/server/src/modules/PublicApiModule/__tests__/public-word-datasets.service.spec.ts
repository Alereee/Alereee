import '../../EnModule/__tests__/helpers/clearDatabaseUrl';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ErrorCodes } from '../../../../core/constants/error_codes';
import { findCatalogEntry } from '../../../../core/constants/dataset_catalog';
import { ChangeActionE, ChangeEntityE, ChangeOriginE, EnPartOfSpeechE, EnWordFormsE } from '../../../../types';
import { DatasetsService } from '../../DatasetsModule/datasets.service';
import { Dataset } from '../../DatasetsModule/entities/dataset.entity';
import { DICTIONARY_ENTITIES } from '../../EnModule/entities/dictionary-entities';
import { EnChange } from '../../EnModule/entities/en_change.entity';
import { EnEntry } from '../../EnModule/entities/en_entry.entity';
import { EnWord } from '../../EnModule/entities/en_word.entity';
import { Suggestion } from '../../SuggestionsModule/entities/suggestion.entity';
import { DatasetsLastModifiedService } from '../datasets-last-modified.service';
import { PublicMetaService } from '../public-meta.service';
import { PublicWordDatasetsService } from '../public-word-datasets.service';
import { DatasetParamPipe } from '../utils/dataset-param.pipe';

// A headword from every dataset (issue #528). Two databases stand for two
// datasets of an instance: a dataset is what a connection is on, and the
// reads know nothing else of it. The schemas of Postgres are the matter of
// test:postgres.
describe('a headword read from every dataset', () => {
  let own: DataSource;
  let wordnet: DataSource;
  let service: PublicWordDatasetsService;
  let lastModified: DatasetsLastModifiedService;
  let changedAt: Date | null = null;
  const listeners: Array<() => void> = [];

  const connect = async (): Promise<DataSource> => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [...DICTIONARY_ENTITIES, Suggestion],
      synchronize: true,
    });
    return dataSource.initialize();
  };

  const registered = (name: string, version: string | null): Dataset => {
    const entry = findCatalogEntry(name);
    if (!entry) throw new Error(`no dataset "${name}" in the catalog`);
    return Object.assign(new Dataset(), {
      name,
      schema: name === 'default' ? 'public' : `ds_${name}`,
      source: entry.source,
      version,
      license: entry.license.spdx,
      license_url: entry.license.url,
      attribution: entry.attribution,
      attribution_url: entry.attribution_url || null,
      notice: entry.notice || null,
    });
  };
  const datasets = [registered('default', '1.0.0'), registered('wordnet_princeton', '3.1')];

  const write = async (dataSource: DataSource, word: string, description: string, updateAt?: Date) => {
    const entry = await dataSource.getRepository(EnEntry).save({ word });
    const saved = await dataSource.getRepository(EnWord).save({
      word: entry,
      part_of_speech: EnPartOfSpeechE.noun,
      form_of_word: EnWordFormsE.base_form,
      description,
      generated: false,
    });
    if (updateAt) await dataSource.getRepository(EnWord).update({ id: saved.id }, { updateAt });
    return saved;
  };

  beforeAll(async () => {
    own = await connect();
    wordnet = await connect();

    const registry = {
      installed: async () => datasets,
      getActive: () => datasets[0],
      reader: async (dataset: Dataset) => (dataset.name === 'default' ? own : wordnet),
      changedAt: async () => changedAt,
      onActiveChanged: () => undefined,
      onRegistryChanged: (listener: () => void) => listeners.push(listener),
    } as unknown as DatasetsService;
    const settings = { findOne: async () => '1.0.1', getVersion: () => '1.1.0' };
    const meta = new PublicMetaService({} as never, settings as never, registry);
    service = new PublicWordDatasetsService(registry, meta);
    lastModified = new DatasetsLastModifiedService(registry);

    await write(own, 'lamp', 'what the project says');
    await write(wordnet, 'lamp', 'what the source says');
    await write(wordnet, 'Lamp', 'a name');
    await write(wordnet, 'wick', 'a word of one dataset');
    await wordnet.getRepository(EnChange).save({
      headword: 'lamp',
      part_of_speech: EnPartOfSpeechE.noun,
      entity: ChangeEntityE.word,
      action: ChangeActionE.update,
      record: null,
      diff: { description: { before: 'said before', after: 'what the source says' } },
      origin: ChangeOriginE.admin,
    });
  });

  afterAll(async () => {
    await own.destroy();
    await wordnet.destroy();
  });

  it('answers a group per dataset, each under its own terms', async () => {
    const { data, meta } = await service.getByHeadword(' lamp ');

    expect(meta).toEqual({ word: 'lamp', datasets: 2, found: 2 });
    expect(
      data.map(({ entries: _entries, word: _word, variants: _variants, count: _count, ...terms }) => terms),
    ).toEqual([
      {
        dataset: 'default',
        active: true,
        source: 'vocab-bloom-hub',
        // the version of the served dataset is the one the settings carry, as `/meta` answers it
        dataset_version: '1.0.1',
        license: 'CC-BY-4.0',
        license_url: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: expect.any(String),
        attribution_url: expect.any(String),
        notice: expect.stringContaining('language models'),
        license_text: '',
      },
      {
        dataset: 'wordnet_princeton',
        active: false,
        source: 'princeton-wordnet',
        dataset_version: '3.1',
        license: 'WordNet',
        license_url: expect.any(String),
        attribution: expect.stringContaining('WordNet'),
        attribution_url: expect.any(String),
        notice: '',
        license_text: expect.stringContaining('Princeton University'),
      },
    ]);
  });

  it('matches the spelling inside each dataset and attributes every entry to its own', async () => {
    const { data } = await service.getByHeadword('lamp');
    expect(data.map((group) => [group.word, group.variants, group.count])).toEqual([
      ['lamp', [], 1],
      ['lamp', ['Lamp'], 1],
    ]);
    expect(data.map((group) => group.entries.map((e) => [e.description, e.source, e.modified]))).toEqual([
      [['what the project says', 'vocab-bloom-hub', false]],
      [['what the source says', 'princeton-wordnet', true]],
    ]);

    const proper = await service.getByHeadword('Lamp');
    expect(proper.meta).toEqual({ word: 'Lamp', datasets: 2, found: 2 });
    expect(proper.data.map((group) => [group.word, group.entries.map((e) => e.word)])).toEqual([
      ['lamp', ['lamp']],
      ['Lamp', ['Lamp']],
    ]);
  });

  it('answers an empty group for a dataset without the headword, and 404 when none holds it', async () => {
    const { data, meta } = await service.getByHeadword('Wick');
    expect(meta).toEqual({ word: 'Wick', datasets: 2, found: 1 });
    expect(
      data.map((group) => [group.dataset, group.word, group.variants, group.count, group.entries.length]),
    ).toEqual([
      ['default', 'wick', [], 0, 0],
      ['wordnet_princeton', 'wick', [], 1, 1],
    ]);

    await expect(service.getByHeadword('candle')).rejects.toThrow(ErrorCodes.word_doesnt_found);
    await expect(service.getByHeadword('   ')).rejects.toThrow(ErrorCodes.word_doesnt_found);
  });

  it('reads the history of a headword from the dataset that is named', async () => {
    const changed = await service.getHistory('lamp', 'wordnet_princeton');
    expect(changed.meta).toEqual({ word: 'lamp', count: 1, variants: ['Lamp'] });
    expect(changed.data).toEqual([
      expect.objectContaining({
        word: 'lamp',
        part_of_speech: 'noun',
        source: 'princeton-wordnet',
        diff: { description: { before: 'said before', after: 'what the source says' } },
      }),
    ]);

    const clean = await service.getHistory('lamp', 'default');
    expect(clean).toEqual({ data: [], meta: { word: 'lamp', count: 0, variants: [] } });

    await expect(service.getHistory('lamp', 'wiktionary')).rejects.toThrow(ErrorCodes.dataset_not_found);
    await expect(service.getHistory('wick', 'default')).rejects.toThrow(ErrorCodes.word_doesnt_found);
  });

  it('dates the answer by the newest change of any dataset, and by the last change of their set', async () => {
    const newest = new Date('2031-05-04T10:20:30.700Z');
    await write(wordnet, 'ember', 'changed last', newest);
    lastModified.reset();
    // to the second, as an HTTP date says it
    expect(await lastModified.getLastModified()).toEqual(new Date('2031-05-04T10:20:30.000Z'));

    // kept for a while: every public read asks
    changedAt = new Date('2032-01-01T00:00:00.000Z');
    expect(await lastModified.getLastModified()).toEqual(new Date('2031-05-04T10:20:30.000Z'));
    // a dataset was deleted: the registry says so, and the instant is looked up again
    for (const listener of listeners) listener();
    expect(await lastModified.getLastModified()).toEqual(changedAt);
  });

  it('takes the name of a dataset for what a dataset may be called', () => {
    const pipe = new DatasetParamPipe();
    expect(pipe.transform('default')).toBe('default');
    expect(pipe.transform('wordnet_princeton')).toBe('wordnet_princeton');
    for (const name of ['', 'Wiktionary', 'ds wiktionary', 'public"; DROP', 'a'.repeat(41)]) {
      expect(() => pipe.transform(name)).toThrow(BadRequestException);
    }
  });
});
