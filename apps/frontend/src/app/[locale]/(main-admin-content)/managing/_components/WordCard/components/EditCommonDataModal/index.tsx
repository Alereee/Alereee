'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from 'antd';
import { EnPartOfSpeechE, EnWordT } from 'server/types';
import {
  CommonInfoFields,
  CommonInfoFieldsValueT,
} from '@/app/[locale]/(main-admin-content)/managing/_components/CommonInfoFields';
import { getDefaultValue } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/EditCommonDataModal/utils';
import styles from './styles.module.scss';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

type EditCommonDataModalP = {
  isOpen: boolean;
  onClose: () => void;
  submit: (values: CommonInfoFieldsValueT) => void | Promise<void>;
  data: EnWordT;
  pos: EnPartOfSpeechE;
};

export const EditCommonDataModal: React.FC<EditCommonDataModalP> = ({ isOpen, onClose, submit, data, pos }) => {
  const [d, setD] = useState<CommonInfoFieldsValueT>(getDefaultValue(data));
  const [submitting, setSubmitting] = useState(false);
  const t = useTranslations('en_managing_words');

  const handleOk = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submit(d);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      title={t('edit_common_data')}
      onCancel={onClose}
      confirmLoading={submitting}
      onOk={handleOk}
    >
      <EditLicenseNote />
      <div className={styles.fields}>
        <CommonInfoFields pos={pos} value={d} onChange={setD} />
      </div>
    </Modal>
  );
};
