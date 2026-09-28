'use client';

import React from 'react';
import { Alert } from 'antd';
import { useTranslations } from 'next-intl';
import { DatasetT } from 'server/types';
import { OWN_DATASET_SOURCE } from 'server/core/constants/datasets';
import styles from './styles.module.scss';

/**
 * The dataset an edit is made in (issue #531): the active one, given by the
 * page that shows the word. The dialogs of the word card read it from here —
 * they open in a portal, the context reaches them all the same.
 */
export const EditedDatasetContext = React.createContext<DatasetT | undefined>(undefined);

/**
 * Whether the dataset being edited holds what people wrote: a dataset of a
 * public source carries no notice about generated text, so nothing generated
 * by a model is added to it — the forms offer no way to
 */
export const useWrittenByPeopleOnly = (): boolean => {
  const dataset = React.useContext(EditedDatasetContext);
  return !!dataset && dataset.source !== OWN_DATASET_SOURCE;
};

/** The provider a server page wraps its form in */
export const EditedDataset: React.FC<{ dataset: DatasetT | undefined; children: React.ReactNode }> = ({
  dataset,
  children,
}) => <EditedDatasetContext.Provider value={dataset}>{children}</EditedDatasetContext.Provider>;

/**
 * Says under which license an edit is published, before it is made: what is
 * changed in a dataset becomes a part of it, under the license of its
 * source, and readers are told that the entry was changed. Renders nothing
 * where the dataset is not known.
 */
export const EditLicenseNote: React.FC = () => {
  const dataset = React.useContext(EditedDatasetContext);
  const t = useTranslations('en_managing_words');
  if (!dataset) return null;

  return (
    // a wrapper of its own: the margin of a class does not outweigh the styles of the component
    <div className={styles.note}>
      <Alert
        type="info"
        showIcon
        data-testid="edit-license-note"
        title={
          <>
            {t('editing_license', { dataset: dataset.title })}{' '}
            {dataset.license_url ? (
              <a href={dataset.license_url} target="_blank" rel="license noreferrer noopener">
                {dataset.license}
              </a>
            ) : (
              dataset.license
            )}
            . {t('editing_license_effect')}
            {dataset.source !== OWN_DATASET_SOURCE && <> {t('editing_no_generated')}</>}
          </>
        }
      />
    </div>
  );
};
