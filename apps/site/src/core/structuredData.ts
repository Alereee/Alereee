import { DATASET_URL, REPO_URL } from '@/content/repo';
import { DatasetTermsT, OWN_DATASET_SOURCE, OWN_DATASET_TERMS } from '@/core/datasetTerms';
import { SITE_NAME, siteUrl } from './site';

// Structured data for search engines (issues #350, #480): plain objects for
// the JSON-LD script of a page, built here so a spec can hold their shape.
// Every URL is absolute (the public origin), every graph names its language

export const DATA_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const CODE_LICENSE_URL = 'https://opensource.org/license/mit';
const AUTHOR = { '@type': 'Person', name: 'Aleksei Ryzhov', url: 'https://github.com/Fristail27' } as const;

export type JsonLdT = { '@context': 'https://schema.org'; '@type': string } & Record<string, unknown>;

const pageUrl = (locale: string, path: string): string => `${siteUrl()}/${locale}${path}`;

/** The site with its word search, for a sitelinks search box (the landing) */
export const webSiteJsonLd = ({ locale, description }: { locale: string; description: string }): JsonLdT => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: pageUrl(locale, ''),
  description,
  inLanguage: locale,
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${pageUrl(locale, '/word')}?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
});

/** The project as software: the repository, the languages, the licence, the release (the landing) */
export const softwareSourceCodeJsonLd = ({
  locale,
  description,
  version,
}: {
  locale: string;
  description: string;
  version: string;
}): JsonLdT => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: SITE_NAME,
  description,
  url: pageUrl(locale, ''),
  codeRepository: REPO_URL,
  programmingLanguage: ['TypeScript', 'Python'],
  runtimePlatform: 'Node.js',
  license: CODE_LICENSE_URL,
  version,
  author: AUTHOR,
});

export type BreadcrumbT = { name: string; path: string };

/** The trail to a page: docs index → page, words → headword */
export const breadcrumbJsonLd = (locale: string, items: readonly BreadcrumbT[]): JsonLdT => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: pageUrl(locale, item.path),
  })),
});

/** A documentation page, in the language of the file it renders */
export const techArticleJsonLd = ({
  locale,
  path,
  headline,
  description,
  inLanguage,
  dateModified,
}: {
  locale: string;
  path: string;
  headline: string;
  description?: string;
  inLanguage: string;
  dateModified: Date;
}): JsonLdT => ({
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline,
  ...(description ? { description } : {}),
  url: pageUrl(locale, path),
  inLanguage,
  dateModified: dateModified.toISOString(),
  license: CODE_LICENSE_URL,
  author: AUTHOR,
  isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: pageUrl(locale, '') },
});

// where the set of terms comes from: the published dataset of the project,
// or what the served dataset names as its source (issue #527)
const sourceOf = (terms: DatasetTermsT): string | null =>
  terms.source === OWN_DATASET_SOURCE ? DATASET_URL : terms.attribution_url;

/**
 * A headword as a term of the dictionary: the set it belongs to carries the
 * licence of the data the instance serves
 */
export const definedTermJsonLd = ({
  locale,
  word,
  description,
  terms = OWN_DATASET_TERMS,
}: {
  locale: string;
  word: string;
  description?: string;
  terms?: DatasetTermsT;
}): JsonLdT => ({
  '@context': 'https://schema.org',
  '@type': 'DefinedTerm',
  name: word,
  termCode: word,
  ...(description ? { description } : {}),
  url: pageUrl(locale, `/word/${encodeURIComponent(word)}`),
  inLanguage: 'en',
  inDefinedTermSet: {
    '@type': 'DefinedTermSet',
    name: `${SITE_NAME} English dictionary`,
    url: pageUrl(locale, '/word'),
    inLanguage: 'en',
    ...(terms.license_url ? { license: terms.license_url } : {}),
    ...(sourceOf(terms) ? { sameAs: sourceOf(terms) } : {}),
  },
});
