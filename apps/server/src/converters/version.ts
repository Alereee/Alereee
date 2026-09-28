import { stat, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { isExportVersion } from '../../core/constants/export_version';
import { versionOfDay } from '../../core/utils/dataset_updates';
import { archiveEntries, gzipModifiedAt, packingOf } from './unpack';

// The version of a dataset of a public source (issue #530) is what the
// file of the source says of itself: the day the extract of Wiktionary was
// made, the edition of a WordNet. Nothing is asked of the source and nothing
// is typed by an admin, so two instances that installed the same file
// record the same version — with a network or without one.

export { versionOfDay };

// a date no extract can carry: the first ones are of 2020, and none is of the future
const EARLIEST_EXTRACT = Date.UTC(2015, 0, 1);
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * The day a gzipped extract was made, as the version of the dataset
 * converted from it. Null for a plain file and for a header that carries no
 * date a source could have written: the extract was packed again
 */
export const versionOfExtract = async (file: string, now: Date = new Date()): Promise<string | null> => {
  const madeAt = await gzipModifiedAt(file);
  if (!madeAt) return null;
  const instant = madeAt.getTime();
  if (instant < EARLIEST_EXTRACT || instant > now.getTime() + CLOCK_SKEW_MS) return null;
  return versionOfDay(madeAt);
};

/** The files and folders a release of WordNet holds: the entries of its archive, or of its folder */
export const releaseEntries = async (input: string): Promise<string[]> => {
  if (!(await stat(input)).isDirectory()) {
    return (await packingOf(input)) === 'plain' ? [] : archiveEntries(input);
  }
  // an unpacked release: the name of the folder is a part of what it says
  const folder = path.basename(path.resolve(input));
  return (await readdir(input)).map((name) => `${folder}/${name}`);
};

const OPEN_ENGLISH_WORDNET_FOLDER = /(?:^|\/)oewn(\d{4})(?:\/|$)/;
const PRINCETON_LOG = /(?:^|\/)log\.grind\.(\d+(?:\.\d+)+)$/;

/** The edition of the Open English WordNet: the year its folder is named after, `oewn2025/` */
export const editionOfOpenEnglishWordnet = (entries: readonly string[]): string | null => {
  for (const entry of entries) {
    const match = OPEN_ENGLISH_WORDNET_FOLDER.exec(entry);
    if (match) return match[1];
  }
  return null;
};

/** The version of a Princeton WordNet: the one its build log is named after, `dict/log.grind.3.1` */
export const versionOfPrincetonWordnet = (entries: readonly string[]): string | null => {
  for (const entry of entries) {
    const match = PRINCETON_LOG.exec(entry);
    if (match) return match[1];
  }
  return null;
};

/** What a file said is a version only when it looks like one: it goes into file names and the manifest */
export const asVersion = (version: string | null | undefined): string | null =>
  version && isExportVersion(version) ? version : null;
