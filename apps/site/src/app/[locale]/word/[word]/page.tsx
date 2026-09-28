import React from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { PublicChangeV1T, PublicWordV1MeaningT, PublicWordV1T } from 'server/types';

import { JsonLd } from '@/components/JsonLd';
import { Pronounce } from '@/components/Pronounce';
import { ReportMistake } from '@/components/ReportMistake';
import { WordSearch } from '@/components/WordSearch';
import { licenseLabel, OWN_DATASET_SOURCE } from '@/core/datasetTerms';
import {
  DictionaryUnavailableError,
  fetchDatasetTerms,
  fetchHeadword,
  fetchHeadwordHistory,
} from '@/core/dictionary';
import { pageMeta, trimDescription } from '@/core/site';
import { breadcrumbJsonLd, definedTermJsonLd } from '@/core/structuredData';
import { flagOf } from '@/core/languageFlags';
import { changesOfEntry } from '@/core/wordHistory';
import { leadDefinition, localeTranslations, translationLanguages } from '@/core/wordPage';
import { Link } from '@/i18n/navigation';
import { LocaleParamsP } from '@/types/common';

import styles from '../word.module.scss';
import { ForLanguage, TranslationLanguageProvider, TranslationPicker } from './_components/TranslationLanguage';
import { WordHistory } from './_components/WordHistory';

type WordPageP = LocaleParamsP<{ word: string }>;

// Rendered on the first request from the instance's API and regenerated
// after an hour (ISR, next.config.ts): no headword is known at build time,
// so nothing is prerendered. The API being down throws — a render that
// failed is not kept, the stale copy is served when there is one
export const revalidate = 3600;
export const generateStaticParams = () => [];

const headwordOf = async (params: WordPageP['params']) => {
  const { locale, word } = await params;

  return { locale, word: decodeURIComponent(word) };
};

const wordPath = (word: string): string => `/word/${encodeURIComponent(word)}`;

// The one URL of a headword is its normalized spelling, `meta.word` of the
// API answer (issue #480): /en/word/Bloom answered 200 with a canonical of
// its own, one indexable page per spelling variant. A 308 folds them. Where
// the dictionary holds "Test" next to "test" they are two words, and the
// API keeps the case of the one that was asked for: two pages, no redirect
const canonicalOrRedirect = (locale: string, word: string, canonical: string): void => {
  if (word !== canonical) permanentRedirect(`/${locale}${wordPath(canonical)}`);
};

export const generateMetadata = async ({ params }: WordPageP): Promise<Metadata> => {
  const { locale, word } = await headwordOf(params);
  const t = await getTranslations({ locale, namespace: 'word' });
  const headword = await fetchHeadword(word);
  // the API being down must not get thin placeholder pages indexed (issue #399)
  if (headword.kind === 'unavailable') return { title: word, robots: { index: false } };
  if (headword.kind !== 'found') return { title: word };

  const { data, meta } = headword.result;
  canonicalOrRedirect(locale, word, meta.word);
  const definition = leadDefinition(data);
  // the locale's own translations lead the title and the description (issue
  // #480): "bloom — перевод: цветок, цветение"; the English pattern otherwise
  const translations = localeTranslations(data, locale);
  const title = translations.length
    ? t('page_title_translated', {
        word: meta.word,
        translations: translations.slice(0, TITLE_TRANSLATIONS).join(', '),
      })
    : t('page_title', { word: meta.word });
  const description = translations.length
    ? [t('translations_of', { word: meta.word, translations: translations.join(', ') }), definition]
        .filter(Boolean)
        .join(' ')
    : definition || t('page_description', { word: meta.word });

  return pageMeta({
    locale,
    path: wordPath(meta.word),
    title,
    // a snippet's length: search engines cut a description at about 160 characters
    description: trimDescription(description),
    type: 'article',
  });
};

// how many of the locale's translations fit a title
const TITLE_TRANSLATIONS = 4;

// the data writes transcriptions as `/rʌn/` or bare; shown once between slashes
const ipa = (value: string): string => `/${value.replace(/^[/[]|[/\]]$/g, '')}/`;

const WordLink = ({ word }: { word: string }) => <Link href={wordPath(word)}>{word}</Link>;

