'use client';

import React from 'react';
import { Alert } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { projectWebsitePage, UPDATE_NOTICE_DOCS_PATH } from 'server/core/constants/project_links';
import type { UpdateCheckT } from 'server/types/settings/SettingsApiTypes';
import styles from './styles.module.scss';

type UpdateNoticeP = {
  /** The server's answer, fetched by the layout; null when it could not be asked */
  update: UpdateCheckT | null;
};

// closing the notice hides it for that release only: the next one shows it again
export const DISMISSED_UPDATE_STORAGE_KEY = 'vbh:update-notice-dismissed';

const readDismissed = (): string | null => {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * "A newer release exists" on every admin page (issue #477). A notice only: the
 * links lead to the release notes and to the documentation of the upgrade,
 * which stays a manual step of the operator — the app never updates itself.
 */
export const UpdateNotice: React.FC<UpdateNoticeP> = ({ update }) => {
  const t = useTranslations('update_notice');
  const locale = useLocale();
  // read after mount: the server render has no localStorage
  const [dismissed, setDismissed] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  if (!update?.update_available || !update.latest) return null;
  const latest = update.latest;
  // undefined until the stored value is read, so the notice does not flash before hiding
  if (dismissed === undefined || dismissed === latest) return null;

  const dismiss = () => {
    setDismissed(latest);
    try {
      window.localStorage.setItem(DISMISSED_UPDATE_STORAGE_KEY, latest);
    } catch {
      // private mode or storage disabled: the notice simply comes back next time
    }
  };

  return (
    <Alert
      type="info"
      showIcon
      banner
      closable={{ 'aria-label': t('dismiss') }}
      onClose={dismiss}
      data-testid="update-notice"
      title={
        <span className={styles.message}>
          <span dir="auto">{t('available', { latest, current: update.current })}</span>
          {update.release_url && (
            <a href={update.release_url} target="_blank" rel="noopener noreferrer">
              {t('release_notes')}
            </a>
          )}
          <a
            href={projectWebsitePage(locale, UPDATE_NOTICE_DOCS_PATH)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('how_to_update')}
          </a>
        </span>
      }
    />
  );
};
