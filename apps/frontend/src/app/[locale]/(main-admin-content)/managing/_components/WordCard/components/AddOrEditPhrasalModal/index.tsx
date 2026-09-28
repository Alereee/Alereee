'use client';
import React from 'react';
import { Modal } from 'antd';
import { useTranslations } from 'next-intl';
import { PhrasalModalMoteE } from './constants';
import { CheckingBasePhrasalVerb } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/CheckingBasePhrasalVerb';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

type AddOrEditPhrasalModalP = {
  isOpen: boolean;
  submit: (id: number, w: string) => void;
  onClose: () => void;
  mode: PhrasalModalMoteE;
};

export const AddOrEditPhrasalModal: React.FC<AddOrEditPhrasalModalP> = ({ isOpen, onClose, mode, submit }) => {
  const t = useTranslations('en_managing_words');
  const [w, setW] = React.useState<string>('');
  const [foundId, setFoundId] = React.useState<number | null>(null);

  return (
    <Modal
      onOk={() => foundId && submit(foundId, w)}
      title={t(mode === PhrasalModalMoteE.add ? 'add_phrasal_base_title' : 'edit_phrasal_base_title')}
      open={isOpen}
      onCancel={onClose}
    >
      <EditLicenseNote />
      <CheckingBasePhrasalVerb value={w} onChange={setW} setCheckedId={setFoundId} />
    </Modal>
  );
};
