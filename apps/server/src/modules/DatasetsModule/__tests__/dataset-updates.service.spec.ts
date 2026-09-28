import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { findCatalogEntry } from '../../../../core/constants/dataset_catalog';
import {
  DATASET_UPDATES_FAILURE_TTL_MS,
  DATASET_UPDATES_TTL_MS,
  DatasetUpdatesService,
} from '../dataset-updates.service';
import type { DatasetsService } from '../datasets.service';
import type { Dataset } from '../entities/dataset.entity';

// Whether the source of an installed dataset has a newer file (issue #530)

const KAIKKI = 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz';
const RELEASES = 'https://api.github.com/repos/globalwordnet/english-wordnet/releases/latest';

const headers = (lastModified: string | null) =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(lastModified ? { 'last-modified': lastModified } : {}),
  }) as unknown as Response;

const release = (tag: string, url = `https://github.com/globalwordnet/english-wordnet/releases/tag/${tag}`) =>
  ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: url }) }) as unknown as Response;

describe('DatasetUpdatesService (issue #530)', () => {
  const fetchMock = jest.fn<typeof fetch>();
  const realFetch = global.fetch;
  let installed: Array<Pick<Dataset, 'name' | 'version'>>;
  let service: DatasetUpdatesService;

  const answer = (answers: Record<string, Response | Error>): void => {
    fetchMock.mockImplementation(async (url) => {
      const found = answers[String(url)];
      if (!found) throw new Error(`nothing is asked of ${String(url)}`);
      if (found instanceof Error) throw found;
      return found;
    });
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z') });
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.UPDATE_CHECK;
    installed = [
      { name: 'default', version: '1.0.0' },
      { name: 'wiktionary', version: '2026.09.25' },
      { name: 'wordnet', version: '2025' },
      { name: 'wordnet_princeton', version: '3.1' },
    ];
    service = new DatasetUpdatesService({ installed: async () => installed } as unknown as DatasetsService);
    // the failure path logs a warning by design
    jest
      .spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
    delete process.env.UPDATE_CHECK;
  });

  it('tells of an extract that is a month newer and of a newer edition', async () => {
    answer({
      [KAIKKI]: headers('Fri, 30 Oct 2026 10:03:09 GMT'),
      [RELEASES]: release('2026-edition'),
    });

    await expect(service.check()).resolves.toEqual({
      enabled: true,
      datasets: [
        {
          name: 'wiktionary',
          installed: '2026.09.25',
          latest: '2026.10.30',
          url: 'https://kaikki.org/dictionary/English/',
          comparable: true,
          update_available: true,
          checked_at: '2026-11-01T12:00:00.000Z',
        },
        {
          name: 'wordnet',
          installed: '2025',
          latest: '2026',
          url: 'https://github.com/globalwordnet/english-wordnet/releases/tag/2026-edition',
          comparable: true,
          update_available: true,
          checked_at: '2026-11-01T12:00:00.000Z',
        },
      ],
    });
  });

  it('asks for the headers of the extract only, and names itself to the sources', async () => {
    answer({ [KAIKKI]: headers('Fri, 25 Sep 2026 10:03:09 GMT'), [RELEASES]: release('2025-edition') });
    await service.check();

    const calls = new Map(fetchMock.mock.calls.map(([url, init]) => [String(url), init as RequestInit]));
    expect([...calls.keys()].sort()).toEqual([RELEASES, KAIKKI].sort());
    expect(calls.get(KAIKKI)?.method).toBe('HEAD');
    for (const init of calls.values()) {
      expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^vocab-bloom-hub\//);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('says nothing of an extract of the same month, or of the edition that is installed', async () => {
    answer({ [KAIKKI]: headers('Sat, 24 Oct 2026 08:00:00 GMT'), [RELEASES]: release('2025-edition') });

    const { datasets } = await service.check();
    expect(datasets.map((dataset) => [dataset.name, dataset.latest, dataset.update_available])).toEqual([
      ['wiktionary', '2026.10.24', false],
      ['wordnet', '2025', false],
    ]);
  });

  it('asks only about the datasets the instance holds, and never about a frozen source', async () => {
    installed = [
      { name: 'default', version: '1.0.0' },
      { name: 'wordnet_princeton', version: '3.1' },
    ];
    await expect(service.check()).resolves.toEqual({ enabled: true, datasets: [] });
    expect(fetchMock).not.toHaveBeenCalled();

    installed.push({ name: 'wordnet', version: '2025' });
    answer({ [RELEASES]: release('2025-edition') });
    expect((await service.check()).datasets.map((dataset) => dataset.name)).toEqual(['wordnet']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes no request when the check is switched off', async () => {
    process.env.UPDATE_CHECK = 'false';
    await expect(service.check()).resolves.toEqual({ enabled: false, datasets: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks a source once a day, however often the page is opened', async () => {
    answer({ [KAIKKI]: headers('Fri, 25 Sep 2026 10:03:09 GMT'), [RELEASES]: release('2025-edition') });
    await Promise.all([service.check(), service.check(), service.check()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    jest.setSystemTime(Date.now() + DATASET_UPDATES_TTL_MS - 1000);
    await service.check();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    jest.setSystemTime(Date.now() + 2000);
    const again = await service.check();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(again.datasets[0].checked_at).toBe(new Date(Date.now()).toISOString());

    service.reset();
    await service.check();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('compares with the version that is installed now: a new installation needs no new request', async () => {
    answer({ [KAIKKI]: headers('Fri, 30 Oct 2026 10:03:09 GMT'), [RELEASES]: release('2026-edition') });
    expect((await service.check()).datasets.map((dataset) => dataset.update_available)).toEqual([true, true]);

    installed = [
      { name: 'wiktionary', version: '2026.10.30' },
      { name: 'wordnet', version: '2026' },
    ];
    expect((await service.check()).datasets.map((dataset) => dataset.update_available)).toEqual([false, false]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers "unknown" for a source that fails, and asks it again in half an hour', async () => {
    answer({
      [KAIKKI]: { ok: false, status: 503, headers: new Headers() } as unknown as Response,
      [RELEASES]: new Error('network down'),
    });

    const { enabled, datasets } = await service.check();
    expect(enabled).toBe(true);
    expect(datasets.map((dataset) => [dataset.latest, dataset.url, dataset.update_available])).toEqual([
      [null, null, false],
      [null, null, false],
    ]);

    await service.check();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.setSystemTime(Date.now() + DATASET_UPDATES_FAILURE_TTL_MS + 1000);
    answer({ [KAIKKI]: headers('Fri, 30 Oct 2026 10:03:09 GMT'), [RELEASES]: release('2026-edition') });
    expect((await service.check()).datasets.map((dataset) => dataset.update_available)).toEqual([true, true]);
  });

  it('takes nothing for a version that a source did not say', async () => {
    answer({ [KAIKKI]: headers(null), [RELEASES]: release('nightly') });
    expect((await service.check()).datasets.map((dataset) => dataset.latest)).toEqual([null, null]);

    service.reset();
    // a release without a page of its own leads to the page the instruction names
    answer({ [KAIKKI]: headers('not a date'), [RELEASES]: release('2026-edition', '') });
    const { datasets } = await service.check();
    expect(datasets[0].latest).toBeNull();
    const wordnet = findCatalogEntry('wordnet');
    expect(datasets[1]).toEqual(
      expect.objectContaining({
        latest: '2026',
        url: wordnet?.install.kind === 'convert' ? wordnet.install.files[0].page_url : null,
      }),
    );
  });

  it('gives no notice for a dataset that was installed before its version was read from the file', async () => {
    installed = [
      { name: 'wiktionary', version: null },
      // the day of the installation, as the versions were before
      { name: 'wordnet', version: '2026.09.27' },
    ];
    answer({ [KAIKKI]: headers('Fri, 30 Oct 2026 10:03:09 GMT'), [RELEASES]: release('2027-edition') });

    expect(
      (await service.check()).datasets.map((d) => [d.installed, d.latest, d.comparable, d.update_available]),
    ).toEqual([
      [null, '2026.10.30', false, false],
      // the card says that the dataset has to be installed again to know its edition
      ['2026.09.27', '2027', false, false],
    ]);
  });
});
