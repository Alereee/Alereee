'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, App, Button, Card, Popconfirm, Tag, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { DATASET_CATALOG, DatasetCatalogEntryT } from 'server/core/constants/dataset_catalog';
import { DatasetT, DatasetUpdateT, DatasetsListT } from 'server/types';
import { EnApi } from '@/core/api/EnApi';
import { InstallDataset } from './components/InstallDataset';
import { formatCount, formatMegabytes } from './utils';
import styles from './styles.module.scss';

const { Paragraph, Text } = Typography;

type DatasetsSectionP = {
  /** The list fetched with the page; absent when the request failed */
  initial?: DatasetsListT | undefined;
};

/**
 * The datasets of the instance (issue #527): every dataset the code can
 * hold, installed or not, with the terms it comes under. The catalog is
 * closed and its terms are stated in the code — nothing here is typed by an
 * admin. A dataset that is not installed offers the instruction: where to
 * download the file of its source, and the upload. On a driver without
 * schemas (SQLite) the cards are shown and nothing can be installed.
 */
export const DatasetsSection: React.FC<DatasetsSectionP> = ({ initial }) => {
  const locale = useLocale();
  const t = useTranslations('datasets');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();

  const [list, setList] = React.useState<DatasetsListT | undefined>(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [instruction, setInstruction] = React.useState<DatasetCatalogEntryT | null>(null);
  // what the sources of the installed datasets have now (issue #530); a
  // notice, so a failure of the request is no error of the page
  const [updates, setUpdates] = React.useState<DatasetUpdateT[]>([]);

  const checkUpdates = React.useCallback(async () => {
    const res = await EnApi.getDatasetUpdates();
    setUpdates('error' in res ? [] : res.datasets);
  }, []);

  const reload = React.useCallback(async () => {
    const res = await EnApi.getDatasets();
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    setList(res);
    // the version that is installed may have changed: the notice is about it
    await checkUpdates();
  }, [message, tErr, checkUpdates]);

  React.useEffect(() => {
    if (initial) void checkUpdates();
    else void reload();
  }, [initial, reload, checkUpdates]);

  const run = async (
    key: string,
    call: () => Promise<{ error?: boolean; message?: string } | object>,
    done: string,
  ) => {
    setBusy(key);
    const res = (await call()) as { error?: boolean; message?: string };
    setBusy(null);
    if (res.error) {
      message.error(tErr(res.message ?? 'unknown_error'));
      return;
    }
    message.success(done);
    await reload();
  };

  const supported = list?.supported ?? false;
  const stateOf = (name: string): DatasetT | undefined =>
    list?.datasets.find((dataset) => dataset.name === name);

  const card = (entry: DatasetCatalogEntryT) => {
    const state = stateOf(entry.name);
    const installed = state?.installed ?? false;
    const active = state?.active ?? false;
    const fromSource = entry.install.kind === 'convert';
    const update = installed ? updates.find((item) => item.name === entry.name) : undefined;

    return (
      <Card
        key={entry.name}
        data-testid={`dataset-${entry.name}`}
        title={
          <span className={styles.heading}>
            <span className={styles.title}>{entry.title}</span>
            <Text type="secondary" code>
              {entry.name}
            </Text>
          </span>
        }
        extra={
          <span className={styles.tags}>
            {active && <Tag color="green">{t('status_active')}</Tag>}
            {installed && !active && <Tag color="blue">{t('status_installed')}</Tag>}
            {!installed && <Tag>{t('status_not_installed')}</Tag>}
          </span>
        }
      >
        <Paragraph>{t(`about_${entry.name}`)}</Paragraph>
        <div className={styles.features}>
          {entry.features.map((feature) => (
            <Tag key={feature}>{t(`feature_${feature}`)}</Tag>
          ))}
        </div>

        <dl className={styles.facts}>
          <dt>{t('label_source')}</dt>
          <dd>
            <a href={entry.homepage} target="_blank" rel="noreferrer noopener">
              {entry.homepage.replace(/^https:\/\//, '')}
            </a>
          </dd>
          <dt>{t('label_license')}</dt>
          <dd>
            <a href={entry.license.url} target="_blank" rel="license noreferrer noopener">
              {entry.license.name} ({entry.license.spdx})
            </a>
            {entry.share_alike && (
              <Tag color="orange" className={styles.shareAlike}>
                {t('share_alike')}
              </Tag>
            )}
          </dd>
          <dt>{t('label_attribution')}</dt>
          <dd>{entry.attribution}</dd>
          {entry.notice && (
            <>
              <dt>{t('label_notice')}</dt>
              <dd>{entry.notice}</dd>
            </>
          )}
          <dt>{t('label_size')}</dt>
          <dd>
            {t('size', {
              entries: formatCount(entry.size.entries, locale),
              senses: formatCount(entry.size.senses, locale),
              size: formatMegabytes(entry.size.database_mb, locale),
            })}
          </dd>
          {installed && (
            <>
              <dt>{t('label_version')}</dt>
              <dd>{state?.version ?? '—'}</dd>
              {update && (
                <>
                  <dt>{t('label_source_version')}</dt>
                  <dd data-testid={`dataset-source-version-${entry.name}`}>
                    {update.latest ?? t('source_unknown')}
                    {update.checked_at && (
                      <Text type="secondary" className={styles.checked}>
                        {t('source_checked', { date: new Date(update.checked_at).toLocaleString(locale) })}
                      </Text>
                    )}
                  </dd>
                </>
              )}
              <dt>{t('label_imported')}</dt>
              <dd>{state?.imported_at ? new Date(state.imported_at).toLocaleString(locale) : t('never')}</dd>
            </>
          )}
        </dl>

        {update?.installed && !update.comparable && (
          <Paragraph type="secondary" data-testid={`dataset-version-unknown-${entry.name}`}>
            {t('version_unknown')}
          </Paragraph>
        )}
        {update?.update_available && (
          <Alert
            type="warning"
            showIcon
            className={styles.update}
            data-testid={`dataset-update-${entry.name}`}
            title={t('update_available', { latest: update.latest ?? '', installed: update.installed ?? '' })}
            description={
              <>
                {t('update_hint')}{' '}
                {update.url && (
                  <a href={update.url} target="_blank" rel="noreferrer noopener">
                    {t('update_open')}
                  </a>
                )}
              </>
            }
          />
        )}

        <div className={styles.actions}>
          {supported && installed && !active && (
            <Popconfirm
              title={t('activate_confirm', { name: entry.title })}
              okText={t('activate')}
              cancelText={t('cancel')}
              onConfirm={() =>
                run(
                  `activate ${entry.name}`,
                  () => EnApi.activateDataset(entry.name),
                  t('activated', { name: entry.title }),
                )
              }
            >
              <Button type="primary" loading={busy === `activate ${entry.name}`}>
                {t('activate')}
              </Button>
            </Popconfirm>
          )}
          {fromSource ? (
            <Button type={installed ? 'default' : 'primary'} onClick={() => setInstruction(entry)}>
              {t(installed ? 'update' : 'how_to_install')}
            </Button>
          ) : (
            <Link href={`/${locale}/managing/import-dictionary`}>
              <Button>{t('open_import')}</Button>
            </Link>
          )}
          {supported && installed && !active && fromSource && (
            <Popconfirm
              title={t('delete_confirm', { name: entry.title })}
              okText={t('delete')}
              okButtonProps={{ danger: true }}
              cancelText={t('cancel')}
              onConfirm={() => run(`delete ${entry.name}`, () => EnApi.deleteDataset(entry.name), t('deleted'))}
            >
              <Button danger loading={busy === `delete ${entry.name}`}>
                {t('delete')}
              </Button>
            </Popconfirm>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className={styles.section}>
      {list && !supported && (
        <Alert type="info" showIcon title={t('not_supported')} data-testid="datasets-unsupported" />
      )}
      {DATASET_CATALOG.map(card)}
      <InstallDataset
        entry={instruction}
        installed={instruction ? (stateOf(instruction.name)?.installed ?? false) : false}
        supported={supported}
        onClose={() => setInstruction(null)}
        onFinished={() => void reload()}
      />
    </div>
  );
};
