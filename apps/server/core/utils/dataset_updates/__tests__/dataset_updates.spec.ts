import { describe, expect, it } from '@jest/globals';
import { DATASET_CATALOG, DatasetUpdateCheckT, findCatalogEntry } from '../../../constants/dataset_catalog';
import { dayOfVersion, editionOfTag, isComparableVersion, isUpdateWorthTelling, versionOfDay } from '../index';

// Whether the source has a file worth installing (issue #530)

const EXTRACT: DatasetUpdateCheckT = {
  kind: 'last_modified',
  url: 'https://x.example/f',
  notice_after_days: 30,
};
const RELEASES: DatasetUpdateCheckT = {
  kind: 'latest_release',
  api_url: 'https://x.example/latest',
  tag_pattern: '^(\\d{4})-edition$',
};

describe('the versions of a dataset of a public source', () => {
  it('reads a day from a version and writes it back', () => {
    expect(versionOfDay(new Date('2026-09-25T10:02:34Z'))).toBe('2026.09.25');
    expect(dayOfVersion('2026.09.25')).toEqual(new Date('2026-09-25T00:00:00Z'));
    for (const version of ['2025', '3.1', '2026.9.25', '2026.02.31', '2026.13.01', '', null, undefined]) {
      expect(dayOfVersion(version)).toBeNull();
    }
  });

  it('tells of an extract when it is a month newer than the installed one, and not before', () => {
    expect(isUpdateWorthTelling(EXTRACT, '2026.09.25', '2026.09.25')).toBe(false);
    expect(isUpdateWorthTelling(EXTRACT, '2026.09.25', '2026.10.24')).toBe(false);
    expect(isUpdateWorthTelling(EXTRACT, '2026.09.25', '2026.10.25')).toBe(true);
    expect(isUpdateWorthTelling(EXTRACT, '2026.09.25', '2027.01.01')).toBe(true);
    // an older file of the source is no update
    expect(isUpdateWorthTelling(EXTRACT, '2026.09.25', '2026.01.01')).toBe(false);
  });

  it('tells of any newer edition of a release, compared by numbers', () => {
    expect(isUpdateWorthTelling(RELEASES, '2025', '2026')).toBe(true);
    expect(isUpdateWorthTelling(RELEASES, '2025', '2025')).toBe(false);
    expect(isUpdateWorthTelling(RELEASES, '2026', '2025')).toBe(false);
    expect(isUpdateWorthTelling(RELEASES, '3.9', '3.10')).toBe(true);
    expect(isUpdateWorthTelling(RELEASES, '3.1', '3.1.0')).toBe(false);
  });

  it('guesses nothing about a version it cannot compare', () => {
    // installed before the versions were read from the files: the day of the installation
    expect(isUpdateWorthTelling(RELEASES, '2026.09.27', '2027')).toBe(false);
    expect(isUpdateWorthTelling(RELEASES, 'custom', '2027')).toBe(false);
    expect(isUpdateWorthTelling(EXTRACT, '2025', '2026.10.25')).toBe(false);
    // nothing installed, or a source that did not answer
    expect(isUpdateWorthTelling(EXTRACT, null, '2026.10.25')).toBe(false);
    expect(isUpdateWorthTelling(EXTRACT, '2026.09.25', null)).toBe(false);
    expect(isUpdateWorthTelling({ kind: 'none' }, '3.1', '3.2')).toBe(false);
  });

  it('knows which versions say what file a dataset holds', () => {
    expect(isComparableVersion(EXTRACT, '2026.09.25')).toBe(true);
    expect(isComparableVersion(RELEASES, '2025')).toBe(true);
    expect(isComparableVersion(RELEASES, '3.1')).toBe(true);
    // the day of an installation says nothing of an edition
    expect(isComparableVersion(RELEASES, '2026.09.27')).toBe(false);
    expect(isComparableVersion(EXTRACT, '2025')).toBe(false);
    expect(isComparableVersion(EXTRACT, null)).toBe(false);
    expect(isComparableVersion({ kind: 'none' }, '3.1')).toBe(false);
  });

  it('reads the edition from the tag of a release', () => {
    expect(editionOfTag('2025-edition', '^(\\d{4})-edition$')).toBe('2025');
    expect(editionOfTag('v2025', '^(\\d{4})-edition$')).toBeNull();
    expect(editionOfTag('', '^(\\d{4})-edition$')).toBeNull();
  });
});

describe('the catalog says where a newer file is looked for', () => {
  it('asks the sources that publish new files, over https, and none that does not', () => {
    expect(DATASET_CATALOG.map((entry) => [entry.name, entry.update_check.kind])).toEqual([
      ['default', 'none'],
      ['wiktionary', 'last_modified'],
      ['wordnet', 'latest_release'],
      ['wordnet_princeton', 'none'],
    ]);
    for (const { update_check: check } of DATASET_CATALOG) {
      if (check.kind === 'last_modified') expect(check.url).toMatch(/^https:\/\//);
      if (check.kind === 'latest_release') {
        expect(check.api_url).toMatch(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/latest$/);
        expect(() => new RegExp(check.tag_pattern)).not.toThrow();
      }
    }
  });

  it('checks the file the instruction of the dataset tells to download', () => {
    const wiktionary = findCatalogEntry('wiktionary');
    if (wiktionary?.install.kind !== 'convert' || wiktionary.update_check.kind !== 'last_modified') {
      throw new Error('the catalog entry of Wiktionary changed its shape');
    }
    expect(wiktionary.update_check.url).toBe(wiktionary.install.files[0].url);
    expect(wiktionary.update_check.notice_after_days).toBe(30);

    const wordnet = findCatalogEntry('wordnet');
    if (wordnet?.update_check.kind !== 'latest_release') throw new Error('no releases of the WordNet');
    // the tag of the release the instruction links is an edition by the pattern
    expect(new RegExp(wordnet.update_check.tag_pattern).exec('2025-edition')?.[1]).toBe('2025');
  });
});
