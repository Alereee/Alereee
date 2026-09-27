import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Breadcrumb, Button } from 'antd';
import { Title } from '@/core/ui/Title';
import { CommonPageP } from '@/types/common';
import { Icon } from '@/core/ui/Icon';
import styles from './styles.module.scss';
import { BreadcrumbSection } from '@/core/ui/Breadcrumb/components/ManagingBreadcrumbSection';
import { SearchModule } from '@/app/[locale]/(main-admin-content)/managing/_components/SearchModule';

export default async function ManagingPage({ params }: CommonPageP) {
  const { locale } = await params;
  const t = await getTranslations('menu');
  const manageT = await getTranslations('managing');
  const breadCrumbs = [
    { href: `/${locale}`, title: <Icon name="home" size="medium" /> },
    { title: <BreadcrumbSection icon="managing" name={t('managing')} /> },
  ];

  return (
    <div className={styles.mainPage}>
      <Title level={2}>{t('managing')}</Title>
      <Breadcrumb items={breadCrumbs} />
      {/* client-side navigation (issues #348, #405): an antd href button reloads the document */}
      <div className={styles.headerBtns}>
        <Link href={`/${locale}/managing/import-dictionary`}>
          <Button type="primary">{manageT('import_dictionary')}</Button>
        </Link>
        <Link href={`/${locale}/managing/export-dictionary`}>
          <Button type="primary">{manageT('export_dictionary')}</Button>
        </Link>
        <Link href={`/${locale}/managing/add-word`}>
          <Button type="primary">{manageT('add_word')}</Button>
        </Link>
        <Link href={`/${locale}/managing/bulk-request`}>
          <Button type="primary">{manageT('bulk_request')}</Button>
        </Link>
        <Link href={`/${locale}/managing/datasets`}>
          <Button type="primary">{manageT('datasets')}</Button>
        </Link>
      </div>
      {/* SearchModule reads the query string, which needs a Suspense boundary */}
      <Suspense fallback={null}>
        <SearchModule />
      </Suspense>
    </div>
  );
}
