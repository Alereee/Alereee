import { getTranslations } from 'next-intl/server';
import { Breadcrumb } from 'antd';
import { Title } from '@/core/ui/Title';
import { Icon } from '@/core/ui/Icon';
import { BreadcrumbSection } from '@/core/ui/Breadcrumb/components/ManagingBreadcrumbSection';
import { CommonPageP } from '@/types/common';
import { ServerEnApi } from '@/core/api/EnApi/ServerEnApi';
import { DatasetsSection } from './_components/DatasetsSection';
import styles from './styles.module.scss';

// The datasets of the instance (issue #527): what it holds, which one it
// serves, and — on Postgres — creating, activating and deleting them
export default async function DatasetsPage({ params }: CommonPageP) {
  const { locale } = await params;
  const t = await getTranslations('menu');
  const manageT = await getTranslations('managing');
  const datasetsT = await getTranslations('datasets');
  const list = await ServerEnApi.getDatasets();
  const breadCrumbs = [
    { href: `/${locale}`, title: <Icon name="home" size="medium" /> },
    { href: `/${locale}/managing`, title: <BreadcrumbSection icon="managing" name={t('managing')} /> },
    { title: manageT('datasets') },
  ];

  return (
    <div className={styles.page}>
      <Title level={2}>{manageT('datasets')}</Title>
      <Breadcrumb items={breadCrumbs} />
      <p className={styles.intro}>{datasetsT('intro')}</p>
      {/* an installed dataset is public before it is activated (issue #528) */}
      <p className={styles.intro} data-testid="datasets-public-note">
        {datasetsT('public_note', { method: 'GET /api/v1/words/{word}/datasets' })}
      </p>
      <DatasetsSection initial={'error' in list ? undefined : list} />
    </div>
  );
}
