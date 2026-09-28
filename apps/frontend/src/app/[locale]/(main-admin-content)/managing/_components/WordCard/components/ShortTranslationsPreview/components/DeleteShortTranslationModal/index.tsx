import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, Typography } from 'antd';
import { AvailableTranslationLanguagesE, EnShortTranslationT } from 'server/types';
import styles from './styles.module.scss';
import { TranslationLanguageSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/TranslationLanguageSelect';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

const { Text } = Typography;
type DeleteShortTranslationModalP = {
  onClose: () => void;
  onOk: (t: EnShortTranslationT) => void | Promise<void>;
  isOpen: boolean;
  translation: EnShortTranslationT | null;
};

export const DeleteShortTranslationModal: React.FC<DeleteShortTranslationModalP> = ({
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
      await onOk(translation as EnShortTranslationT);
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
      <TranslationLanguageSelect
        value={translation?.language as AvailableTranslationLanguagesE}
        onChange={() => {}}
        disabled
      />
      <Text>{t('delete_short_translation_desc')}</Text>
    </Modal>
  );
};
