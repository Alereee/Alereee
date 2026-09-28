import { getTranslations } from 'next-intl/server';
import { Alert, Breadcrumb } from 'antd';
import { OWN_DATASET_SOURCE } from 'server/core/constants/datasets';
import { ServerEnApi } from '@/core/api/EnApi/ServerEnApi';
import { Title } from '@/core/ui/Title';
import { Icon } from '@/core/ui/Icon';
import { BreadcrumbSection } from '@/core/ui/Breadcrumb/components/ManagingBreadcrumbSection';
import { CommonPageP } from '@/types/common';
import { BulkRequestSection } from './_components/BulkRequestSection';
import styles from './styles.module.scss';

export default async function BulkRequestPage({ params }: CommonPageP) {
  const { locale } = await params;
  const t = await getTranslations('menu');
  const manageT = await getTranslations('managing');
  const bulkT = await getTranslations('bulk_request');
  // the rows that are sent out belong to the active dataset, under its license (issue #531)
  const datasets = await ServerEnApi.getDatasets();
  const dataset = 'error' in datasets ? undefined : datasets.datasets.find((item) => item.active);
  const ofPublicSource = dataset && dataset.source !== OWN_DATASET_SOURCE;
  const breadCrumbs = [
    { href: `/${locale}`, title: <Icon name="home" size="medium" /> },
    { href: `/${locale}/managing`, title: <BreadcrumbSection icon="managing" name={t('managing')} /> },
    { title: manageT('bulk_request') },
  ];
  return (
    <div className={styles.page}>
      <Title level={2}>{manageT('bulk_request')}</Title>
      <Breadcrumb items={breadCrumbs} />
      {ofPublicSource && (
        <Alert
          type="warning"
          showIcon
          data-testid="bulk-license-note"
          title={bulkT('license_note', { dataset: dataset.title, license: dataset.license })}
        />
      )}
      <BulkRequestSection />
    </div>
  );
}
