import { BadRequestException, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { DatasetManifestT, MANIFEST_PROVENANCE_FIELDS } from '../../../../../../types';
import { ErrorCodes } from '../../../../../../core/constants/error_codes';
import { DATASET_KNOWN_FILE_NAMES, MANIFEST_FILE_NAME } from '../constants';
import { parseManifest } from '../utils/parseManifest';
import { AcquiredFileT, DatasetSource } from './types';

// Entries operating systems add to folders and archives; never dataset files
const isJunkFile = (name: string): boolean =>
  name === '.DS_Store' || name === 'Thumbs.db' || name.startsWith('._');

const DATASET_JSONL_NAMES: readonly string[] = DATASET_KNOWN_FILE_NAMES.filter((name) =>
  name.endsWith('.jsonl'),
);

/** Non-blank lines of a jsonl file — what the import will actually process */
export const countJsonlLines = (filePath: string): Promise<number> =>
  new Promise((resolve, reject) => {
    let count = 0;
    let lineHasText = false;
    createReadStream(filePath, { encoding: 'utf-8' })
      .on('data', (chunk: string) => {
        for (const ch of chunk) {
          if (ch === '\n') {
            if (lineHasText) count++;
            lineHasText = false;
          } else if (!lineHasText && ch !== '\r' && ch !== ' ' && ch !== '\t') {
            lineHasText = true;
          }
        }
      })
      .on('end', () => resolve(lineHasText ? count + 1 : count))
      .on('error', reject);
  });

/**
 * Checks a directory holds one dataset in the export format and describes
 * it: any subset of the known jsonl files (at least one), optionally a
 * manifest.json (which may list files that are absent), nothing else. The returned manifest carries line counts
 * taken from the files themselves, so the progress total is exact even for
 * hand-assembled datasets; the version and the link counts come from the
 * manifest when there is one (an empty version means "unknown").
 * Throws `dataset_invalid` otherwise.
 */
export const validateDatasetDir = async (dir: string, logger: Logger): Promise<DatasetManifestT> => {
  const reject = (reason: string): never => {
    logger.warn(`Dataset at "${dir}" rejected: ${reason}`);
    throw new BadRequestException(ErrorCodes.dataset_invalid);
  };

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => reject('not a readable directory'));
  const files = entries.filter((e) => e.isFile() && !isJunkFile(e.name)).map((e) => e.name);
  const unknown = files.filter((name) => !DATASET_KNOWN_FILE_NAMES.includes(name));
  if (unknown.length > 0) reject(`unknown files ${unknown.join(', ')}`);
  const jsonlFiles = files.filter((name) => DATASET_JSONL_NAMES.includes(name));
  if (jsonlFiles.length === 0) reject('no dataset files (*.jsonl)');

  let manifest: DatasetManifestT | null = null;
  if (files.includes(MANIFEST_FILE_NAME)) {
    manifest = await readFile(path.join(dir, MANIFEST_FILE_NAME), 'utf-8')
      .then((raw) => parseManifest(JSON.parse(raw)))
      .catch(() => null);
    if (!manifest) return reject(`${MANIFEST_FILE_NAME} is malformed`);
    const listed = Object.keys(manifest.files);
    const unknownListed = listed.filter((name) => !DATASET_JSONL_NAMES.includes(name));
    if (unknownListed.length > 0) reject(`manifest lists unknown files ${unknownListed.join(', ')}`);
    // files the manifest lists but the dataset lacks are fine: an exported
    // manifest names every file, yet only the words file may be copied over
  }

  const counted: DatasetManifestT['files'] = {};
  for (const name of jsonlFiles) {
    counted[name] = { lines: await countJsonlLines(path.join(dir, name)) };
  }
  return {
    version: manifest?.version ?? '',
    ...(manifest?.generatedAt !== undefined && { generatedAt: manifest.generatedAt }),
    ...(manifest?.synonym_links !== undefined && { synonym_links: manifest.synonym_links }),
    ...(manifest?.antonym_links !== undefined && { antonym_links: manifest.antonym_links }),
    // where the data comes from and its terms travel with it (issue #527)
    ...Object.fromEntries(
      MANIFEST_PROVENANCE_FIELDS.filter((field) => manifest?.[field] !== undefined).map((field) => [
        field,
        manifest?.[field],
      ]),
    ),
    files: counted,
  };
};

/**
 * A dataset directory in the export format. The directory is validated up
 * front, so the pipeline never starts on a half-usable dataset. With
 * `removeOnDispose` the directory is deleted at the end (extracted archives,
 * uploads).
 */
export class DirectoryDatasetSource implements DatasetSource {
  constructor(
    private readonly dir: string,
    private readonly manifest: DatasetManifestT,
    private readonly removeOnDispose: boolean,
  ) {}

  /** `overrides` are manifest values given explicitly (typed by hand); they win over manifest.json */
  static async open(
    dir: string,
    logger: Logger,
    removeOnDispose = false,
    overrides: Partial<DatasetManifestT> = {},
  ): Promise<DirectoryDatasetSource> {
    const manifest = await validateDatasetDir(dir, logger);
    const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
    return new DirectoryDatasetSource(dir, { ...manifest, ...defined }, removeOnDispose);
  }

  async readManifest(): Promise<DatasetManifestT> {
    return this.manifest;
  }

  async acquireFile(fileName: string): Promise<AcquiredFileT> {
    const filePath = path.join(this.dir, fileName);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      // a file the dataset does not carry (phrases, patterns and phrasal
      // verbs are optional): the stage imports nothing instead of failing
      return { path: '', temporary: false };
    }
    return { path: filePath, temporary: false };
  }

  async dispose(): Promise<void> {
    if (this.removeOnDispose) {
      await rm(this.dir, { recursive: true, force: true });
    }
  }
}
