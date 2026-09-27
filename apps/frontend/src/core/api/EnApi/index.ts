import { AbstractBaseApi, type ApiQueryT, type DownloadedFileT } from '../AbstractBaseApi';
import {
  AddMeaningReqT,
  AuditListT,
  ListAuditQueryT,
  ListAuditResT,
  AddMeaningResT,
  AddMeaningTranslationReqT,
  AddMeaningTranslationResT,
  AddResT,
  AddShortTranslationReqT,
  AddShortTranslationResT,
  AddWordFormReqT,
  AddWordFormResT,
  AddWordReqT,
  DeleteMeaningResT,
  DeleteMeaningTranslationResT,
  DeleteResT,
  DeleteShortTranslationResT,
  EditCommonInfoOfWordReqT,
  EditCommonInfoOfWordResT,
  EditMeaningReqT,
  EditMeaningResT,
  EditMeaningTranslationReqT,
  EditMeaningTranslationResT,
  EditPhrasalBaseReqT,
  EditPhrasalBaseResT,
  ApplySuggestionResT,
  DeleteSuggestionResT,
  ListSuggestionsQueryT,
  ListSuggestionsResT,
  ResetEntryUserModifiedResT,
  SuggestionStatusE,
  UpdateSuggestionStatusResT,
  EditShortTranslationReqT,
  EditShortTranslationResT,
  EditWordFormReqT,
  EditWordFormResT,
  EnIssuesStatisticsT,
  EnPartOfSpeechE,
  EnStatisticsT,
  EnTranslationsStatisticsT,
  ErrorResT,
  GetEnIssuesStatisticsResT,
  GetEnStatisticsResT,
  GetEnTranslationsStatisticsResT,
  GetWordByIdResT,
  GetDatasetManifestResT,
  DatasetResT,
  DeleteDatasetResT,
  GetDatasetsResT,
  PublicSearchDetailedV1ResT,
  PublicSearchV1ResT,
  GetImportSourcesResT,
  GetImportStatusResT,
  ImportDictionaryChunkT,
  ImportDictionaryReqT,
  UploadDictionaryReqT,
  ListMeaningsQueryT,
  ListMeaningsResT,
  ListMeaningTranslationsQueryT,
  ListMeaningTranslationsResT,
  ListShortTranslationsQueryT,
  ListShortTranslationsResT,
  ListWordsQueryT,
  ListWordsResT,
  SearchDetailedReqT,
  SearchReqT,
  SearchResT,
} from 'server/types';
import { CheckWordResT } from 'server/types';
import { ErrorCodes } from 'server/core/constants/error_codes';

export class EnApi extends AbstractBaseApi {
  static async checkWord(word: string, pos: EnPartOfSpeechE, forPhrasal?: boolean): Promise<CheckWordResT> {
    return this.get<CheckWordResT>(`${this.baseURL}/en/check-word/${word}`, {
      query: { partOfSpeech: pos, forPhrasal },
    });
  }

  static async addWord(data: AddWordReqT): Promise<AddResT> {
    return this.post<AddResT>(`${this.baseURL}/en/add/word`, data);
  }

  // Reads through the public prefix and unwraps the v1 envelope for the
  // admin components
  static async search(search: string): Promise<SearchResT> {
    const res = await this.publicSearch({ search, limit: 100 });
    return 'error' in res ? res : res.data;
  }

  // Mirrors the raw endpoint contract: every filter the DTO accepts is passed
  // through as is, in the query string of the cacheable GET form (issue #396)
  /** The public search as consumers see it: the v1 envelope `{ data, meta }` */
  // The public GETs carry `Cache-Control: public, max-age=3600` for consumers;
  // the admin edits the data it reads, so its own requests must not be
  // answered from the browser's HTTP cache (a deleted word would come back
  // in the search for an hour)
  private static readonly PUBLIC_READ: RequestInit = { cache: 'no-store' };

  static async publicSearch(query: SearchReqT): Promise<PublicSearchV1ResT | ErrorResT> {
    return this.get<PublicSearchV1ResT>(`${this.baseURL}/v1/search`, {
      query: query as unknown as ApiQueryT,
      ...this.PUBLIC_READ,
    });
  }