type TranslateT = Awaited<ReturnType<typeof getTranslations>>;

const humanize = (value: string): string => value.replace(/_/g, ' ');

// the grammar flags of an entry as short localized phrases (issue #399)
const grammarOf = (entry: PublicWordV1T, t: TranslateT): string[] =>
  [
    entry.noun___uncountable && t('uncountable'),
    entry.noun___always_plural && t('always_plural'),
    entry.noun___irregular_plural && t('irregular_plural'),
    entry.noun___is_proper && t('proper_noun'),
    entry.verb___is_irregular && t('irregular_verb'),
    entry.verb___transitivity && t(`transitivity_${entry.verb___transitivity}`),
    entry.verb___phrasal_object_pattern && t(`phrasal_${entry.verb___phrasal_object_pattern}`),
  ].filter((item): item is string => Boolean(item));

// the language of a translation as its flag (issue #520); the code for a screen reader
const LanguageTag = ({ language }: { language: string }) => (
  <span className={styles.flagTag} role="img" aria-label={language} title={language}>
    {flagOf(language)}
  </span>
);

type ShortTranslationT = PublicWordV1T['short_translations'][number];

// The short translations of an entry (issue #520): a line per item, the
// chosen language's shown, the others in the HTML but hidden
const ShortTranslations = ({ items }: { items: ShortTranslationT[] }) => (
  <ul className={styles.short}>
    {items.map((item) => (
      <ForLanguage key={item.id} language={item.language} as="li">
        <LanguageTag language={item.language} />
        <span>{item.description}</span>
      </ForLanguage>
    ))}
  </ul>
);

const Meaning = ({ meaning, t }: { meaning: PublicWordV1MeaningT; t: TranslateT }) => (
  <li>
    {meaning.title && <span className={styles.meaningTitle}>{meaning.title}</span>}
    {meaning.meaning_level && <span className={styles.tag}> {meaning.meaning_level}</span>}
    {meaning.language_register && <span className={styles.tag}> {meaning.language_register}</span>}
    {String(meaning.area_variant) !== 'common' && (
      <span className={styles.tag}> {humanize(String(meaning.area_variant))}</span>
    )}
    {meaning.categories?.map((category) => (
      <span key={category} className={styles.tag}>
        {' '}
        {humanize(category)}
      </span>
    ))}
    {meaning.is_obsolete && <span className={styles.tag}> {t('obsolete')}</span>}
    <p className={styles.definition}>{meaning.definition}</p>
    {meaning.examples.length > 0 && (
      <ul className={styles.examplesList}>
        {meaning.examples.map((example) => (
          <li key={example}>{example}</li>
        ))}
      </ul>
    )}
    {meaning.translations.length > 0 && (
      <p className={styles.translations}>
        {meaning.translations.map((translation) => (
          <ForLanguage key={translation.id} language={translation.language}>
            <LanguageTag language={translation.language} />
            <span title={translation.definition}>{translation.title}</span>
          </ForLanguage>
        ))}
      </p>
    )}
    {meaning.synonyms.length > 0 && (
      <p className={styles.relations}>
        {t('synonyms')}:{' '}
        {meaning.synonyms.map((word) => (
          <WordLink key={word} word={word} />
        ))}
      </p>
    )}
    {meaning.antonyms.length > 0 && (
      <p className={styles.relations}>
        {t('antonyms')}:{' '}
        {meaning.antonyms.map((word) => (
          <WordLink key={word} word={word} />
        ))}
      </p>
    )}
  </li>
);

type EntryP = {
  entry: PublicWordV1T;
  // the spelling the page is about: an entry of another spelling says its own
  headword: string;
  // what was changed in this entry on the instance (issue #531)
  changes: PublicChangeV1T[];
  locale: string;
  t: TranslateT;
};

