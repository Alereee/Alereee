import { getTranslations } from 'next-intl/server';
import { Breadcrumb } from 'antd';
import { Title } from '@/core/ui/Title';
import { Icon } from '@/core/ui/Icon';
import { BreadcrumbSection } from '@/core/ui/Breadcrumb/components/ManagingBreadcrumbSection';
import { CommonPageP } from '@/types/common';
import { ServerEnApi } from '@/core/api/EnApi/ServerEnApi';
import { ExportDictionarySection } from './_components/ExportDictionarySection';
import styles from './styles.module.scss';

export default async function ImportDictionaryPage({ params }: CommonPageP) {
  const { locale } = await params;
  const t = await getTranslations('menu');
  const manageT = await getTranslations('managing');
  // the export carries the terms of the dataset it is taken from (issue #527)
  const datasetsRes = await ServerEnApi.getDatasets();
  const active = 'error' in datasetsRes ? undefined : datasetsRes.datasets.find((dataset) => dataset.active);
  const breadCrumbs = [
    { href: `/${locale}`, title: <Icon name="home" size="medium" /> },
    { href: `/${locale}/managing`, title: <BreadcrumbSection icon="managing" name={t('managing')} /> },
    { title: manageT('export_dictionary') },
  ];
  return (
    <div className={styles.page}>
      <Title level={2}>{manageT('export_dictionary')}</Title>
      <Breadcrumb items={breadCrumbs} />
      <ExportDictionarySection dataset={active} />
    </div>
  );
}