  static async publicSearchDetailed(
    query: SearchDetailedReqT,
  ): Promise<PublicSearchDetailedV1ResT | ErrorResT> {
    return this.get<PublicSearchDetailedV1ResT>(`${this.baseURL}/v1/search/detailed`, {
      query: query as unknown as ApiQueryT,
      ...this.PUBLIC_READ,
    });
  }

  /** Any GET read of the public prefix, e.g. `/v1/words/run` (the documentation playground) */
  static async publicGet<T>(path: string, query?: ApiQueryT): Promise<T | ErrorResT> {
    return this.get<T>(`${this.baseURL}${path}`, { query, ...this.PUBLIC_READ });
  }

  /** Any POST of the public prefix, e.g. `/v1/suggestions` (the documentation playground) */
  static async publicPost<T>(path: string, body: object): Promise<T | ErrorResT> {
    return this.post<T>(`${this.baseURL}${path}`, body);
  }

  // Admin listings with filters and pagination (bulk-request page, issue #249)
  static async listWords(query: ListWordsQueryT): Promise<ListWordsResT> {
    return this.get<ListWordsResT>(`${this.baseURL}/en/words`, { query: { ...query } });
  }

  static async listMeanings(query: ListMeaningsQueryT): Promise<ListMeaningsResT> {
    return this.get<ListMeaningsResT>(`${this.baseURL}/en/meanings`, { query: { ...query } });
  }

  static async listMeaningTranslations(
    query: ListMeaningTranslationsQueryT,
  ): Promise<ListMeaningTranslationsResT> {
    return this.get<ListMeaningTranslationsResT>(`${this.baseURL}/en/meaning-translations`, {
      query: { ...query },
    });
  }

  static async listShortTranslations(query: ListShortTranslationsQueryT): Promise<ListShortTranslationsResT> {
    return this.get<ListShortTranslationsResT>(`${this.baseURL}/en/short-translations`, {
      query: { ...query },
    });
  }

  static async deleteWord(id: number): Promise<DeleteResT> {
    return this.delete<DeleteResT>(`${this.baseURL}/en/${id}`);
  }

  static async editCommonInfoOfWord(
    id: string | number,
    data: EditCommonInfoOfWordReqT,
  ): Promise<EditCommonInfoOfWordResT> {
    return this.patch<EditCommonInfoOfWordResT>(`${this.baseURL}/en/common-info/${id}`, data);
  }

  static async editPhrasalBase(body: EditPhrasalBaseReqT): Promise<EditPhrasalBaseResT> {
    return this.patch<EditPhrasalBaseResT>(`${this.baseURL}/en/phrasal-base`, body);
  }

  // The moderation queue of reader reports (issue #327)
  static async getSuggestions(query: ListSuggestionsQueryT): Promise<ListSuggestionsResT> {
    return this.get<ListSuggestionsResT>(`${this.baseURL}/en/suggestions`, { query: { ...query } });
  }

  static async updateSuggestionStatus(
    id: number,
    status: SuggestionStatusE,
  ): Promise<UpdateSuggestionStatusResT> {
    return this.patch<UpdateSuggestionStatusResT>(`${this.baseURL}/en/suggestions/${id}`, { status });
  }

  static async deleteSuggestion(id: number): Promise<DeleteSuggestionResT> {
    return this.delete<DeleteSuggestionResT>(`${this.baseURL}/en/suggestions/${id}`);
  }

  // One-click accept of an edit suggestion: the stored values go through the
  // normal edit flow on the server (audited, flags the entry user_modified)
  static async applySuggestion(id: number): Promise<ApplySuggestionResT> {
    return this.post<ApplySuggestionResT>(`${this.baseURL}/en/suggestions/${id}/apply`, {});
  }

  // Clears the entry's user-modified flag (issue #328): the next dictionary
  // update replaces the entry with the dataset content again
  static async resetEntryUserModified(word: string): Promise<ResetEntryUserModifiedResT> {
    return this.patch<ResetEntryUserModifiedResT>(
      `${this.baseURL}/en/reset-user-modified/${encodeURIComponent(word)}`,
      {},
    );
  }

  static async getWordById(id: number): Promise<GetWordByIdResT> {
    return this.get<GetWordByIdResT>(`${this.baseURL}/en/${id}`);
  }

