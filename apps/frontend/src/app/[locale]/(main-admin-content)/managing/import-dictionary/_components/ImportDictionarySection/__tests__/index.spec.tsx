import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { ImportDictionaryChunkT } from 'server/types';
import { EnDictionaryImportPhasesE } from 'server/src/modules/EnModule/modules/EnImportDictionary/constants';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/core/api/EnApi', () => ({
  EnApi: {
    importDictionary: jest.fn(),
    uploadDictionary: jest.fn(),
    getImportSources: jest.fn(),
    getImportStatus: jest.fn(),
  },
}));

import { EnApi } from '@/core/api/EnApi';
import { ImportDictionarySection } from '../index';

type HandleChunkT = (c: ImportDictionaryChunkT) => void;

const mockImportStreaming = (chunks: ImportDictionaryChunkT[], result: unknown = { success: true }) => {
  (EnApi.importDictionary as jest.Mock).mockImplementation(
    async (_body: unknown, handleChunk: HandleChunkT) => {
      chunks.forEach(handleChunk);
      return result;
    },
  );
};

const completedChunks = [
  { stage: EnDictionaryImportPhasesE.saving_words, percent: 40 } as ImportDictionaryChunkT,
  { stage: EnDictionaryImportPhasesE.completed, percent: 100 } as ImportDictionaryChunkT,
];

const renderSection = (props: React.ComponentProps<typeof ImportDictionarySection> = {}) =>
  render(
    <App>
      <ImportDictionarySection {...props} />
    </App>,
  );

