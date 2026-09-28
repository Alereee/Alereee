/** What the project's own dataset is called as a source (apps/server/core/constants/datasets.ts) */
export const OWN_DATASET_SOURCE = 'vocab-bloom-hub';

/**
 * Where the served data comes from and under which terms (issue #527): an
 * instance may serve a dataset converted from a public source — Wiktionary
 * under CC BY-SA, WordNet — and the word pages owe its readers the
 * attribution of that source, not the project's
 */
export type DatasetTermsT = {
  source: string;
  /** SPDX identifier */
  license: string;
  license_url: string;
  attribution: string;
  attribution_url: string | null;
  notice: string;
  /** The notices of the source in full, for a license that wants its text on every copy (issue #531) */
  license_text: string;
};

/** The terms of the project's dataset: what an instance of 1.0, or one that does not answer, is taken to serve */
export const OWN_DATASET_TERMS: DatasetTermsT = {
  source: OWN_DATASET_SOURCE,
  license: 'CC-BY-4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: '',
  attribution_url: null,
  notice: '',
  license_text: '',
};

/** An SPDX identifier the way a reader writes it: `CC-BY-SA-4.0` → `CC BY-SA 4.0` */
export const licenseLabel = (spdx: string): string =>
  /^CC-/.test(spdx) ? spdx.replace(/^CC-/, 'CC ').replace(/-(\d)/, ' $1') : spdx;
