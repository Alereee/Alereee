import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from 'antd';
import { DatasetT, ImportDictionaryChunkT } from 'server/types';
import { EnDictionaryImportPhasesE } from 'server/src/modules/EnModule/modules/EnImportDictionary/constants';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/core/api/EnApi', () => ({
  EnApi: { exportDictionary: jest.fn(), downloadExportedFile: jest.fn() },
}));

import { EnApi } from '@/core/api/EnApi';
import { AbstractBaseApi } from '@/core/api/AbstractBaseApi';
import { ExportDictionarySection } from '../index';

type HandleChunkT = (c: ImportDictionaryChunkT) => void;

const mockExportStreaming = (chunks: ImportDictionaryChunkT[], result: unknown = { success: true }) => {
  (EnApi.exportDictionary as jest.Mock).mockImplementation(async (handleChunk: HandleChunkT) => {
    chunks.forEach(handleChunk);
    return result;
  });
};

const renderSection = (dataset?: DatasetT) =>
  render(
    <App>
      <ExportDictionarySection dataset={dataset} />
    </App>,
  );

const WIKTIONARY: DatasetT = {
  name: 'wiktionary',
  title: 'English Wiktionary',
  installed: true,
  source: 'wiktionary',
  language: 'en',
  version: '2026.09.27',
  license: 'CC-BY-SA-4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attribution: 'Wiktionary contributors',
  attribution_url: 'https://en.wiktionary.org',
  notice: null,
  active: true,
  is_default: false,
  created_at: '2026-09-27T10:00:00.000Z',
  imported_at: '2026-09-27T10:05:00.000Z',
};

describe('ExportDictionarySection', () => {
  let saveBlobSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    saveBlobSpy = jest.spyOn(AbstractBaseApi, 'saveBlobAsFile').mockImplementation(() => {});
  });

  afterEach(() => {
    saveBlobSpy.mockRestore();
  });

  it('скачивает и сохраняет файл после чанка completed', async () => {
    const blob = new Blob(['zip']);
    mockExportStreaming([
      { stage: EnDictionaryImportPhasesE.packing_archive, percent: 50 } as ImportDictionaryChunkT,
      { stage: EnDictionaryImportPhasesE.completed, exportId: 'exp-1' } as ImportDictionaryChunkT,
    ]);
    (EnApi.downloadExportedFile as jest.Mock).mockResolvedValue({ blob, filename: 'dict.zip' });

    renderSection();
    fireEvent.click(screen.getByText('start_exporting'));

    await screen.findByText('export_again');
    expect(EnApi.downloadExportedFile).toHaveBeenCalledWith('exp-1', expect.any(Function));
    expect(saveBlobSpy).toHaveBeenCalledWith(blob, 'dict.zip');
    expect(screen.getByText('100.00%')).toBeInTheDocument();
  });

  it('использует имя файла по умолчанию, если сервер его не прислал', async () => {
    mockExportStreaming([
      { stage: EnDictionaryImportPhasesE.completed, exportId: 'exp-2' } as ImportDictionaryChunkT,
    ]);
    (EnApi.downloadExportedFile as jest.Mock).mockResolvedValue({ blob: new Blob(['x']) });

    renderSection();
    fireEvent.click(screen.getByText('start_exporting'));

    await screen.findByText('export_again');
    expect(saveBlobSpy).toHaveBeenCalledWith(expect.any(Blob), 'vocab-bloom-hub-en-export.zip');
  });

  it('уходит в ошибку, если completed пришёл без exportId', async () => {
    mockExportStreaming([{ stage: EnDictionaryImportPhasesE.completed } as ImportDictionaryChunkT]);

    renderSection();
    fireEvent.click(screen.getByText('start_exporting'));

    await screen.findByText('retry_exporting');
    expect(EnApi.downloadExportedFile).not.toHaveBeenCalled();
    expect(saveBlobSpy).not.toHaveBeenCalled();
  });

  it('уходит в ошибку, если скачивание файла вернуло error-юнион', async () => {
    mockExportStreaming([
      { stage: EnDictionaryImportPhasesE.completed, exportId: 'exp-3' } as ImportDictionaryChunkT,
    ]);
    (EnApi.downloadExportedFile as jest.Mock).mockResolvedValue({ error: true, message: 'failed_fetch' });

    renderSection();
    fireEvent.click(screen.getByText('start_exporting'));

    await screen.findByText('retry_exporting');
    expect(saveBlobSpy).not.toHaveBeenCalled();
  });

  it('shows the data license and the attribution line of the export (issue #270)', () => {
    renderSection();
    const link = screen.getByRole('link', { name: /CC-BY-4\.0/ });
    expect(link).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    expect(screen.getByText(/data_attribution/)).toHaveTextContent('CC BY 4.0');
  });

  it("shows the terms of the active dataset when it is not the project's own (issue #527)", () => {
    renderSection(WIKTIONARY);
    expect(screen.getByRole('link', { name: 'CC-BY-SA-4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
    expect(screen.getByText(/data_attribution/)).toHaveTextContent('Wiktionary contributors');
    expect(screen.queryByText(/CC-BY-4\.0/)).not.toBeInTheDocument();
  });

  it('shows a dataset nobody named the terms of without a link and without an attribution', () => {
    renderSection({ ...WIKTIONARY, license: 'NOASSERTION', license_url: '', attribution: '' });
    expect(screen.getByText(/NOASSERTION/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/data_attribution/)).not.toBeInTheDocument();
  });

  it('кнопка "экспортировать ещё раз" сбрасывает секцию в исходное состояние', async () => {
    mockExportStreaming([
      { stage: EnDictionaryImportPhasesE.completed, exportId: 'exp-4' } as ImportDictionaryChunkT,
    ]);
    (EnApi.downloadExportedFile as jest.Mock).mockResolvedValue({ blob: new Blob(['x']), filename: 'a.zip' });

    renderSection();
    fireEvent.click(screen.getByText('start_exporting'));
    fireEvent.click(await screen.findByText('export_again'));

    expect(screen.getByText('start_exporting')).toBeInTheDocument();
    expect(screen.getByText('0.00%')).toBeInTheDocument();
  });
});