const Entry = ({ entry, headword, changes, locale, t }: EntryP) => {
  const grammar = grammarOf(entry, t);

  return (
    <section className={styles.entry} data-testid={`entry-${entry.id}`}>
      <div className={styles.entryHead}>
        <h2>{entry.part_of_speech.replace(/_/g, ' ')}</h2>
        {/* "ran" leads to the verb "run", "TEST" to "Test" and "test": the entry names the word it is */}
        {entry.word !== headword && (
          <span className={styles.entrySpelling} data-testid="entry-spelling">
            <WordLink word={entry.word} />
          </span>
        )}
        {entry.word_level && <span className={styles.tag}>{entry.word_level}</span>}
        {entry.language_register && <span className={styles.tag}>{entry.language_register}</span>}
        {entry.area_variant && <span className={styles.tag}>{entry.area_variant}</span>}
        {entry.form_of_word !== 'base_form' && (
          <span className={styles.tag}>{String(entry.form_of_word).replace(/_/g, ' ')}</span>
        )}
        {entry.categories?.map((category) => (
          <span key={category} className={styles.tag}>
            {humanize(category)}
          </span>
        ))}
        {entry.is_abbreviation && <span className={styles.tag}>{t('abbreviation')}</span>}
        {entry.is_obsolete && <span className={styles.tag}>{t('obsolete')}</span>}
        {entry.transcription && <span className={styles.transcription}>{ipa(entry.transcription)}</span>}
      </div>
      {/* the licenses of the datasets ask that a reader is told (issue #531) */}
      {entry.modified && (
        <p className={styles.modified} data-testid="entry-modified">
          {t('modified_note')}
        </p>
      )}
      {grammar.length > 0 && <p className={styles.grammar}>{grammar.join(' · ')}</p>}
      {entry.pattern && entry.pattern.length > 0 && (
        <p className={styles.grammar}>
          {t('patterns')}: <code>{entry.pattern.join(' · ')}</code>
        </p>
      )}
      {entry.description && <p className={styles.description}>{entry.description}</p>}
      {entry.short_translations.length > 0 && <ShortTranslations items={entry.short_translations} />}
      {entry.meanings.length > 0 && (
        <ol className={styles.meanings}>
          {entry.meanings.map((meaning) => (
            <Meaning key={meaning.id} meaning={meaning} t={t} />
          ))}
        </ol>
      )}
      {entry.forms.length > 0 && (
        <ul className={styles.forms}>
          {entry.forms.map((form) => (
            <li key={form.id}>
              {form.word} <Pronounce word={form.word} small />{' '}
              <small>{String(form.form_of_word).replace(/_/g, ' ')}</small>
            </li>
          ))}
        </ul>
      )}
      {entry.base_phrasal && (
        <p className={styles.relations}>
          {t('base_phrasal')}: <WordLink word={entry.base_phrasal} />
        </p>
      )}
      {entry.phrasal_variants && entry.phrasal_variants.length > 0 && (
        <p className={styles.relations}>
          {t('phrasal_variants')}:{' '}
          {entry.phrasal_variants.map((word) => (
            <WordLink key={word} word={word} />
          ))}
        </p>
      )}
      <WordHistory locale={locale} changes={changes} t={t} />
    </section>
  );
};

