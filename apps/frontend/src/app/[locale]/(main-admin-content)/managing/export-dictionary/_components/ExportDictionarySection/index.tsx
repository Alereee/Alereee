'use client';

import React from 'react';
import { App, Button, Progress, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { DatasetT, ImportDictionaryChunkT } from 'server/types';
import { EnApi } from '@/core/api/EnApi';
import { EnDictionaryImportPhasesE } from 'server/src/modules/EnModule/modules/EnImportDictionary/constants';
import { AbstractBaseApi } from '@/core/api/AbstractBaseApi';
import { ErrorCodes } from 'server/core/constants/error_codes';
import { DATA_LICENSE } from 'server/core/constants/data_license';
import { ExportStatusE } from './constants';
import styles from './styles.module.scss';

const { Text } = Typography;

type ExportDictionarySectionP = {
  // the active dataset (issue #527): the export is taken from it and carries
  // its terms; without it the terms of the project's own dataset are shown
  dataset?: DatasetT | undefined;
};

export const ExportDictionarySection: React.FC<ExportDictionarySectionP> = ({ dataset }) => {
  const terms = dataset
    ? { label: dataset.license, url: dataset.license_url, attribution: dataset.attribution }
    : {
        label: `${DATA_LICENSE.name} (${DATA_LICENSE.spdx})`,
        url: DATA_LICENSE.url,
        attribution: DATA_LICENSE.attribution,
      };
  const [percents, setPercents] = React.useState<number>(0);
  const [status, setStatus] = React.useState<ExportStatusE>(ExportStatusE.idle);
  const [statusMessage, setStatusMessage] = React.useState<string>('');
  const t = useTranslations('import_dictionary');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();

  const onError = React.useCallback(
    (err: string) => {
      message.error(tErr(err || ErrorCodes.unknown_error));
      setStatus(ExportStatusE.error);
    },
    [message, tErr],
  );

  // Подготовка данных на сервере занимает первые 90% полосы,
  // последние 10% — скачивание готового архива.
  const SERVER_PROGRESS_MAX = 90;

  const downloadAndSaveFile = async (exportId: string) => {
    setStatusMessage(t('en_downloading_file'));

    const result = await EnApi.downloadExportedFile(exportId, (loaded, total) => {
      if (total <= 0) return;
      const downloadPart = Math.min(1, loaded / total) * (100 - SERVER_PROGRESS_MAX);
      setPercents(Number((SERVER_PROGRESS_MAX + downloadPart).toFixed(2)));
    });

    if ('error' in result) {
      onError(result.message);
      return;
    }

    AbstractBaseApi.saveBlobAsFile(result.blob, result.filename ?? 'vocab-bloom-hub-en-export.zip');
    setPercents(100);
    setStatus(ExportStatusE.success);
  };

  const exportDictionary = async () => {
    setStatus(ExportStatusE.in_progress);
    setPercents(0);
    setStatusMessage('');

    let completedSeen = false;

    const handleChunk = (c: ImportDictionaryChunkT) => {
      if (c.stage === EnDictionaryImportPhasesE.completed) {
        completedSeen = true;
        if (!c.exportId) {
          onError(ErrorCodes.unknown_error);
          return;
        }
        setPercents(SERVER_PROGRESS_MAX);
        void downloadAndSaveFile(c.exportId);
      } else {
        const percent = Math.min(100, Math.max(0, c.percent ?? 0));
        setPercents(Number(((percent * SERVER_PROGRESS_MAX) / 100).toFixed(2)));
        setStatusMessage(t(`en_saving_${c.stage}`));
      }
    };

    const res = await EnApi.exportDictionary(handleChunk, onError);
    if ('error' in res) {
      onError(res.message);
      return;
    }

    // Стрим закончился без чанка completed — сервер оборвал экспорт.
    if (!completedSeen) {
      onError(ErrorCodes.unknown_error);
    }
  };

  const resetAndRetry = () => {
    setStatus(ExportStatusE.idle);
    setPercents(0);
    setStatusMessage('');
  };

  const progressStatus =
    status === ExportStatusE.in_progress
      ? 'active'
      : status === 'success'
        ? 'success'
        : status === 'error'
          ? 'exception'
          : 'normal';

  return (
    <div className={styles.importDictionarySection}>
      <Progress
        className={styles.progress}
        percent={percents}
        status={progressStatus}
        format={(p = 0) => `${p.toFixed(2)}%`}
      />

      {(status === 'idle' || status === 'error') && (
        <Button type="primary" onClick={exportDictionary} className={styles.startBtn}>
          {status === 'error' ? t('retry_exporting') : t('start_exporting')}
        </Button>
      )}

      {status === 'success' && (
        <Button onClick={resetAndRetry} className={styles.startBtn}>
          {t('export_again')}
        </Button>
      )}

      {status === 'in_progress' && statusMessage && <Text italic>{statusMessage}</Text>}

      <div className={styles.license}>
        <Text type="secondary">
          {t('data_license')}{' '}
          {terms.url ? (
            <a href={terms.url} target="_blank" rel="noreferrer noopener">
              {terms.label}
            </a>
          ) : (
            terms.label
          )}
        </Text>
        {terms.attribution && (
          <Text type="secondary">
            {t('data_attribution')} {terms.attribution}
          </Text>
        )}
      </div>
    </div>
  );
};
