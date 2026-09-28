import type { DatasetUpdateCheckT } from '../../constants/dataset_catalog';

// Whether the source has a file worth installing (issue #530): the versions
// of a dataset are what its files say of themselves, and each kind of source
// says it its own way — a day, an edition. No imports but types: the admin
// UI may read this file too.

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_VERSION = /^(\d{4})\.(\d{2})\.(\d{2})$/;
const NUMBERS = /^\d+(\.\d+)*$/;

/** A day as a version: 2026.09.27 */
export const versionOfDay = (day: Date): string => day.toISOString().slice(0, 10).replace(/-/g, '.');

/** The day a version names, `2026.09.25`; null for a version that is not a day */
export const dayOfVersion = (version: string | null | undefined): Date | null => {
  const match = DAY_VERSION.exec(version ?? '');
  if (!match) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // 2026.02.31 is no day
  return versionOfDay(day) === version ? day : null;
};

/** 3.1 against 3.0, 2026 against 2025: by numbers, never by letters */
const compareNumbers = (a: string, b: string): number => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
};

/** The edition a release is tagged with, `2025-edition` → `2025`; null for a tag of another kind */
export const editionOfTag = (tag: string, pattern: string): string | null =>
  new RegExp(pattern).exec(tag)?.[1] ?? null;

/**
 * Whether the version a dataset is installed with says which file of its
 * source it holds: a day for an extract, an edition for a release. A
 * dataset recorded by the day of its installation — every one installed
 * before the versions were read from the files — holds an edition nobody
 * knows.
 */
export const isComparableVersion = (
  check: DatasetUpdateCheckT,
  installed: string | null | undefined,
): boolean => {
  if (!installed || check.kind === 'none') return false;
  if (check.kind === 'last_modified') return dayOfVersion(installed) !== null;
  return NUMBERS.test(installed) && dayOfVersion(installed) === null;
};

/**
 * Whether the file the source has now is worth a notice. A dataset whose
 * version cannot be compared with the one of the source — installed before
 * the versions were read from the files, or from a file that did not say —
 * gets none: nothing is guessed.
 */
export const isUpdateWorthTelling = (
  check: DatasetUpdateCheckT,
  installed: string | null | undefined,
  latest: string | null | undefined,
): boolean => {
  if (!installed || !latest || !isComparableVersion(check, installed)) return false;
  if (check.kind === 'last_modified') {
    const installedDay = dayOfVersion(installed);
    const latestDay = dayOfVersion(latest);
    if (!installedDay || !latestDay) return false;
    return latestDay.getTime() - installedDay.getTime() >= check.notice_after_days * DAY_MS;
  }
  if (!NUMBERS.test(latest)) return false;
  return compareNumbers(latest, installed) > 0;
};
