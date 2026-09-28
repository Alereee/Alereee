'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { App, Button, Input as AntdInput, Modal, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { EnShortTranslationT } from 'server/types';
import { TranslationLanguageSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/TranslationLanguageSelect';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { Input } from '@/core/ui/Input';
import { DefaultState } from './constants';
import { AddOrEditStateT } from './types';
import { EnApi } from '@/core/api/EnApi';
import styles from './styles.module.scss';
import { UpdateTypeE } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/constants';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

const { TextArea } = AntdInput;
const { Text } = Typography;

type AddOrEditShortTranslationModalP = {
  isOpen: boolean;
  onClose: () => void;
  data: EnShortTranslationT | null;
  updateShortTranslation: (v: EnShortTranslationT, type: UpdateTypeE) => void;
};

export const AddOrEditShortTranslationModal: React.FC<AddOrEditShortTranslationModalP> = ({
  isOpen,
  onClose,
  data,
  updateShortTranslation,
}) => {
  const [values, setValues] = useState<AddOrEditStateT>(DefaultState);
  const [submitting, setSubmitting] = useState(false);
  const t = useTranslations('en_managing_words');
  const tError = useTranslations('errors');
  const { message } = App.useApp();

  const { wordId } = useParams();

  const submitAdd = async () => {
    if (wordId) {
      const res = await EnApi.addShortTranslation({
        word_id: +wordId,
        variant_of_words: values.variants_of_words,
        description: values.description,
        language: values.language,
      });

      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        message.success(t(data?.id === 0 ? 'add_short_translation_success' : 'edit_short_translation_success'));
        updateShortTranslation({ ...values, id: res.id }, UpdateTypeE.add);
        onClose();
      }
    }
  };

  const submitEdit = async () => {
    if (data) {
      const res = await EnApi.editShortTranslation({
        id: data.id,
        variant_of_words: values.variants_of_words,
        description: values.description,
        language: values.language,
      });

      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        message.success(
          t(data?.id === 0 ? 'edit_short_translation_success' : 'edit_short_translation_success'),
        );
        updateShortTranslation({ ...data, ...values }, UpdateTypeE.edit);
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
        description: data.description,
        language: data.language,
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
      title={data?.id === 0 ? t('add_short_translation') : t('edit_short_translation')}
    >
      <EditLicenseNote />
      {data && (
        <div className={styles.shortTranslation}>
          <TranslationLanguageSelect
            value={data.language}
            onChange={(v) => setValues({ ...values, language: v })}
          />
          <div>
            <Text strong>{t('translation_desc')}</Text>
            <TextArea
              rows={14}
              value={values.description}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
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
