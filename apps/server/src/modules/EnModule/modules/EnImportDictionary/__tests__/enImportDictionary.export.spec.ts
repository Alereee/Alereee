import '../../../__tests__/helpers/clearDatabaseUrl';
import { WordRowsService } from '../../../word-rows.service';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Writable } from 'node:stream';
import * as path from 'node:path';
import * as os from 'node:os';
import { type Response } from 'express';

// The export flow unlinks the intermediate jsonl files right after zipping them.
// Keep them on disk so the test can validate the NDJSON content line by line.
jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, unlink: jest.fn(async () => undefined) };
});

import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnMeaning } from '../../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../../entities/en_short_translation.entity';
import { EnService } from '../../../en.service';
import { EnShortTranslationService } from '../../EnShortTranslation/enShortTranslation.service';
import { EnMeaningService } from '../../EnMeaning/enMeaning.service';
import { EnMeaningTranslationService } from '../../EnMeaningTranslation/enMeaningTranslation.service';
import { EnImportDictionaryService, ExportOptionsT } from '../enImportDictionary.service';
import { SettingsService } from '../../../../SettingsModule/settings.service';
import { EnDictionaryImportPhasesE } from '../constants';
import {
  AvailableTranslationLanguagesE,
  CustomVersionDictionaryOfWord,
  EnMeaningT,
  EnPartOfSpeechE,
  EnShortTranslationT,
  EnWordFormsE,
  EnWordT,
} from '../../../../../../types';

type ProgressChunk = {
  percent: number;
  stage: EnDictionaryImportPhasesE;
  exportId?: string;
};

class FakeProgressRes {
  chunks: string[] = [];
  ended = false;
  setHeader = jest.fn();
  write = (chunk: string) => {
    this.chunks.push(chunk);
    return true;
  };
  end = () => {
    this.ended = true;
  };
}

class FakeDownloadRes extends Writable {
  headers: Record<string, unknown> = {};
  buffers: Buffer[] = [];
  setHeader(key: string, value: unknown) {
    this.headers[key] = value;
  }
  override _write(chunk: Buffer, _encoding: string, callback: () => void) {
    this.buffers.push(Buffer.from(chunk));
    callback();
  }
}