export default async function WordPage({ params }: WordPageP) {
  const { locale, word } = await headwordOf(params);
  setRequestLocale(locale);
  const t = await getTranslations('word');
  const nav = await getTranslations('nav');
  const [headword, terms] = await Promise.all([fetchHeadword(word), fetchDatasetTerms()]);

  if (headword.kind === 'not_found') notFound();
  // the page is cacheable (next.config.ts); one the API failed to render must not be
  if (headword.kind === 'unavailable') throw new DictionaryUnavailableError();

  const { data, meta } = headword.result;
  canonicalOrRedirect(locale, word, meta.word);
  const transcription = data.find((entry) => entry.transcription)?.transcription;
  // what was changed on the instance (issue #531): asked for only where an entry says it was
  const history = data.some((entry) => entry.modified) ? await fetchHeadwordHistory(meta.word) : [];
  // the other spellings of the headword, but for the ones the page itself shows the entries of
  const shown = new Set(data.map((entry) => entry.word));
  const variants = (meta.variants ?? []).filter((variant) => !shown.has(variant));
  // the locale's translations on the first screen, before the entries
  const translations = localeTranslations(data, locale);
  // the terms of the data the page shows (issue #527)
  const isOwnData = terms.source === OWN_DATASET_SOURCE;
  const license = licenseLabel(terms.license);
  // one translation language at a time (issue #520): the locale's own when the headword has it, else the first
  const languages = translationLanguages(data, locale);
  const ownLanguage = locale === 'en' ? null : locale;
  const defaultLanguage = ownLanguage && languages.includes(ownLanguage) ? ownLanguage : (languages[0] ?? null);

  return (
    <TranslationLanguageProvider available={languages} defaultLanguage={defaultLanguage}>
      <div className={`container ${styles.page}`}>
        {/* structured data for search engines (issues #350, #480): the trail and the term in its dictionary */}
        <JsonLd
          data={[
            breadcrumbJsonLd(locale, [
              { name: t('index_title'), path: '/word' },
              { name: meta.word, path: wordPath(meta.word) },
            ]),
            definedTermJsonLd({ locale, word: meta.word, description: leadDefinition(data), terms }),
          ]}
        />
        <div className={styles.headword}>
          <h1>{meta.word}</h1>
          <Pronounce word={meta.word} />
          {transcription && <span className={styles.transcription}>{ipa(transcription)}</span>}
        </div>
        {translations.length > 0 && (
          <p className={styles.lead}>
            <span className={styles.leadLabel}>{t('translation_label')}:</span>{' '}
            <span lang={locale} dir="auto">
              {translations.join(', ')}
            </span>
          </p>
        )}
        {/* the words the dictionary spells the same but for the case: each is a page of its own */}
        {variants.length > 0 && (
          <p className={styles.variants} data-testid="other-spellings">
            {t('other_spellings')}:{' '}
            {variants.map((variant) => (
              <WordLink key={variant} word={variant} />
            ))}
          </p>
        )}
        <div className={styles.metaRow}>
          <div className={styles.metaLeft}>
            <p className={styles.meta}>{t('entries', { count: meta.count })}</p>
            <TranslationPicker label={nav('language')} />
          </div>
          <ReportMistake
            headword={meta.word}
            license={license}
            entries={data.map((entry) => ({
              id: entry.id,
              part_of_speech: entry.part_of_speech,
              description: entry.description ?? '',
              transcription: entry.transcription ?? '',
              meanings: entry.meanings.map((meaning) => ({
                id: meaning.id,
                title: meaning.title ?? '',
                definition: meaning.definition ?? '',
                translations: meaning.translations.map((translation) => ({
                  id: translation.id,
                  title: translation.title ?? '',
                  definition: translation.definition ?? '',
                })),
              })),
              short_translations: entry.short_translations.map((item) => ({
                id: item.id,
                description: item.description ?? '',
              })),
            }))}
          />
        </div>
        {data.map((entry) => (
          <Entry
            key={entry.id}
            entry={entry}
            headword={meta.word}
            changes={changesOfEntry(history, entry)}
            locale={locale}
            t={t}
          />
        ))}
        <div className={styles.footer}>
          <p>
            {t('from_api')} <code>GET /api/v1/words/{encodeURIComponent(meta.word)}</code> —{' '}
            <Link href={`/playground?endpoint=get-words-word`}>{t('try_in_playground')}</Link>
            {' · '}
            {isOwnData ? (
              <Link href="/docs/data-license">{t('license_note', { license })}</Link>
            ) : (
              // the terms of the source, with its notice in full where it asks for one (issue #531)
              <Link href="/dataset-terms">{t('license_note', { license })}</Link>
            )}
            {isOwnData ? (
              <>
                {' · '}
                <Link href="/docs/data">{t('ai_note')}</Link>
              </>
            ) : (
              // the attribution the source asks for (issue #527), and its notice when it has one
              <>
                {terms.attribution && (
                  <>
                    {' · '}
                    {terms.attribution_url ? (
                      <a href={terms.attribution_url} rel="noreferrer" target="_blank">
                        {terms.attribution}
                      </a>
                    ) : (
                      terms.attribution
                    )}
                  </>
                )}
                {terms.notice && <> · {terms.notice}</>}
              </>
            )}
          </p>
          <WordSearch />
        </div>
      </div>
    </TranslationLanguageProvider>
  );
}