  static async addWordForm(body: AddWordFormReqT): Promise<AddWordFormResT> {
    return this.post<AddWordFormResT>(`${this.baseURL}/en/word-form`, body);
  }
  static async editWordForm(body: EditWordFormReqT): Promise<EditWordFormResT> {
    return this.patch<EditWordFormResT>(`${this.baseURL}/en/word-form`, body);
  }

  static async addShortTranslation(body: AddShortTranslationReqT): Promise<AddShortTranslationResT> {
    return this.post<AddShortTranslationResT>(`${this.baseURL}/en/word/short-translation`, body);
  }

  static async editShortTranslation(body: EditShortTranslationReqT): Promise<EditShortTranslationResT> {
    return this.patch<EditShortTranslationResT>(`${this.baseURL}/en/word/short-translation`, body);
  }

  static async deleteShortTranslation(id: string | number): Promise<DeleteShortTranslationResT> {
    return this.delete<AddShortTranslationResT>(`${this.baseURL}/en/word/short-translation/${id}`);
  }

  static async addMeaning(body: AddMeaningReqT): Promise<AddMeaningResT> {
    return this.post<AddMeaningResT>(`${this.baseURL}/en/word/meaning`, body);
  }

  static async editMeaning(body: EditMeaningReqT): Promise<EditMeaningResT> {
    return this.patch<EditMeaningResT>(`${this.baseURL}/en/word/meaning`, body);
  }

  static async deleteMeaning(id: string | number): Promise<DeleteMeaningResT> {
    return this.delete<DeleteMeaningResT>(`${this.baseURL}/en/word/meaning/${id}`);
  }

  static async addMeaningTranslation(body: AddMeaningTranslationReqT): Promise<AddMeaningTranslationResT> {
    return this.post<AddMeaningTranslationResT>(`${this.baseURL}/en/word/meaning-translation`, body);
  }

  static async editMeaningTranslation(body: EditMeaningTranslationReqT): Promise<EditMeaningTranslationResT> {
    return this.patch<EditMeaningTranslationResT>(`${this.baseURL}/en/word/meaning-translation`, body);
  }

  static async deleteMeaningTranslation(id: string | number): Promise<DeleteMeaningTranslationResT> {
    return this.delete<DeleteMeaningTranslationResT>(`${this.baseURL}/en/word/meaning-translation/${id}`);
  }

