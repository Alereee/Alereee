import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, Typography } from 'antd';
import { EnWordFormT } from 'server/types';
import styles from './styles.module.scss';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

const { Text } = Typography;
type AddOrEditWordFormModalP = {
  onClose: () => void;
  onOk: (f: EnWordFormT) => void | Promise<void>;
  isOpen: boolean;
  form: EnWordFormT;
};

export const DeleteWordFormModal: React.FC<AddOrEditWordFormModalP> = ({ isOpen, onClose, onOk, form }) => {
  const t = useTranslations('en_managing_words');
  const [submitting, setSubmitting] = useState(false);

  const handleOk = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onOk(form);
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
      <Text strong>
        {form?.form_of_word} - {form?.word}
      </Text>
      <Text>{t('delete_word_form_desc')}</Text>
    </Modal>
  );
};