describe('ImportDictionarySection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (EnApi.getImportSources as jest.Mock).mockResolvedValue({
      import_dir_configured: false,
      files: [],
      revisions: [],
    });
    (EnApi.getImportStatus as jest.Mock).mockResolvedValue({ running: false });
  });

  it('доводит прогресс до 100% и прячет кнопку после успешного импорта', async () => {
    mockImportStreaming([
      { stage: EnDictionaryImportPhasesE.saving_words, percent: 40 } as ImportDictionaryChunkT,
      { stage: EnDictionaryImportPhasesE.completed, percent: 100 } as ImportDictionaryChunkT,
    ]);

    renderSection();
    fireEvent.click(screen.getByText('start_importing'));

    await screen.findByText('100.00%');
    // the default source is the published dataset: an empty body
    expect(EnApi.importDictionary).toHaveBeenCalledWith({}, expect.any(Function), expect.any(Function));
    expect(screen.queryByText('start_importing')).not.toBeInTheDocument();
    expect(screen.queryByText('retry_importing')).not.toBeInTheDocument();
  });

  it('a chosen dataset revision pins the HuggingFace import (issue #322)', async () => {
    (EnApi.getImportSources as jest.Mock).mockResolvedValue({
      import_dir_configured: false,
      files: [],
      revisions: ['v0.2.0', 'v0.1.0'],
    });
    mockImportStreaming(completedChunks);

    renderSection();
    // the select renders once the tags arrive; pick a pinned version
    const select = await screen.findByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('v0.1.0'));

    fireEvent.click(screen.getByText('start_importing'));
    await screen.findByText('100.00%');
    expect(EnApi.importDictionary).toHaveBeenCalledWith(
      { source: { kind: 'huggingface', revision: 'v0.1.0' } },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('показывает версии из пропсов и подсказку об актуальной версии', () => {
    renderSection({ yourVersion: '0.2.0', latestVersion: '0.2.0' });

    expect(screen.getByText(/your_version: 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/latest_version: 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText('up_to_date')).toBeInTheDocument();
    // re-import stays possible even when the versions match
    expect(screen.getByText('start_importing')).toBeInTheDocument();
  });

  it('не показывает подсказку, когда доступна более новая версия', () => {
    renderSection({ yourVersion: '0.1.0', latestVersion: '0.2.0' });

    expect(screen.queryByText('up_to_date')).not.toBeInTheDocument();
  });

  it('показывает версию датасета из manifest-чанка и обновляет установленную после успеха', async () => {
    mockImportStreaming([
      {
        stage: EnDictionaryImportPhasesE.downloading_database,
        percent: 0,
        datasetVersion: '0.2.0',
      } as ImportDictionaryChunkT,
      { stage: EnDictionaryImportPhasesE.completed, percent: 100 } as ImportDictionaryChunkT,
    ]);

    renderSection();
    expect(screen.getByText(/your_version: —/)).toBeInTheDocument();
    expect(screen.getByText(/latest_version: —/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('start_importing'));

    await screen.findByText(/latest_version: 0\.2\.0/);
    // после успешного импорта установленная версия равна версии манифеста
    expect(screen.getByText(/your_version: 0\.2\.0/)).toBeInTheDocument();
  });

  it('показывает ошибку и кнопку повтора, если импорт вернул error-юнион', async () => {
    mockImportStreaming([], { error: true, message: 'failed_fetch' });

    renderSection();
    fireEvent.click(screen.getByText('start_importing'));

    await screen.findByText('retry_importing');
    await screen.findByText('failed_fetch'); // error toast with the passthrough translation key
  });

  it('считает импорт ошибочным, если стрим закончился без чанка completed', async () => {
    mockImportStreaming([
      { stage: EnDictionaryImportPhasesE.saving_words, percent: 70 } as ImportDictionaryChunkT,
    ]);

    renderSection();
    fireEvent.click(screen.getByText('start_importing'));

    await screen.findByText('retry_importing');
    await waitFor(() => expect(screen.getByText('unknown_error')).toBeInTheDocument());
  });

  describe('local sources (issue #269)', () => {
    const openTab = async (name: string, marker: string) => {
      fireEvent.click(screen.getByRole('tab', { name }));
      await screen.findByText(marker);
    };
    const startButton = () => screen.getByText('start_importing').closest('button');
    const uploadedCall = () =>
      (EnApi.uploadDictionary as jest.Mock).mock.calls[0] as [
        Record<string, File | undefined>,
        Record<string, unknown>,
      ];
    const mockUploadStreaming = () =>
      (EnApi.uploadDictionary as jest.Mock).mockImplementation(
        async (_files: unknown, _manual: unknown, handleChunk: HandleChunkT) => {
          completedChunks.forEach(handleChunk);
          return { success: true };
        },
      );

    it('archive tab: disables the start until an archive is picked, then uploads it', async () => {
      mockUploadStreaming();
      renderSection();
      await openTab('source_archive', 'upload_text');
      // without DICTIONARY_IMPORT_DIR the server-side picker is replaced by a hint
      expect(screen.getByText('import_dir_hint')).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(startButton()).toBeDisabled();

      const archive = new File(['zip'], 'export.zip', { type: 'application/zip' });
      fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [archive] },
      });
      await screen.findByText('export.zip');
      await waitFor(() => expect(startButton()).toBeEnabled());

      fireEvent.click(screen.getByText('start_importing'));
      await screen.findByText('100.00%');
      const [files, manual] = uploadedCall();
      expect(Object.keys(files)).toEqual(['archive']);
      expect(files.archive?.name).toBe('export.zip');
      expect(manual).toEqual({});
      expect(EnApi.importDictionary).not.toHaveBeenCalled();
    });

    it('archive tab: offers the datasets of the import directory and imports the picked one by path', async () => {
      (EnApi.getImportSources as jest.Mock).mockResolvedValue({
        import_dir_configured: true,
        files: [
          { path: 'export.zip', kind: 'zip', size: 2048 },
          { path: 'dataset', kind: 'directory', size: 0 },
        ],
      });
      mockImportStreaming(completedChunks);
      renderSection();
      await openTab('source_archive', 'upload_text');
      expect(screen.queryByText('import_dir_hint')).not.toBeInTheDocument();

      fireEvent.mouseDown(screen.getByRole('combobox'));
      fireEvent.click(await screen.findByText('dataset/'));
      await waitFor(() => expect(startButton()).toBeEnabled());

      fireEvent.click(screen.getByText('start_importing'));
      await screen.findByText('100.00%');
      expect(EnApi.importDictionary).toHaveBeenCalledWith(
        { source: { kind: 'file', path: 'dataset' } },
        expect.any(Function),
        expect.any(Function),
      );
      expect(EnApi.uploadDictionary).not.toHaveBeenCalled();
    });

    it('files tab: one slot per dataset file, the manifest as a file', async () => {
      mockUploadStreaming();
      renderSection();
      await openTab('source_files', 'files_hint');
      expect(startButton()).toBeDisabled();

      const slotInput = (slot: string) =>
        screen.getByTestId(`slot-${slot}`).querySelector('input[type="file"]') as HTMLInputElement;
      // the manifest alone is not a dataset
      fireEvent.change(slotInput('manifest'), { target: { files: [new File(['{}'], 'manifest.json')] } });
      await screen.findByText('manifest.json');
      expect(startButton()).toBeDisabled();

      // the slot decides what the file is, whatever it is called
      fireEvent.change(slotInput('words'), { target: { files: [new File(['{}'], 'my-words.txt')] } });
      await screen.findByText('my-words.txt');
      fireEvent.change(slotInput('phrases'), { target: { files: [new File(['{}'], 'phrases.jsonl')] } });
      await screen.findByText('phrases.jsonl');
      await waitFor(() => expect(startButton()).toBeEnabled());

      fireEvent.click(screen.getByText('start_importing'));
      await screen.findByText('100.00%');
      const [files, manual] = uploadedCall();
      expect(Object.entries(files).map(([slot, f]) => [slot, f?.name])).toEqual([
        ['manifest', 'manifest.json'],
        ['words', 'my-words.txt'],
        ['phrases', 'phrases.jsonl'],
      ]);
      expect(manual).toEqual({});
    });

    it('files tab: the manifest typed by hand replaces the manifest slot', async () => {
      mockUploadStreaming();
      renderSection();
      await openTab('source_files', 'files_hint');

      const wordsInput = screen
        .getByTestId('slot-words')
        .querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(wordsInput, { target: { files: [new File(['{}'], 'words.jsonl')] } });
      await screen.findByText('words.jsonl');

      fireEvent.click(screen.getByLabelText('manifest_manual'));
      expect(screen.queryByTestId('slot-manifest')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('manifest_version'), { target: { value: ' 3.1.0 ' } });
      fireEvent.change(screen.getByLabelText('manifest_synonym_links'), { target: { value: '12' } });

      fireEvent.click(screen.getByText('start_importing'));
      await screen.findByText('100.00%');
      const [files, manual] = uploadedCall();
      expect(Object.keys(files)).toEqual(['words']);
      expect(manual).toEqual({ version: '3.1.0', synonym_links: 12, antonym_links: undefined });
    });

    it('never shows the up-to-date hint for a local source', async () => {
      renderSection({ yourVersion: '0.2.0', latestVersion: '0.2.0' });
      expect(screen.getByText('up_to_date')).toBeInTheDocument();
      await openTab('source_archive', 'upload_text');
      expect(screen.queryByText('up_to_date')).not.toBeInTheDocument();
    });
  });
});

