import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, Typography } from 'antd';
import { EnMeaningTranslationT } from 'server/types';
import { DirectTranslations } from '../DirectTranslations';
import styles from './styles.module.scss';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

const { Text } = Typography;
type DeleteMeaningTranslationModalP = {
  onClose: () => void;
  onOk: (tr: EnMeaningTranslationT) => void | Promise<void>;
  isOpen: boolean;
  translation: EnMeaningTranslationT | null;
};

export const DeleteMeaningTranslationModal: React.FC<DeleteMeaningTranslationModalP> = ({
  isOpen,
  onClose,
  onOk,
  translation,
}) => {
  const t = useTranslations('en_managing_words');
  const [submitting, setSubmitting] = useState(false);

  const handleOk = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onOk(translation as EnMeaningTranslationT);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      okButtonProps={{ danger: true }}
      title={t('delete_word_form')}
      open={isOpen}
      onOk={handleOk}
      confirmLoading={submitting}
      onCancel={onClose}
      className={styles.deleteModal}
    >
      <EditLicenseNote />
      <DirectTranslations translation={translation as EnMeaningTranslationT} />
      <Text strong>{translation?.title}</Text>
      <Text strong>{translation?.definition}</Text>
      <Text>{t('delete_meaning_tr_desc')}</Text>
    </Modal>
  );
};
