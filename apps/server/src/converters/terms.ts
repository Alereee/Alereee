import { catalogTerms, findCatalogEntryOfAdapter } from '../../core/constants/dataset_catalog';
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
