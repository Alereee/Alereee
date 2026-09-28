import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { App, Modal } from 'antd';
import { EnAreaVariantsE, EnWordFormT } from 'server/types';
import { RegionalLabelSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/RegionalLabelSelect';
import { Input } from '@/core/ui/Input';
import { DefaultValues } from './constants';
import { ValuesStateT } from './types';
import { getTitle } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/FormsOfWordLine/utils';
import { EnApi } from '@/core/api/EnApi';
import { UpdateTypeE } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/constants';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

type AddOrEditWordFormModalP = {
  data: EnWordFormT | null;
  updateFormOfWord: (f: EnWordFormT, type: UpdateTypeE) => void;
  onClose: () => void;
};

export const AddOrEditWordFormModal: React.FC<AddOrEditWordFormModalP> = ({
  data,
  onClose,
  updateFormOfWord,
}) => {
  const [values, setValues] = useState<ValuesStateT>(DefaultValues);
  const [submitting, setSubmitting] = useState(false);
  const { wordId } = useParams();
  const { message } = App.useApp();
  const tError = useTranslations('errors');
  const t = useTranslations('en_managing_words');

  const submitData = useCallback(async () => {
    if (wordId && data) {
      const res = await EnApi.addWordForm({
        ...values,
        base_word_id: +wordId,
        form_of_word: data.form_of_word,
      });
      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        onClose();
        updateFormOfWord({ ...data, ...values, id: res.id }, UpdateTypeE.add);
      }
    }
  }, [wordId, values, data]);

  const editData = useCallback(async () => {
    if (wordId && data) {
      const res = await EnApi.editWordForm({ ...values, id: data.id });
      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        updateFormOfWord({ ...data, ...values }, UpdateTypeE.edit);
        onClose();
      }
    }
  }, [wordId, values, data]);

  useEffect(() => {
    if (data) {
      setValues({ word: data.word, transcription: data.transcription || '', area_variant: data.area_variant });
    }
  }, [data]);

  const handleOk = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await (data?.id === 0 ? submitData() : editData());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={data?.id === 0 ? t('add_word_form') : t('edit_word_form')}
      open={!!data}
      onOk={handleOk}
      confirmLoading={submitting}
      onCancel={onClose}
    >
      <EditLicenseNote />
      {data && <Input value={getTitle(data?.form_of_word as string)} disabled />}
      <RegionalLabelSelect
        width={188}
        value={values.area_variant}
        onChange={(v) => setValues({ ...values, area_variant: v as EnAreaVariantsE })}
      />
      <Input
        label={t('word')}
        placeholder={t('word')}
        onChange={(e) => setValues({ ...values, word: e.target.value })}
        value={values.word}
      />
      <Input
        onChange={(e) => setValues({ ...values, transcription: e.target.value })}
        value={values.transcription || ''}
        label={t('pronunciation')}
        placeholder={t('pronunciation')}
      />
    </Modal>
  );
};
