import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Breadcrumb, Button, Result } from 'antd';
import { ErrorCodes } from 'server/core/constants/error_codes';
import { Title } from '@/core/ui/Title';
import { Icon } from '@/core/ui/Icon';
import { BreadcrumbSection } from '@/core/ui/Breadcrumb/components/ManagingBreadcrumbSection';
import { CommonPageP } from '@/types/common';
import { ServerEnApi } from '@/core/api/EnApi/ServerEnApi';
import { WordCard } from '../../_components/WordCard';
import { WordCardModeE } from '../../_components/WordCard/constants';
import styles from './styles.module.scss';

type EditPageP = {
  wordId: string;
};

export default async function EditWordPage({ params }: CommonPageP<EditPageP>) {
  const { locale, wordId } = await params;
  const [wordData, datasets] = await Promise.all([
    ServerEnApi.getWordById(+wordId),
    // the dataset the word is edited in, for the license of the edit (issue #531)
    ServerEnApi.getDatasets(),
  ]);
  const dataset = 'error' in datasets ? undefined : datasets.datasets.find((item) => item.active);
  const t = await getTranslations('menu');
  const manageT = await getTranslations('managing');
  if ('error' in wordData) {
    const tError = await getTranslations('errors');
    const isKnownCode = (Object.values(ErrorCodes) as string[]).includes(wordData.message);
    return (
      <div className={styles.page}>
        <Result
          status={wordData.message === ErrorCodes.word_doesnt_found ? '404' : 'error'}
          title={tError(isKnownCode ? wordData.message : ErrorCodes.unknown_error)}
          extra={
            <Link href={`/${locale}/managing`}>
              <Button type="primary">{manageT('back_to_managing')}</Button>
            </Link>
          }
        />
      </div>
    );
  }
  const breadCrumbs = [
    { href: `/${locale}`, title: <Icon name="home" size="medium" /> },
    { href: `/${locale}/managing`, title: <BreadcrumbSection icon="managing" name={t('managing')} /> },
    { title: manageT('edit_word') },
  ];
  return (
    <div className={styles.page}>
      <Title level={2}>{manageT('edit_word')}</Title>
      <Breadcrumb items={breadCrumbs} />
      <WordCard word={wordData} mode={WordCardModeE.edit} dataset={dataset} />
    </div>
  );
}
