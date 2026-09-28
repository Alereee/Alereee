import React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { fetchDatasetTerms } from '@/core/dictionary';
import { licenseLabel, OWN_DATASET_SOURCE } from '@/core/datasetTerms';
import { pageMeta } from '@/core/site';
import { Link } from '@/i18n/navigation';
import { LocaleParamsP } from '@/types/common';

import styles from './terms.module.scss';

// The terms follow the dataset the instance serves, so the page is rendered on
// a request: a build has no instance to ask — or asks another one — and would
// bake the terms of the wrong dataset into the page. The read of the terms
// itself is cached (fetchDatasetTerms).
export const dynamic = 'force-dynamic';

// the read of the public API that says what was changed in the entries of a headword
const HISTORY_METHOD = 'GET /api/v1/words/{word}/history';
// the one read that answers from every dataset of the instance (issue #528)
const DATASETS_METHOD = 'GET /api/v1/words/{word}/datasets';
const TERMS_IN_DETAIL = '/docs/data-license#using-data-that-was-changed-on-an-instance';

export const generateMetadata = async ({ params }: LocaleParamsP): Promise<Metadata> => {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'terms' });

  return pageMeta({ locale, path: '/dataset-terms', title: t('title'), description: t('intro') });
};

/**
 * The terms of the data the word pages show (issue #531): the license, the
 * attribution and — for a source that asks for it — the notice of the source
 * in full. The WordNet license wants its text on every copy of the data; a
 * page of a word is one. The note under every word page leads here.
 */
export default async function DatasetTermsPage({ params }: LocaleParamsP) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('terms');
  const terms = await fetchDatasetTerms();
  const isOwnData = terms.source === OWN_DATASET_SOURCE;
  // CC BY-SA and the like: what is built on the data stays under the same license
  const isShareAlike = /-SA-/.test(terms.license);

  return (
    <div className={`container ${styles.page}`}>
      <h1>{t('title')}</h1>
      <p className={styles.intro}>{t('intro')}</p>
      <dl className={styles.terms}>
        <dt>{t('source')}</dt>
        <dd>
          <code>{terms.source}</code>
        </dd>
        <dt>{t('license')}</dt>
        <dd>
          <a href={terms.license_url} rel="license noreferrer" target="_blank">
            {licenseLabel(terms.license)}
          </a>
        </dd>
        {terms.attribution && (
          <>
            <dt>{t('attribution')}</dt>
            <dd>
              {terms.attribution_url ? (
                <a href={terms.attribution_url} rel="noreferrer" target="_blank">
                  {terms.attribution}
                </a>
              ) : (
                terms.attribution
              )}
            </dd>
          </>
        )}
        {terms.notice && (
          <>
            <dt>{t('notice')}</dt>
            <dd>{terms.notice}</dd>
          </>
        )}
      </dl>
      <p>{t('modified')}</p>
      {isOwnData && (
        <p>
          <Link href="/docs/data-license">{t('own_license')}</Link>
        </p>
      )}
      {/* what the licenses ask of whoever takes the data further (issue #531) */}
      <section data-testid="terms-of-use">
        <h2>{t('use_title')}</h2>
        <p>{t('use_intro')}</p>
        <ul className={styles.use}>
          <li>{t('use_attribution')}</li>
          <li>{t('use_modified')}</li>
          <li>{t('use_history', { method: HISTORY_METHOD })}</li>
          <li>{t('use_same_license')}</li>
          {isShareAlike && <li>{t('use_share_alike')}</li>}
          {terms.license_text && <li>{t('use_notice')}</li>}
          <li>{t('use_other_datasets', { method: DATASETS_METHOD })}</li>
        </ul>
        <p>
          <Link href={TERMS_IN_DETAIL}>{t('use_more')}</Link>
        </p>
      </section>
      {terms.license_text && (
        <section>
          <h2>{t('full_text')}</h2>
          {/* the notices are English legal text, whatever the language of the page */}
          <pre className={styles.text} lang="en" dir="ltr" data-testid="license-text">
            {terms.license_text}
          </pre>
        </section>
      )}
    </div>
  );
}
