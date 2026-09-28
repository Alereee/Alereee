'use client';

import React from 'react';
import { Alert } from 'antd';
import { useTranslations } from 'next-intl';
import { ImportStatusT, ImportTriggerE } from 'server/types';
import { EnDictionaryImportPhasesE } from 'server/src/modules/EnModule/modules/EnImportDictionary/constants';
import { useImportStatus } from './useImportStatus';

type AutoImportBannerP = {
  /** Injected by the tests; the banner polls the server otherwise */
  status?: ImportStatusT | undefined;
};

// the completed banner, once closed, stays closed across page loads for that
// import; a later import (another finished_at) shows it again
export const DISMISSED_STORAGE_KEY = 'vbh:auto-import-dismissed';

const readDismissed = (): string | null => {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * What the import slot is doing, on every admin page (issue #268): the
 * automatic load of the dictionary on first start with its progress, a
 * failure with the way out, or an import started from another session.
 * Nothing is rendered when the slot is idle after a manual import — the
 * import page shows that itself.
 */
export const AutoImportBanner: React.FC<AutoImportBannerP> = ({ status: injected }) => {
  const polled = useImportStatus();
  const status = injected ?? polled;
  const t = useTranslations('import_dictionary');
  // read after mount: the server render has no localStorage
  const [dismissed, setDismissed] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const dismiss = () => {
    const key = status?.finished_at ?? '';
    setDismissed(key);
    try {
      window.localStorage.setItem(DISMISSED_STORAGE_KEY, key);
    } catch {
      // private mode or storage disabled: the banner simply comes back next time
    }
  };

  if (!status) return null;
  const stageName = (stage: EnDictionaryImportPhasesE | undefined) =>
    stage === undefined ? '' : t(`en_saving_${stage}`);

  if (status.running) {
    const downloading = status.stage === EnDictionaryImportPhasesE.downloading_database;
    const values = { stage: stageName(status.stage), percent: (status.percent ?? 0).toFixed(0) };
    const message =
      status.trigger === ImportTriggerE.auto
        ? downloading
          ? t('auto_import_downloading')
          : t('auto_import_running', values)
        : t('manual_import_running', values);
    return <Alert type="info" showIcon banner title={message} data-testid="import-banner-running" />;
  }

  if (status.trigger !== ImportTriggerE.auto) return null;

  if (status.error) {
    return (
      <Alert
        type="error"
        showIcon
        banner
        title={t('auto_import_failed', { error: status.error })}
        data-testid="import-banner-failed"
      />
    );
  }
  // undefined until the stored value is read, so the banner does not flash before hiding
  if (dismissed === undefined || dismissed === (status.finished_at ?? '')) return null;
  return (
    <Alert
      type="success"
      showIcon
      banner
      closable
      onClose={dismiss}
      title={t('auto_import_completed', { version: status.dataset_version ?? '—' })}
      data-testid="import-banner-completed"
    />
  );
};