// The dataset an import writes into (issue #527)
describe('ImportDictionarySection: the target dataset', () => {
  const datasets = {
    supported: true,
    active: 'default',
    datasets: [
      { name: 'default', title: 'Own', installed: true, version: '1.0.0', active: true, is_default: true },
      { name: 'wiktionary', title: 'Wiktionary', installed: true, version: '2026.09', active: false },
      // a dataset of the catalog the instance does not hold is no target of an import
      { name: 'wordnet', title: 'WordNet', installed: false, version: null, active: false },
    ],
  } as unknown as React.ComponentProps<typeof ImportDictionarySection>['datasets'];

  beforeEach(() => {
    jest.clearAllMocks();
    (EnApi.getImportSources as jest.Mock).mockResolvedValue({
      import_dir_configured: false,
      files: [],
      revisions: [],
    });
    (EnApi.getImportStatus as jest.Mock).mockResolvedValue({ running: false });
  });

  it('offers no choice on a driver without schemas and names no dataset in the request', async () => {
    mockImportStreaming(completedChunks);
    renderSection({ datasets: { ...datasets!, supported: false } });

    expect(screen.queryByText('dataset_target')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('start_importing'));
    await screen.findByText('100.00%');
    expect(EnApi.importDictionary).toHaveBeenCalledWith({}, expect.any(Function), expect.any(Function));
  });

  it('imports into the active dataset by default, without naming it', async () => {
    mockImportStreaming(completedChunks);
    renderSection({ datasets, yourVersion: '1.0.0' });

    expect(screen.getByText('dataset_target')).toBeInTheDocument();
    expect(screen.queryByText('dataset_hint')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('start_importing'));
    await screen.findByText('100.00%');
    expect(EnApi.importDictionary).toHaveBeenCalledWith({}, expect.any(Function), expect.any(Function));
  });

  it('names the dataset the page was opened for and shows the version that dataset holds', async () => {
    mockImportStreaming(completedChunks);
    renderSection({ datasets, yourVersion: '1.0.0', initialTarget: 'wiktionary' });

    expect(screen.getByText('dataset_hint')).toBeInTheDocument();
    expect(screen.getByText('your_version: 2026.09')).toBeInTheDocument();
    fireEvent.click(screen.getByText('start_importing'));
    await screen.findByText('100.00%');
    expect(EnApi.importDictionary).toHaveBeenCalledWith(
      { dataset: 'wiktionary' },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('ignores a dataset of the link that is not installed', () => {
    renderSection({ datasets, initialTarget: 'wordnet' });

    expect(screen.queryByText('dataset_hint')).not.toBeInTheDocument();
  });

  it('offers no choice while the default dataset is the only one installed', () => {
    renderSection({
      datasets: {
        ...datasets!,
        datasets: datasets!.datasets.filter((dataset) => dataset.name !== 'wiktionary'),
      },
    });

    expect(screen.queryByText('dataset_target')).not.toBeInTheDocument();
  });
});
