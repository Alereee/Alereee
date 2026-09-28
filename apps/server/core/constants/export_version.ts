// The version an export may write for the entries edited on the instance, in
// place of `custom_version`: what a version looks like — 1.2.0, 2026.09.28,
// v2-beta+build.5 — and nothing that would need escaping in a file
export const EXPORT_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;
export const EXPORT_VERSION_MAX_LENGTH = 64;

export const isExportVersion = (value: string): boolean =>
  value.length <= EXPORT_VERSION_MAX_LENGTH && EXPORT_VERSION_PATTERN.test(value);
