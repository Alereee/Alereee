'use client';

import React from 'react';
import { Alert, Button, Collapse, Modal, Progress, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { DatasetCatalogEntryT, DatasetCatalogFileT } from 'server/core/constants/dataset_catalog';
import { ErrorCodes } from 'server/core/constants/error_codes';
import { EnDictionaryImportPhasesE } from 'server/src/modules/EnModule/modules/EnImportDictionary/constants';
import { ImportDictionaryChunkT } from 'server/types';
import { EnApi } from '@/core/api/EnApi';
import { formatMegabytes } from '../../utils';
import styles from './styles.module.scss';

const { Paragraph, Text, Title } = Typography;

enum InstallStatusE {
  idle = 'idle',
  uploading = 'uploading',
  converting = 'converting',
  importing = 'importing',
  done = 'done',
  error = 'error',
}

const KNOWN_ERRORS = new Set<string>(Object.values(ErrorCodes));
const HTTP_PAYLOAD_TOO_LARGE = 413;

type InstallDatasetP = {
  /** The dataset of the catalog the instruction is about; null closes the dialog */
  entry: DatasetCatalogEntryT | null;
  /** Installed already when the dialog opens: the file updates it */
  installed: boolean;
  /** false on SQLite: the instruction can be read, nothing can be installed */
  supported: boolean;
  onClose: () => void;
  /** Called when an installation has finished, whatever its outcome */
  onFinished: () => void;
};

/**
 * How to get a dataset of a public source into the instance (issue #527):
 * where to download the file, under which terms the data comes, what to
 * know before serving it — and the upload itself. The texts are the same
 * for every dataset; the links, the names and the numbers are the catalog's.
 */
export const InstallDataset: React.FC<InstallDatasetP> = ({
  entry,
  installed: installedNow,
  supported,
  onClose,
  onFinished,
}) => {
  const locale = useLocale();
  const t = useTranslations('datasets');
  const tImport = useTranslations('import_dictionary');
  const tErr = useTranslations('errors');

  const [files, setFiles] = React.useState<Partial<Record<string, File>>>({});
  const [status, setStatus] = React.useState<InstallStatusE>(InstallStatusE.idle);
  const [percent, setPercent] = React.useState(0);
  const [stage, setStage] = React.useState('');
  const [error, setError] = React.useState('');
  const [summary, setSummary] = React.useState<{ updated: number; added: number; kept: number } | null>(null);

  // what the dialog was opened for stays what it is about: an installation
  // that has finished does not turn its own report into the one of an update
  const [installed, setInstalled] = React.useState(installedNow);

  // another dataset, another dialog: nothing of the previous one is kept
  React.useEffect(() => {
    setInstalled(installedNow);
    setFiles({});
    setStatus(InstallStatusE.idle);
    setPercent(0);
    setStage('');
    setError('');
    setSummary(null);
    // only a change of the dataset re-reads `installedNow`: its state when the dialog opens, not after
  }, [entry?.name]);

  if (!entry || entry.install.kind !== 'convert') return null;
  const sources = entry.install.files;
  const required = sources.filter((file) => file.required);
  const optional = sources.filter((file) => !file.required);

  const busy =
    status === InstallStatusE.uploading ||
    status === InstallStatusE.converting ||
    status === InstallStatusE.importing;
  const canStart = supported && !busy && required.every((file) => !!files[file.field]);

  const fail = (code: string | undefined, statusCode?: number) => {
    setError(
      statusCode === HTTP_PAYLOAD_TOO_LARGE
        ? t('too_large')
        : tErr(code && KNOWN_ERRORS.has(code) ? code : ErrorCodes.unknown_error),
    );
    setStatus(InstallStatusE.error);
  };

  const start = async () => {
    setStatus(InstallStatusE.uploading);
    setPercent(0);
    setStage('');
    setError('');
    setSummary(null);
    let completed = false;
    let failed = false;

    const handleChunk = (chunk: ImportDictionaryChunkT) => {
      const value = Math.min(100, Math.max(0, chunk.percent ?? 0));
      if (chunk.stage === EnDictionaryImportPhasesE.completed) {
        completed = true;
        setPercent(100);
        if (chunk.updated_entries !== undefined) {
          setSummary({
            updated: chunk.updated_entries,
            added: chunk.added_entries ?? 0,
            kept: chunk.kept_user_modified ?? 0,
          });
        }
        return;
      }
      setPercent(Number(value.toFixed(1)));
      if (chunk.stage === EnDictionaryImportPhasesE.converting_source) {
        setStatus(InstallStatusE.converting);
        return;
      }
      setStatus(InstallStatusE.importing);
      if (chunk.stage !== undefined) setStage(tImport(`en_saving_${chunk.stage}`));
    };

    const res = await EnApi.installDataset(entry.name, files, handleChunk, (code) => {
      failed = true;
      fail(code);
    });
    if ('error' in res) {
      fail(res.message, (res as { statusCode?: number }).statusCode);
    } else if (!failed) {
      // a stream that ends without the last chunk is an installation that broke on the server
      if (completed) setStatus(InstallStatusE.done);
      else fail(undefined);
    }
    onFinished();
  };

  const download = (file: DatasetCatalogFileT) => (
    <>
      <Text code>{file.file_name}</Text>{' '}
      <Text type="secondary">({t('about_size', { size: formatMegabytes(file.size_mb, locale) })})</Text>
      <span className={styles.links}>
        <a href={file.url} target="_blank" rel="noreferrer noopener">
          {t('link_direct')}
        </a>
        <a href={file.page_url} target="_blank" rel="noreferrer noopener">
          {t('link_page')}
        </a>
      </span>
    </>
  );

  const picker = (file: DatasetCatalogFileT) => {
    const chosen = files[file.field];
    return (
      <div key={file.field} className={styles.picker} data-testid={`source-${file.field}`}>
        <Text strong>
          {file.title} {!file.required && <Text type="secondary">— {t('optional')}</Text>}
        </Text>
        <Upload
          maxCount={1}
          disabled={!supported || busy}
          fileList={chosen ? [{ uid: file.field, name: chosen.name, status: 'done' }] : []}
          // the file stays with the browser until the installation starts
          beforeUpload={(picked) => {
            setFiles((current) => ({ ...current, [file.field]: picked }));
            return false;
          }}
          onRemove={() => setFiles(({ [file.field]: _removed, ...rest }) => rest)}
        >
          <Button icon={<UploadOutlined />} disabled={!supported || busy}>
            {t('choose_file', { file: file.file_name })}
          </Button>
        </Upload>
      </div>
    );
  };

  return (
    <Modal
      open
      width={760}
      title={t(installed ? 'update_title' : 'install_title', { title: entry.title })}
      onCancel={onClose}
      closable={!busy}
      maskClosable={false}
      keyboard={!busy}
      footer={[
        <Button key="close" onClick={onClose} disabled={busy}>
          {t('close')}
        </Button>,
        <Button key="start" type="primary" onClick={start} disabled={!canStart} loading={busy}>
          {t(status === InstallStatusE.error ? 'retry' : installed ? 'start_update' : 'start')}
        </Button>,
      ]}
    >
      <div className={styles.instruction}>
        {!supported && (
          <Alert type="warning" showIcon title={t('not_supported')} data-testid="install-unsupported" />
        )}

        <section>
          <Title level={5}>{t('steps_title')}</Title>
          <ol className={styles.steps}>
            {required.map((file) => (
              <li key={file.field}>
                {t('step_download')} {download(file)}
              </li>
            ))}
            {optional.map((file) => (
              <li key={file.field}>
                {t(`step_optional_${file.field}`)} {download(file)}
              </li>
            ))}
            <li>
              {t('step_attach')}{' '}
              {/* what the version of the dataset will be, and why the file goes in as it is (issue #530) */}
              <Text type="secondary" data-testid="step-version">
                {t('step_version')}
              </Text>
            </li>
            <li>{t(installed ? 'step_wait_update' : 'step_wait', { minutes: entry.size.minutes })}</li>
            <li>{t('step_activate')}</li>
          </ol>
        </section>

        <section>
          <Title level={5}>{t('terms_title')}</Title>
          <Paragraph>
            {t('terms_license')}{' '}
            <a href={entry.license.url} target="_blank" rel="license noreferrer noopener">
              {entry.license.name} ({entry.license.spdx})
            </a>
            . {t('terms_served')}
          </Paragraph>
          <Paragraph>
            {t('terms_attribution')}
            <Text className={styles.attribution} copyable>
              {entry.attribution}
            </Text>
          </Paragraph>
          {entry.share_alike && (
            <Alert type="warning" showIcon title={t('terms_share_alike')} data-testid="share-alike" />
          )}
          {entry.notices.length > 0 && (
            <Collapse
              size="small"
              items={[
                {
                  key: 'notices',
                  label: t('terms_full_text'),
                  children: entry.notices.map((notice) => (
                    <div key={notice.title} data-testid="license-notice">
                      <Text strong>{notice.title}</Text>
                      <pre className={styles.notice} lang="en" dir="ltr">
                        {notice.text}
                      </pre>
                    </div>
                  )),
                },
              ]}
            />
          )}
          {optional
            .filter((file) => file.license)
            .map((file) => (
              <Paragraph key={file.field} type="secondary">
                {file.title}:{' '}
                <a href={file.license?.url} target="_blank" rel="license noreferrer noopener">
                  {file.license?.name}
                </a>
              </Paragraph>
            ))}
        </section>

        <section>
          <Title level={5}>{t('warnings_title')}</Title>
          <ul className={styles.warnings}>
            <li>{t('warn_not_mixed')}</li>
            <li>{t('warn_edits', { license: entry.license.spdx })}</li>
            <li>{t('warn_content')}</li>
            {installed && <li>{t('warn_update')}</li>}
            <li>{t('warn_disk', { size: formatMegabytes(entry.size.database_mb, locale) })}</li>
            <li>{t('warn_proxy')}</li>
          </ul>
        </section>

        <section className={styles.upload}>
          <Title level={5}>{t('files_title')}</Title>
          {sources.map(picker)}

          {busy && (
            <div className={styles.progress} data-testid="install-progress">
              <Progress percent={percent} status="active" />
              <Text italic>
                {status === InstallStatusE.uploading && t('uploading')}
                {status === InstallStatusE.converting && t('converting')}
                {status === InstallStatusE.importing && stage}
              </Text>
            </div>
          )}
          {status === InstallStatusE.done && (
            <Alert
              type="success"
              showIcon
              title={t(installed ? 'done_update' : 'done')}
              description={summary ? t('done_summary', summary) : undefined}
              data-testid="install-done"
            />
          )}
          {status === InstallStatusE.error && (
            <Alert type="error" showIcon title={error} data-testid="install-error" />
          )}
        </section>
      </div>
    </Modal>
  );
};
