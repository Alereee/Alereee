'use client';

import React from 'react';
import { Tabs } from 'antd';
import { useTranslations } from 'next-intl';
import { ChangesHistory, ForgetAuthor } from '@/components/ChangesHistory';
import { HistorySection } from '../HistorySection';
import styles from './styles.module.scss';

/**
 * One journal for one thing (issue #531): what was changed in the
 * dictionary is the history of the dataset — a part of the data, kept for
 * good; what was done on the instance is the audit journal, kept for a
 * while. The page shows both, each under its own tab.
 */
export const HistoryTabs: React.FC = () => {
  const t = useTranslations('history');
  // bumped when a name was taken out: the list of edits is read again
  const [forgotten, setForgotten] = React.useState(0);

  return (
    <Tabs
      defaultActiveKey="edits"
      destroyOnHidden
      items={[
        {
          key: 'edits',
          label: t('tab_edits'),
          children: (
            <div className={styles.tab}>
              <p className={styles.intro}>{t('intro_edits')}</p>
              <ChangesHistory refreshKey={forgotten} />
              <ForgetAuthor onForgotten={() => setForgotten((current) => current + 1)} />
            </div>
          ),
        },
        {
          key: 'events',
          label: t('tab_events'),
          children: (
            <div className={styles.tab}>
              <p className={styles.intro}>{t('intro')}</p>
              <HistorySection />
            </div>
          ),
        },
      ]}
    />
  );
};
