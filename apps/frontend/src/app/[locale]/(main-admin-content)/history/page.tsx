import { getTranslations } from 'next-intl/server';
import { Title } from '@/core/ui/Title';
import { HistoryTabs } from './_components/HistoryTabs';
import styles from './styles.module.scss';

export default async function HistoryPage() {
  const t = await getTranslations('menu');

  return (
    <div className={styles.mainPage}>
      <Title level={2}>{t('history')}</Title>
      <HistoryTabs />
    </div>
  );
}
