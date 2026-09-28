import { catalogTerms, findCatalogEntryOfAdapter, licenseFileOf } from '../../core/constants/dataset_catalog';
import { ManifestProvenanceT } from '../../types';

/**
 * The terms an adapter writes into its manifest: the ones the catalog of
 * datasets states for it (core/constants/dataset_catalog.ts) — one place
 * says what a source asks for, the converter and the instance repeat it
 */
export const termsOfAdapter = (
  adapter: string,
  options: Record<string, string>,
): Required<ManifestProvenanceT> => {
  const entry = findCatalogEntryOfAdapter(adapter, options);
  if (!entry) throw new Error(`The catalog of datasets has no entry for the adapter "${adapter}"`);
  const { language: _language, ...terms } = catalogTerms(entry);
  return terms;
};

/** The LICENSE file of a converted dataset; undefined for an adapter the catalog does not know (a test's own) */
export const licenseOfAdapter = (adapter: string, options: Record<string, string>): string | undefined => {
  const entry = findCatalogEntryOfAdapter(adapter, options);
  return entry ? licenseFileOf(entry) : undefined;
};
