import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { DATASET_CATALOG } from '../../../../core/constants/dataset_catalog';
import { ErrorCodes } from '../../../../core/constants/error_codes';
import { Settings } from '../../SettingsModule/entities/settings.entity';
import { DatasetsService, OWN_DATASET_PROVENANCE } from '../datasets.service';
import { Dataset } from '../entities/dataset.entity';

// The registry on SQLite (issue #527): the default dataset only, nothing
// to install, switch or delete; the terms are the catalog's. The schema side
// is test:postgres.

describe('DatasetsService on SQLite', () => {
  let dataSource: DataSource;
  let service: DatasetsService;

  const boot = async (): Promise<DatasetsService> => {
    const created = new DatasetsService(
      dataSource.getRepository(Dataset),
      dataSource.getRepository(Settings),
      dataSource,
    );
    await created.onModuleInit();
    return created;
  };

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Dataset, Settings],
      synchronize: true,
    });
    await dataSource.initialize();
    service = await boot();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('registers the default dataset with the terms of the project dataset and makes it active', async () => {
    const list = await service.list();

    expect(list.supported).toBe(false);
    expect(list.active).toBe('default');
    expect(list.datasets[0]).toEqual(
      expect.objectContaining({
        name: 'default',
        title: 'Vocab Bloom Hub English dataset',
        installed: true,
        ...OWN_DATASET_PROVENANCE,
        version: null,
        active: true,
        is_default: true,
        imported_at: null,
      }),
    );
    const setting = await dataSource.getRepository(Settings).findOneBy({ field: 'active_dataset' });
    expect(setting?.value).toBe('default');
  });

  it('lists every dataset of the catalog, the ones that are not installed with their terms', async () => {
    const { datasets } = await service.list();

    expect(datasets.map((dataset) => dataset.name)).toEqual(DATASET_CATALOG.map((entry) => entry.name));
    expect(datasets.find((dataset) => dataset.name === 'wiktionary')).toEqual({
      name: 'wiktionary',
      title: 'English Wiktionary',
      installed: false,
      source: 'wiktionary',
      language: 'en',
      license: 'CC-BY-SA-4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: expect.stringContaining('Wiktionary contributors'),
      attribution_url: 'https://en.wiktionary.org',
      notice: null,
      version: null,
      active: false,
      is_default: false,
      created_at: null,
      imported_at: null,
    });
  });

  it('takes the version the settings recorded before the registry existed, and boots twice to the same row', async () => {
    await dataSource.getRepository(Dataset).clear();
    await dataSource.getRepository(Settings).save({ field: 'en_dataset_version', value: '1.4.0' });

    const again = await boot();
    await boot();

    expect((await again.list()).datasets[0]).toEqual(
      expect.objectContaining({ name: 'default', version: '1.4.0' }),
    );
    expect(await dataSource.getRepository(Dataset).count()).toBe(1);
  });

  it('falls back to the default dataset when the settings name one that is gone', async () => {
    await dataSource.getRepository(Settings).save({ field: 'active_dataset', value: 'wiktionary_en' });

    const again = await boot();

    expect(again.getActive().name).toBe('default');
    const setting = await dataSource.getRepository(Settings).findOneBy({ field: 'active_dataset' });
    expect(setting?.value).toBe('default');
  });

  it('refuses to install, activate or delete: the driver has no schemas', async () => {
    await expect(service.install('wiktionary')).rejects.toThrow(ErrorCodes.datasets_not_supported);
    await expect(service.activate('default')).rejects.toThrow(ErrorCodes.datasets_not_supported);
    await expect(service.remove('default')).rejects.toThrow(ErrorCodes.datasets_not_supported);
    // …and an import names the active dataset or none
    await expect(service.resolveTarget('wiktionary')).rejects.toThrow(ErrorCodes.datasets_not_supported);
    expect((await service.resolveTarget(undefined)).name).toBe('default');
    expect((await service.resolveTarget('default')).name).toBe('default');
  });

  it('keeps the terms of the catalog: what was written into the registry does not survive a start', async () => {
    const rows = dataSource.getRepository(Dataset);
    const row = await rows.findOneByOrFail({ name: 'default' });
    await rows.save(
      Object.assign(row, { license: 'CC0-1.0', attribution: 'Somebody else', notice: null, version: '2.0.0' }),
    );

    const again = await boot();

    expect(again.getActive()).toEqual(expect.objectContaining({ ...OWN_DATASET_PROVENANCE, version: '2.0.0' }));
    expect(await rows.findOneByOrFail({ name: 'default' })).toEqual(
      expect.objectContaining({ license: 'CC-BY-4.0', attribution: OWN_DATASET_PROVENANCE.attribution }),
    );
  });

  it('records what an import left, the version and the time, and tells the listeners', async () => {
    const heard: Array<string | null> = [];
    service.onActiveChanged((dataset) => heard.push(dataset.version));

    await service.recordImport('default', { version: '2.0.0' });

    const active = service.getActive();
    expect(active.version).toBe('2.0.0');
    expect(active.license).toBe(OWN_DATASET_PROVENANCE.license);
    expect(active.imported_at).toBeInstanceOf(Date);
    expect(heard).toEqual(['2.0.0']);
  });

  it('reads the active dataset through the connection of the application, and has no other to read', async () => {
    const [active] = await service.installed();
    await expect(service.reader(active)).resolves.toBe(dataSource);

    const other = Object.assign(new Dataset(), active, { name: 'wiktionary', schema: 'ds_wiktionary' });
    await expect(service.reader(other)).rejects.toThrow(ErrorCodes.datasets_not_supported);
    // nothing was opened, nothing is closed
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('knows when its datasets last changed as a set: installed, activated or deleted', async () => {
    const [registered] = await service.installed();
    const installedAt = new Date(registered.createdAt).getTime();
    expect((await service.changedAt())?.getTime()).toBe(installedAt);

    const activatedAt = new Date(installedAt + 60_000);
    await dataSource.getRepository(Dataset).update({ id: registered.id }, { activated_at: activatedAt });
    expect(await service.changedAt()).toEqual(activatedAt);

    // a deleted dataset leaves no row: the settings keep when it went
    const removedAt = new Date(installedAt + 120_000);
    await dataSource
      .getRepository(Settings)
      .save({ field: 'dataset_removed_at', value: removedAt.toISOString() });
    expect(await service.changedAt()).toEqual(removedAt);

    // a value that is no instant is not one
    await dataSource.getRepository(Settings).save({ field: 'dataset_removed_at', value: 'yesterday' });
    expect(await service.changedAt()).toEqual(activatedAt);
  });

  it('tells the listeners of the registry when an import filled a dataset', async () => {
    let told = 0;
    service.onRegistryChanged(() => {
      told += 1;
    });
    service.onRegistryChanged(() => {
      throw new Error('a listener that fails does not stop the others');
    });
    await service.recordImport('default', { version: '2.0.0' });
    expect(told).toBe(1);
  });

  it('answers 404 for a dataset that is not installed', async () => {
    await expect(service.find('nope')).rejects.toThrow(ErrorCodes.dataset_not_found);
    await expect(service.find('wiktionary')).rejects.toThrow(ErrorCodes.dataset_not_found);
  });
});
