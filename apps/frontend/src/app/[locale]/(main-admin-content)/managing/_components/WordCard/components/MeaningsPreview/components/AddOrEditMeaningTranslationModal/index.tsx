'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Input as AntdInput, Modal, Typography } from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { EnMeaningTranslationT } from 'server/types';
import { TranslationLanguageSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/TranslationLanguageSelect';
import { Input } from '@/core/ui/Input';
import { DefaultState } from './constants';
import { AddOrEditStateT } from './types';
import { EnApi } from '@/core/api/EnApi';
import styles from './styles.module.scss';
import { UpdateTypeE } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/constants';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

const { TextArea } = AntdInput;
const { Text } = Typography;

type AddOrEditMeaningTranslationModalP = {
  isOpen: boolean;
  onClose: () => void;
  data: EnMeaningTranslationT | null;
  meaningId: number;
  updateMeaningTranslation: (tr: EnMeaningTranslationT, type: UpdateTypeE) => void;
};

export const AddOrEditMeaningTranslationModal: React.FC<AddOrEditMeaningTranslationModalP> = ({
  isOpen,
  onClose,
  data,
  meaningId,
  updateMeaningTranslation,
}) => {
  const [values, setValues] = useState<AddOrEditStateT>(DefaultState);
  const [submitting, setSubmitting] = useState(false);
  const t = useTranslations('en_managing_words');
  const tError = useTranslations('errors');
  const { message } = App.useApp();

  const submitAdd = async () => {
    if (meaningId) {
      const res = await EnApi.addMeaningTranslation({
        meaning_id: meaningId,
        variants_of_words: values.variants_of_words,
        definition: values.definition,
        language: values.language,
        title: values.title,
      });

      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        message.success(t('add_meaning_tr_success'));
        updateMeaningTranslation({ ...data, ...values, id: res.id }, UpdateTypeE.add);
        onClose();
      }
    }
  };

  const submitEdit = async () => {
    if (data) {
      const res = await EnApi.editMeaningTranslation({
        id: data.id,
        variant_of_words: values.variants_of_words,
        definition: values.definition,
        language: values.language,
        title: values.title,
      });

      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        message.success(t('edit_meaning_tr_success'));
        updateMeaningTranslation({ ...data, ...values }, UpdateTypeE.edit);
        onClose();
      }
    }
  };

  const addVariant = () => {
    setValues({ ...values, variants_of_words: [...values.variants_of_words, ''] });
  };

  const changeVariant = (v: string, i: number) => {
    setValues({ ...values, variants_of_words: values.variants_of_words.map((w, ind) => (i === ind ? v : w)) });
  };

  const removeVariant = (i: number) => {
    setValues({ ...values, variants_of_words: values.variants_of_words.filter((_, ind) => i !== ind) });
  };

  useEffect(() => {
    if (data) {
      setValues({
        variants_of_words: data.variants_of_words,
        definition: data.definition,
        language: data.language,
        title: data.title,
      });
    }
  }, [data]);

  const handleOk = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await (data?.id === 0 ? submitAdd() : submitEdit());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onOk={handleOk}
      confirmLoading={submitting}
      onCancel={onClose}
      title={data?.id === 0 ? t('add_meaning_tr') : t('edit_meaning_tr')}
    >
      <EditLicenseNote />
      {data && (
        <div className={styles.shortTranslation}>
          <TranslationLanguageSelect
            value={data.language}
            onChange={(v) => setValues({ ...values, language: v })}
          />
          <Input
            label={t('translation_short_meaning')}
            value={values.title}
            onChange={(e) => setValues({ ...values, title: e.target.value })}
          />
          <div>
            <Text strong>{t('translation_full_meaning')}</Text>
            <TextArea
              value={values.definition}
              onChange={(e) => setValues({ ...values, definition: e.target.value })}
            />
          </div>
          <div className={styles.variants_of_words}>
            <div className={styles.subtitle}>
              <Text strong>{t('translation_variants')}</Text>
              <Button size="small" type="primary" onClick={addVariant}>
                <PlusOutlined />
              </Button>
            </div>
            {values.variants_of_words.map((v, i) => (
              <div key={i} className={styles.variantWordLine}>
                <Input size="small" value={v} onChange={(e) => changeVariant(e.target.value, i)} />
                <Button onClick={() => removeVariant(i)} type="primary" danger size="small">
                  <CloseOutlined />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
};
