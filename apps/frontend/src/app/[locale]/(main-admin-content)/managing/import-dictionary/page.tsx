import { getTranslations } from 'next-intl/server';
import { Breadcrumb } from 'antd';
import { Title } from '@/core/ui/Title';
import { Icon } from '@/core/ui/Icon';
import { BreadcrumbSection } from '@/core/ui/Breadcrumb/components/ManagingBreadcrumbSection';
import { CommonPageP } from '@/types/common';
import { ServerSettingsApi } from '@/core/api/SettingsApi/ServerSettingsApi';
import { ServerEnApi } from '@/core/api/EnApi/ServerEnApi';
import { DATASET_VERSION_SETTINGS_FIELD } from 'server/src/modules/EnModule/modules/EnImportDictionary/constants';
import { ImportDictionarySection } from './_components/ImportDictionarySection';
import styles from './styles.module.scss';

type ImportDictionaryPageP = CommonPageP & { searchParams: Promise<{ dataset?: string | string[] }> };

export default async function ImportDictionaryPage({ params, searchParams }: ImportDictionaryPageP) {
  const { locale } = await params;
  const { dataset } = await searchParams;
  const t = await getTranslations('menu');
  const manageT = await getTranslations('managing');
  const [settings, manifestRes, datasetsRes] = await Promise.all([
    ServerSettingsApi.getSettings(),
    ServerEnApi.getDatasetManifest(),
    // the datasets of the instance (issue #527): the import may fill another one than the active
    ServerEnApi.getDatasets(),
  ]);
  const yourVersion = settings[DATASET_VERSION_SETTINGS_FIELD];
  // no manifest published yet (or the dataset host is unreachable) — the
  // section falls back to the version streamed during the import itself
  const latestVersion = 'error' in manifestRes ? undefined : manifestRes.version;
  const breadCrumbs = [
    { href: `/${locale}`, title: <Icon name="home" size="medium" /> },
    { href: `/${locale}/managing`, title: <BreadcrumbSection icon="managing" name={t('managing')} /> },
    { title: manageT('import_dictionary') },
  ];
  return (
    <div className={styles.page}>
      <Title level={2}>{manageT('import_dictionary')}</Title>
      <Breadcrumb items={breadCrumbs} />
      <ImportDictionarySection
        yourVersion={yourVersion}
        latestVersion={latestVersion}
        datasets={'error' in datasetsRes ? undefined : datasetsRes}
        initialTarget={typeof dataset === 'string' ? dataset : undefined}
      />
    </div>
  );
}
