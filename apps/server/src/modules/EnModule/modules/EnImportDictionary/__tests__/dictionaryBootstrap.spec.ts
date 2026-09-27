import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger, NotFoundException } from '@nestjs/common';
import { ImportTriggerE } from '../../../../../../types';
import { setActiveDataset } from '../../../../../core/utils/active-dataset';
import { DictionaryBootstrapService, isAutoImportEnabled } from '../dictionaryBootstrap.service';
import { ImportStatusService } from '../importStatus.service';
import * as sources from '../sources';

jest.mock('../sources', () => ({
  ...(jest.requireActual('../sources') as object),
  listImportDir: jest.fn(),
  openImportDirSource: jest.fn(),
}));

const listImportDir = sources.listImportDir as jest.MockedFunction<typeof sources.listImportDir>;
const openImportDirSource = sources.openImportDirSource as jest.MockedFunction<
  typeof sources.openImportDirSource
>;

describe('DICTIONARY_AUTO_IMPORT (issue #268)', () => {
  it('is off unless the variable says otherwise', () => {
    expect(isAutoImportEnabled({})).toBe(false);
    expect(isAutoImportEnabled({ DICTIONARY_AUTO_IMPORT: 'false' })).toBe(false);
    for (const on of ['1', 'true', 'yes', 'on', ' TRUE ']) {
      expect(isAutoImportEnabled({ DICTIONARY_AUTO_IMPORT: on })).toBe(true);
    }
  });
});

describe('DictionaryBootstrapService (issue #268)', () => {
  const importFrom = jest.fn<(...args: unknown[]) => Promise<void>>();
  const findOne = jest.fn<(field: string) => Promise<string>>();
  let status: ImportStatusService;
  let service: DictionaryBootstrapService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    importFrom.mockReset();
    findOne.mockReset();
    listImportDir.mockReset();
    openImportDirSource.mockReset();
    listImportDir.mockResolvedValue([]);
    status = new ImportStatusService();
    service = new DictionaryBootstrapService({ importFrom } as never, status, { findOne } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setActiveDataset({ name: 'default', source: 'vocab-bloom-hub' });
  });

  it('imports from HuggingFace when no dataset version is recorded', async () => {
    findOne.mockRejectedValue(new NotFoundException());
    importFrom.mockResolvedValue(undefined);
    await expect(service.run()).resolves.toBe('completed');
    expect(importFrom).toHaveBeenCalledTimes(1);
    const [source, label, , trigger] = importFrom.mock.calls[0];
    expect(source).toBeInstanceOf(sources.HuggingFaceDatasetSource);
    expect(label).toBe('HuggingFace');
    expect(trigger).toBe(ImportTriggerE.auto);
  });

  it('does nothing when a dataset version is already installed', async () => {
    findOne.mockResolvedValue('1.0.0');
    await expect(service.run()).resolves.toBe('skipped');
    expect(importFrom).not.toHaveBeenCalled();
  });

  // issue #527: the project's own data never lands in a dataset of another source
  it('does nothing when the active dataset is not the default one, whatever its version', async () => {
    setActiveDataset({ name: 'wiktionary', source: 'wiktionary' });
    findOne.mockRejectedValue(new NotFoundException());
    await expect(service.run()).resolves.toBe('skipped');
    expect(findOne).not.toHaveBeenCalled();
    expect(importFrom).not.toHaveBeenCalled();
  });

  it('does nothing while another import holds the slot', async () => {
    findOne.mockRejectedValue(new NotFoundException());
    status.begin(ImportTriggerE.manual, 'upload');
    await expect(service.run()).resolves.toBe('skipped');
    expect(importFrom).not.toHaveBeenCalled();
  });

  it('prefers the newest dataset in DICTIONARY_IMPORT_DIR over HuggingFace', async () => {
    findOne.mockRejectedValue(new NotFoundException());
    listImportDir.mockResolvedValue([
      { path: 'old.zip', kind: 'zip', size: 1, modified_at: '2026-01-01T00:00:00.000Z' },
      { path: 'new', kind: 'directory', size: 0, modified_at: '2026-06-01T00:00:00.000Z' },
    ]);
    const local = {
      readManifest: async () => null,
      acquireFile: async () => ({ path: '', temporary: false }),
      dispose: async () => {},
    };
    openImportDirSource.mockResolvedValue(local);
    importFrom.mockResolvedValue(undefined);
    await expect(service.run()).resolves.toBe('completed');
    expect(openImportDirSource).toHaveBeenCalledWith('new', expect.anything());
    expect(importFrom.mock.calls[0][0]).toBe(local);
    expect(importFrom.mock.calls[0][1]).toBe('file "new"');
  });

  it('reports a failed import and leaves the next start to retry', async () => {
    findOne.mockRejectedValue(new NotFoundException());
    importFrom.mockRejectedValue(new Error('HTTP 502'));
    await expect(service.run()).resolves.toBe('failed');
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 502'));
  });

  it('does not start an import when the application is stopping', async () => {
    findOne.mockRejectedValue(new NotFoundException());
    service.onModuleDestroy();
    await expect(service.run()).resolves.toBe('skipped');
    expect(importFrom).not.toHaveBeenCalled();
  });
});