describe('EnImportDictionaryService NDJSON export (issue #187)', () => {
  let ds: DataSource;
  let service: EnImportDictionaryService;
  let progressRes: FakeProgressRes;
  let exportId: string;
  let runDir: string;
  let zipPath: string;

  const makeWordBody = (word: string, extra: Partial<EnWordT> = {}): EnWordT =>
    ({
      word,
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      forms: [{ word: `${word}s`, form_of_word: EnWordFormsE.third_person_singular }] as EnWordT['forms'],
      meanings: [
        {
          title: 'to move fast',
          definition: 'to move fast on foot',
          sort_order: 1,
          examples: [],
          translations: [
            {
              title: 'бежать',
              definition: 'быстро перемещаться',
              language: AvailableTranslationLanguagesE.ru,
            },
          ],
        },
      ] as unknown as EnMeaningT[],
      short_translations: [
        {
          language: AvailableTranslationLanguagesE.ru,
          description: 'бежать',
          variants_of_words: ['бежать'],
        },
      ] as unknown as EnShortTranslationT[],
      ...extra,
    }) as EnWordT;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();

    const shortTranslationService = new EnShortTranslationService(
      ds.getRepository(EnWord),
      ds.getRepository(EnShortTranslation),
    );
    const meaningTranslationService = new EnMeaningTranslationService(
      ds.getRepository(EnMeaning),
      ds.getRepository(EnMeaningTranslation),
    );
    const meaningService = new EnMeaningService(
      ds.getRepository(EnWord),
      ds.getRepository(EnMeaning),
      meaningTranslationService,
    );
    const enService = new EnService(
      ds.getRepository(EnWord),
      ds,
      shortTranslationService,
      meaningService,
      new WordRowsService(ds),
    );

    const settingsService = { upsert: jest.fn() } as unknown as SettingsService;
    service = new EnImportDictionaryService(ds.getRepository(EnWord), new WordRowsService(ds), settingsService);

    await enService.addWord(makeWordBody('run'));
    // a phrasal pair so the export produces a phrasal-verbs linking line
    await enService.addWord(makeWordBody('give', { forms: [] }));
    await enService.addWord(
      makeWordBody('give up', {
        forms: [],
        verb___is_phrasal: true,
        base_phrasal: 'give',
      } as unknown as Partial<EnWordT>),
    );
    await enService.addWord(
      makeWordBody('in the long run', {
        part_of_speech: EnPartOfSpeechE.phrase,
        forms: [],
        // synonyms are links to the entries added above (issue #259)
        meanings: [
          {
            title: 'eventually',
            definition: 'over a long period of time',
            sort_order: 1,
            examples: [],
            synonyms: ['run', 'Give up'],
            // antonyms are exported next to them (issue #266)
            antonyms: ['give'],
            translations: [],
          },
        ] as unknown as EnMeaningT[],
      }),
    );
    await enService.addWord(
      makeWordBody('would rather + verb', {
        part_of_speech: EnPartOfSpeechE.grammar_pattern,
        pattern: ['would rather', 'verb'],
        forms: [],
      }),
    );

    progressRes = new FakeProgressRes();
    await service.exportDictionary(progressRes as unknown as Response);

    const finalChunk = JSON.parse(progressRes.chunks[progressRes.chunks.length - 1]) as ProgressChunk;
    exportId = finalChunk.exportId as string;
    runDir = path.join(os.tmpdir(), 'vocab-bloom-export', exportId);
    zipPath = path.join(os.tmpdir(), 'vocab-bloom-export', `${exportId}.zip`);
  });

  afterAll(async () => {
    // Cancel the pending TTL cleanup timer so Jest can exit, then wipe tmp files
    const pending = (service as unknown as { pendingExports: Map<string, { timeout: NodeJS.Timeout }> })
      .pendingExports;
    for (const entry of pending.values()) clearTimeout(entry.timeout);
    await rm(runDir, { recursive: true, force: true });
    await rm(zipPath, { force: true });
    await ds.destroy();
  });

  const readJsonlLines = (fileName: string): Record<string, unknown>[] =>
    readFileSync(path.join(runDir, fileName), 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  it('streams progress as NDJSON and finishes with the export id', () => {
    expect(progressRes.ended).toBe(true);
    // every written chunk is exactly one JSON line
    for (const chunk of progressRes.chunks) {
      expect(chunk.endsWith('\n')).toBe(true);
      expect(() => JSON.parse(chunk)).not.toThrow();
    }

    const finalChunk = JSON.parse(progressRes.chunks[progressRes.chunks.length - 1]) as ProgressChunk;
    expect(finalChunk.percent).toBe(100);
    expect(finalChunk.stage).toBe(EnDictionaryImportPhasesE.completed);
    expect(typeof finalChunk.exportId).toBe('string');
  });

  it('writes words as one JSON object per line without system fields', () => {
    const lines = readJsonlLines('vocab-bloom-hub-en-words.jsonl');

    expect(lines).toHaveLength(3);
    const word = lines.find((l) => l.word === 'run') as Record<string, unknown>;
    expect(word.word).toBe('run');
    expect(word.part_of_speech).toBe(EnPartOfSpeechE.verb);
    expect(word.forms).toEqual([
      expect.objectContaining({ word: 'runs', form_of_word: EnWordFormsE.third_person_singular }),
    ]);
    // the collections live in their own files (issue #442)
    expect(word).not.toHaveProperty('meanings');
    expect(word).not.toHaveProperty('short_translations');

    // system fields are stripped everywhere by cleanEntity
    const raw = JSON.stringify(lines);
    expect(raw).not.toContain('"id"');
    expect(raw).not.toContain('"createdAt"');
    expect(raw).not.toContain('"updateAt"');
  });

  it('writes the meanings, their translations and the short translations as one line per row next to the key of the entry (issue #442)', () => {
    const meanings = readJsonlLines('vocab-bloom-hub-en-meanings.jsonl');
    // every entry of every file has one meaning; the lines follow the entry order
    expect(meanings.map((l) => [l.word, l.part_of_speech, l.title])).toEqual([
      ['give', EnPartOfSpeechE.verb, 'to move fast'],
      ['give up', EnPartOfSpeechE.verb, 'to move fast'],
      ['in the long run', EnPartOfSpeechE.phrase, 'eventually'],
      ['run', EnPartOfSpeechE.verb, 'to move fast'],
      ['would rather + verb', EnPartOfSpeechE.grammar_pattern, 'to move fast'],
    ]);
    const run = meanings.find((l) => l.word === 'run') as Record<string, unknown>;
    expect(run).toEqual(
      expect.objectContaining({
        definition: 'to move fast on foot',
        sort_order: 1,
        synonyms: [],
        antonyms: [],
      }),
    );
    expect(run).not.toHaveProperty('translations');

    // one file per language: the dictionary has Russian rows only, so one file
    const translations = readJsonlLines('vocab-bloom-hub-en-meaning-translations.ru.jsonl');
    expect(existsSync(path.join(runDir, 'vocab-bloom-hub-en-meaning-translations.es.jsonl'))).toBe(false);
    // the phrase has no translations; the others carry the Russian one, keyed by the meaning
    expect(
      translations.map((l) => [l.word, l.meaning_sort_order, l.meaning_title, l.language, l.title]),
    ).toEqual([
      ['give', 1, 'to move fast', AvailableTranslationLanguagesE.ru, 'бежать'],
      ['give up', 1, 'to move fast', AvailableTranslationLanguagesE.ru, 'бежать'],
      ['run', 1, 'to move fast', AvailableTranslationLanguagesE.ru, 'бежать'],
      ['would rather + verb', 1, 'to move fast', AvailableTranslationLanguagesE.ru, 'бежать'],
    ]);
    expect(translations[0]).toEqual(
      expect.objectContaining({ part_of_speech: EnPartOfSpeechE.verb, definition: 'быстро перемещаться' }),
    );

    const shorts = readJsonlLines('vocab-bloom-hub-en-short-translations.ru.jsonl');
    expect(shorts.map((l) => [l.word, l.part_of_speech, l.language, l.description])).toEqual([
      ['give', EnPartOfSpeechE.verb, AvailableTranslationLanguagesE.ru, 'бежать'],
      ['give up', EnPartOfSpeechE.verb, AvailableTranslationLanguagesE.ru, 'бежать'],
      ['in the long run', EnPartOfSpeechE.phrase, AvailableTranslationLanguagesE.ru, 'бежать'],
      ['run', EnPartOfSpeechE.verb, AvailableTranslationLanguagesE.ru, 'бежать'],
      ['would rather + verb', EnPartOfSpeechE.grammar_pattern, AvailableTranslationLanguagesE.ru, 'бежать'],
    ]);
    expect(shorts[0].variants_of_words).toEqual(['бежать']);

    const raw = JSON.stringify([...meanings, ...translations, ...shorts]);
    expect(raw).not.toContain('"id"');
    expect(raw).not.toContain('"createdAt"');
  });

  it('exports phrases and grammar patterns into their own NDJSON files', () => {
    const phrases = readJsonlLines('vocab-bloom-hub-en-phrases.jsonl');
    expect(phrases).toHaveLength(1);
    expect(phrases[0].phrase).toBe('in the long run');
    expect(phrases[0]).not.toHaveProperty('part_of_speech');
    // synonyms are exported in the meanings file as word + part of speech,
    // sorted by word; "run" is a verb here because the phrase has no verb
    // sense and run's only base form is the verb
    const eventually = readJsonlLines('vocab-bloom-hub-en-meanings.jsonl').find(
      (l) => l.word === 'in the long run',
    );
    expect(eventually).toEqual(
      expect.objectContaining({
        part_of_speech: EnPartOfSpeechE.phrase,
        title: 'eventually',
        synonyms: [
          { word: 'give up', part_of_speech: EnPartOfSpeechE.verb },
          { word: 'run', part_of_speech: EnPartOfSpeechE.verb },
        ],
        antonyms: [{ word: 'give', part_of_speech: EnPartOfSpeechE.verb }],
      }),
    );

    const grammar = readJsonlLines('vocab-bloom-hub-en-grammar-patterns.jsonl');
    expect(grammar).toHaveLength(1);
    expect(grammar[0].phrase).toBe('would rather + verb');
    expect(grammar[0].pattern).toEqual(['would rather', 'verb']);
  });

  it('exports the phrasal-verbs linking file and a manifest matching the jsonl line counts', () => {
    // one line per base verb that has phrasal variants; run and give up have none
    const phrasal = readJsonlLines('vocab-bloom-hub-en-phrasal-verbs.jsonl');
    expect(phrasal).toEqual([{ word: 'give', phrasal_variants: ['give up'] }]);

    const manifest = JSON.parse(readFileSync(path.join(runDir, 'manifest.json'), 'utf-8')) as {
      version: string;
      generatedAt: string;
      files: Record<string, { lines: number }>;
      synonym_links: number;
      antonym_links: number;
      license: string;
      attribution: string;
    };
    expect(typeof manifest.version).toBe('string');
    expect(manifest.version.length).toBeGreaterThan(0);
    // the terms of the data travel with every export (issue #270)
    expect(manifest.license).toBe('CC-BY-4.0');
    expect(manifest.attribution).toContain('CC BY 4.0');
    // "in the long run" links to run and give up (issue #259)
    expect(manifest.synonym_links).toBe(2);
    expect(manifest.antonym_links).toBe(1);
    expect(manifest.files).toEqual({
      'vocab-bloom-hub-en-words.jsonl': { lines: 3 },
      'vocab-bloom-hub-en-phrasal-verbs.jsonl': { lines: 1 },
      'vocab-bloom-hub-en-grammar-patterns.jsonl': { lines: 1 },
      'vocab-bloom-hub-en-phrases.jsonl': { lines: 1 },
      'vocab-bloom-hub-en-meanings.jsonl': { lines: 5 },
      'vocab-bloom-hub-en-meaning-translations.ru.jsonl': { lines: 4 },
      'vocab-bloom-hub-en-short-translations.ru.jsonl': { lines: 5 },
      // the five words were made through the admin services: an edit each (issue #531)
      'vocab-bloom-hub-en-changes.jsonl': { lines: 5 },
    });
  });

  // issue #531: the words of this dictionary were made through the admin services, not imported
  it('says in the manifest and in the LICENSE of the copy how many entries differ from the source', () => {
    const manifest = JSON.parse(readFileSync(path.join(runDir, 'manifest.json'), 'utf-8')) as {
      modified_entries?: number;
    };
    expect(manifest.modified_entries).toBe(5);

    const license = readFileSync(path.join(runDir, 'LICENSE'), 'utf-8');
    expect(license).toContain('Vocab Bloom Hub English dataset');
    expect(license).toContain('License: Creative Commons Attribution 4.0 International (CC-BY-4.0)');
    expect(license).toContain('This copy differs from its source: 5 of its entries were changed or added');
  });

  it('carries the history of the edits, a line per edit with its values and without the ids of this database', () => {
    const lines = readJsonlLines('vocab-bloom-hub-en-changes.jsonl');

    expect(lines.map((line) => [line.headword, line.part_of_speech, line.entity, line.action])).toEqual([
      ['run', 'verb', 'word', 'create'],
      ['give', 'verb', 'word', 'create'],
      ['give up', 'verb', 'word', 'create'],
      ['in the long run', 'phrase', 'word', 'create'],
      ['would rather + verb', 'grammar_pattern', 'word', 'create'],
    ]);
    expect(Object.keys(lines[0]).sort()).toEqual([
      'action',
      'author',
      'created_at',
      'diff',
      'entity',
      'headword',
      'origin',
      'part_of_speech',
      'record',
      'superseded_at',
    ]);
    expect(lines[0]).toEqual(
      expect.objectContaining({ origin: 'admin', author: null, superseded_at: null, record: null }),
    );
    expect(Date.parse(lines[0].created_at as string)).not.toBeNaN();
    const diff = lines[0].diff as Record<string, { before: unknown; after: unknown }>;
    expect(diff.meanings.after).toEqual([expect.objectContaining({ title: 'to move fast' })]);
  });

  it('exports the entries edited here under the version the owner names, and leaves the dictionary alone', async () => {
    const words = ds.getRepository(EnWord);
    const pattern = await words.findOneOrFail({
      where: { part_of_speech: EnPartOfSpeechE.grammar_pattern },
      relations: { word: true },
    });
    const run = await words
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .where('entry.word = :word', { word: 'run' })
      .andWhere('w.form_of_word = :form', { form: EnWordFormsE.base_form })
      .getOneOrFail();
    // as an edit in the admin UI leaves them
    await words.update({ id: In([run.id, pattern.id]) }, { version: CustomVersionDictionaryOfWord });

    const exportTo = async (options?: ExportOptionsT) => {
      const res = new FakeProgressRes();
      await service.exportDictionary(res as unknown as Response, options);
      const { exportId: id } = JSON.parse(res.chunks[res.chunks.length - 1]) as ProgressChunk;
      const dir = path.join(os.tmpdir(), 'vocab-bloom-export', id as string);
      const versions = (fileName: string) =>
        Object.fromEntries(
          readFileSync(path.join(dir, fileName), 'utf-8')
            .split('\n')
            .filter((line) => line.trim())
            // a phrase and a grammar pattern are named by `phrase`
            .map((line) => JSON.parse(line) as { word?: string; phrase?: string; version: string })
            .map((line) => [line.word ?? line.phrase, line.version]),
        );
      const result = {
        words: versions('vocab-bloom-hub-en-words.jsonl'),
        patterns: versions('vocab-bloom-hub-en-grammar-patterns.jsonl'),
      };
      await rm(dir, { recursive: true, force: true });
      await rm(path.join(os.tmpdir(), 'vocab-bloom-export', `${id}.zip`), { force: true });
      return result;
    };

    try {
      const asIs = await exportTo();
      expect(asIs.words.run).toBe(CustomVersionDictionaryOfWord);
      expect(asIs.patterns['would rather + verb']).toBe(CustomVersionDictionaryOfWord);

      const named = await exportTo({ editedVersion: '2.1.0' });
      expect(named.words.run).toBe('2.1.0');
      expect(named.patterns['would rather + verb']).toBe('2.1.0');
      // an entry nobody edited keeps the version of its dataset
      expect(named.words.give).toBe(asIs.words.give);
      expect(named.words.give).not.toBe('2.1.0');

      // the database holds what it held
      expect((await words.findOneByOrFail({ id: run.id })).version).toBe(CustomVersionDictionaryOfWord);
    } finally {
      await words.update({ id: In([run.id, pattern.id]) }, { version: run.version });
    }
  });

  it('packs the archive and serves it once via streamExportFile', async () => {
    expect(existsSync(zipPath)).toBe(true);

    const downloadRes = new FakeDownloadRes();
    await service.streamExportFile(exportId, downloadRes as unknown as Response);

    const bytes = Buffer.concat(downloadRes.buffers);
    // zip local file header magic
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(downloadRes.headers['Content-Type']).toBe('application/zip');
    expect(downloadRes.headers['Content-Length']).toBe(bytes.length);

    // the export is one-shot: a second download attempt is rejected
    await expect(
      service.streamExportFile(exportId, new FakeDownloadRes() as unknown as Response),
    ).rejects.toThrow(NotFoundException);
  });
});
