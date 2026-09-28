import React from 'react';
import type { getTranslations } from 'next-intl/server';
import type { PublicChangeV1T } from 'server/types';

import { flagOf } from '@/core/languageFlags';
import { changedFields, isNamedField, recordLanguage, recordName } from '@/core/wordHistory';
import { Link } from '@/i18n/navigation';

import styles from '../../word.module.scss';

type WordHistoryP = {
  locale: string;
  /** The edits of one entry: the headword read in one part of speech */
  changes: PublicChangeV1T[];
  t: Awaited<ReturnType<typeof getTranslations>>;
};

// an exclamation mark in a circle: the block is a notice, not a part of the entry
const NoticeIcon = () => (
  <svg
    className={styles.historyIcon}
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.2v4.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="8" cy="11.4" r="1" fill="currentColor" />
  </svg>
);

/**
 * What the owner of the site changed in an entry (issue #531): the licenses
 * of the datasets ask that a reader is told not only that an entry was
 * changed, but what was. A block of its own under every entry that was
 * changed — a headword is several entries, a noun and a verb, and an edit
 * belongs to one of them. Folded by default: most readers come for the
 * word. Renders nothing for an entry served as its source has it.
 */
export const WordHistory = ({ locale, changes, t }: WordHistoryP) => {
  if (changes.length === 0) return null;
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  return (
    <details className={styles.history} data-testid="word-history">
      <summary>
        <NoticeIcon />
        {t('history_title')}
      </summary>
      <p className={styles.historyIntro}>
        {t('history_intro')} <Link href="/dataset-terms">{t('history_terms')}</Link>
      </p>
      <ol className={styles.historyList}>
        {changes.map((change, index) => {
          const name = recordName(change.record);
          const language = recordLanguage(change.record);
          const fields = changedFields(change);

          return (
            // a history has no ids to go by: they differ between instances
            <li key={`${change.created_at}-${index}`} data-testid="word-history-item">
              <p className={styles.historyHead}>
                <time dateTime={change.created_at}>{dates.format(new Date(change.created_at))}</time>
                <span>
                  {t(`history_entity_${change.entity}`)}: {t(`history_action_${change.action}`)}
                </span>
                {name && (
                  <span className={styles.historyRecord}>
                    {language && (
                      <span role="img" aria-label={language} title={language}>
                        {flagOf(language)}{' '}
                      </span>
                    )}
                    {name}
                  </span>
                )}
              </p>
              {change.origin === 'suggestion' && (
                <p className={styles.historyAuthor} data-testid="word-history-author">
                  {change.author ? t('history_author', { name: change.author }) : t('history_reader')}
                </p>
              )}
              {fields.length > 0 && (
                <dl className={styles.historyFields}>
                  {fields.map(({ field, before, after }) => (
                    <React.Fragment key={field}>
                      <dt>{isNamedField(field) ? t(`history_field_${field}`) : field.replace(/_+/g, ' ')}</dt>
                      <dd>
                        <span className={styles.historyLabel}>{t('history_before')}</span>{' '}
                        <del dir="auto">{before ?? '—'}</del>
                      </dd>
                      <dd>
                        <span className={styles.historyLabel}>{t('history_after')}</span>{' '}
                        <ins dir="auto">{after ?? '—'}</ins>
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
};