  private static async readNdjsonStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    handleChunk: (ch: ImportDictionaryChunkT) => void,
    onError: (err: string) => void,
  ): Promise<{ success: boolean } | ErrorResT> {
    const decoder = new TextDecoder();
    let buffer = '';

    const parseLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const d: ImportDictionaryChunkT = JSON.parse(trimmed);
        handleChunk(d);
      } catch {
        onError(ErrorCodes.unparsed_data);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(parseLine);
      }

      parseLine(buffer);
    } catch {
      return { error: true, message: ErrorCodes.failed_fetch };
    }

    return { success: true };
  }

  static async getDatasetManifest(): Promise<GetDatasetManifestResT> {
    return this.get<GetDatasetManifestResT>(`${this.baseURL}/en/dictionary/manifest`);
  }

  /** Server-side datasets the import page can offer (DICTIONARY_IMPORT_DIR) */
  static async getImportSources(): Promise<GetImportSourcesResT> {
    return this.get<GetImportSourcesResT>(`${this.baseURL}/en/dictionary/import/sources`);
  }

  /** What the import slot holds: a running (automatic or manual) import, or how the last one ended (issue #268) */
  static async getImportStatus(): Promise<GetImportStatusResT> {
    return this.get<GetImportStatusResT>(`${this.baseURL}/en/dictionary/import/status`);
  }

  /**
   * Imports the published dataset (empty body) or a dataset the server can
   * read (`source: { kind: 'file', path }`). The dataset version comes back
   * from the server (manifest.json), the client never sends one
   */
  static async importDictionary(
    body: ImportDictionaryReqT,
    handleChunk: (ch: ImportDictionaryChunkT) => void,
    onError: (err: string) => void,
  ): Promise<{ success: boolean } | ErrorResT> {
    const reader = await AbstractBaseApi.stream(`${this.baseURL}/en/dictionary/import`, {
      method: 'POST',
      body: body as BodyInit,
    });

    if ('error' in reader) {
      return reader;
    }

    return this.readNdjsonStream(reader, handleChunk, onError);
  }

  /**
   * Imports a dataset from the admin's machine: one zip produced by the
   * export (`archive`), or its files in their own slots (`words`,
   * `phrasal_verbs`, `grammar_patterns`, `phrases`, `manifest`); `manual`
   * carries manifest values typed by hand, which win over a manifest file
   */
  static async uploadDictionary(
    files: Partial<Record<string, File>>,
    manual: UploadDictionaryReqT,
    handleChunk: (ch: ImportDictionaryChunkT) => void,
    onError: (err: string) => void,
  ): Promise<{ success: boolean } | ErrorResT> {
    const body = new FormData();
    for (const [field, file] of Object.entries(files)) {
      if (file) body.append(field, file, file.name);
    }
    for (const [field, value] of Object.entries(manual)) {
      if (value !== undefined && value !== '') body.append(field, String(value));
    }
    const reader = await AbstractBaseApi.stream(`${this.baseURL}/en/dictionary/import/upload`, {
      method: 'POST',
      body,
    });

    if ('error' in reader) {
      return reader;
    }

    return this.readNdjsonStream(reader, handleChunk, onError);
  }

  static async exportDictionary(
    handleChunk: (ch: ImportDictionaryChunkT) => void,
    onError: (err: string) => void,
  ): Promise<{ success: boolean } | ErrorResT> {
    const reader = await AbstractBaseApi.stream(`${this.baseURL}/en/dictionary/export`);

    if ('error' in reader) {
      return reader;
    }

    return this.readNdjsonStream(reader, handleChunk, onError);
  }

  static async downloadExportedFile(
    exportId: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<DownloadedFileT | ErrorResT> {
    return this.downloadFile(`${this.baseURL}/en/dictionary/export/download/${exportId}`, {}, onProgress);
  }

  // The datasets of the instance (issue #527): one schema each on Postgres,
  // one of them active; on SQLite the list has its one dataset and the
  // structural calls answer 409 `datasets_not_supported`
  static async getDatasets(): Promise<GetDatasetsResT> {
    return this.get<GetDatasetsResT>(`${this.baseURL}/en/datasets`);
  }

  /**
   * Installs a dataset of the catalog from the file of its source (or
   * updates an installed one): `file` is what the catalog tells to download,
   * `pronunciations` the optional CMUdict file. The server converts and
   * imports; the progress streams back like the one of an import
   */
  static async installDataset(
    name: string,
    files: Partial<Record<string, File>>,
    handleChunk: (ch: ImportDictionaryChunkT) => void,
    onError: (err: string) => void,
  ): Promise<{ success: boolean } | ErrorResT> {
    const body = new FormData();
    for (const [field, file] of Object.entries(files)) {
      if (file) body.append(field, file, file.name);
    }
    const reader = await AbstractBaseApi.stream(
      `${this.baseURL}/en/datasets/${encodeURIComponent(name)}/install`,
      { method: 'POST', body },
    );

    if ('error' in reader) {
      return reader;
    }

    return this.readNdjsonStream(reader, handleChunk, onError);
  }

  static async activateDataset(name: string): Promise<DatasetResT> {
    return this.post<DatasetResT>(`${this.baseURL}/en/datasets/${encodeURIComponent(name)}/activate`, {});
  }

  static async deleteDataset(name: string): Promise<DeleteDatasetResT> {
    return this.delete<DeleteDatasetResT>(`${this.baseURL}/en/datasets/${encodeURIComponent(name)}`);
  }

  static async getAuditLog(query: ListAuditQueryT): Promise<ListAuditResT> {
    return this.get<AuditListT>(`${this.baseURL}/en/audit`, { query });
  }

  static async getStatistics(): Promise<GetEnStatisticsResT> {
    return this.get<EnStatisticsT>(`${this.baseURL}/en/statistics`);
  }

  static async getTranslationsStatistics(): Promise<GetEnTranslationsStatisticsResT> {
    return this.get<EnTranslationsStatisticsT>(`${this.baseURL}/en/statistics/translations`);
  }

  static async getIssuesStatistics(): Promise<GetEnIssuesStatisticsResT> {
    return this.get<EnIssuesStatisticsT>(`${this.baseURL}/en/statistics/issues`);
  }
}
