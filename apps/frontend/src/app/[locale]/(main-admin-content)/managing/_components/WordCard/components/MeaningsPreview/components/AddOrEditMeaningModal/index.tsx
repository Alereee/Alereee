'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { App, Button, Input as AntdInput, Modal, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { CategoryE, EnAreaVariantsE, EnMeaningT, LanguageRegisterE, WordLevelE } from 'server/types';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { Input } from '@/core/ui/Input';
import { DefaultState } from './constants';
import { AddOrEditStateT } from './types';
import { EnApi } from '@/core/api/EnApi';
import { RegionalLabelSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/RegionalLabelSelect';
import { WordLevelSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/WordLevelSelect';
import { LanguageRegisterSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/LanguageRegisterSelect';
import { CategorySelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/CategoriesSelect';
import { WordLinksSelect } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/components/WordLinksSelect';
import styles from './styles.module.scss';
import { UpdateTypeE } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/constants';
import { EditLicenseNote } from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';

const { TextArea } = AntdInput;
const { Text } = Typography;

type AddOrEditMeaningModalP = {
  isOpen: boolean;
  onClose: () => void;
  data: EnMeaningT | null;
  updateMeaning: (v: EnMeaningT, type: UpdateTypeE) => void;
  // the word the meanings belong to; never offered as its own synonym or antonym
  headword?: string | undefined;
};

export const AddOrEditMeaningModal: React.FC<AddOrEditMeaningModalP> = ({
  isOpen,
  onClose,
  data,
  updateMeaning,
  headword,
}) => {
  const [values, setValues] = useState<AddOrEditStateT>(DefaultState);
  const [submitting, setSubmitting] = useState(false);
  const t = useTranslations('en_managing_words');
  const tError = useTranslations('errors');
  const { message } = App.useApp();

  const { wordId } = useParams();

  const submitAdd = async () => {
    if (wordId) {
      const res = await EnApi.addMeaning({ word_id: +wordId, ...values, translations: [] });

      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        message.success(t('add_meaning_success'));
        updateMeaning({ translations: [], ...data, ...values, id: res.id }, UpdateTypeE.add);
        onClose();
      }
    }
  };

  const submitEdit = async () => {
    if (data) {
      const res = await EnApi.editMeaning({ id: data.id, ...values });

      if ('error' in res) {
        message.error(tError(res.message));
      } else {
        message.success(t('edit_meaning_success'));
        updateMeaning({ ...data, ...values }, UpdateTypeE.edit);
        onClose();
      }
    }
  };

  const addExample = () => {
    setValues({ ...values, examples: [...values.examples, ''] });
  };

  const changeExample = (v: string, i: number) => {
    setValues({ ...values, examples: values.examples.map((w, ind) => (i === ind ? v : w)) });
  };

  const removeExample = (i: number) => {
    setValues({ ...values, examples: values.examples.filter((_, ind) => i !== ind) });
  };

  useEffect(() => {
    if (data) {
      setValues({
        examples: data.examples,
        synonyms: data.synonyms ?? [],
        antonyms: data.antonyms ?? [],
        definition: data.definition,
        title: data.title,
        is_obsolete: data.is_obsolete,
        area_variant: data.area_variant,
        meaning_level: data.meaning_level,
        categories: data.categories,
        language_register: data.language_register,
        sort_order: data.sort_order,
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
      title={data?.id === 0 ? t('add_meaning') : t('edit_meaning')}
    >
      <EditLicenseNote />
      {data && (
        <div className={styles.meaning}>
          <Input
            label={t('short_meaning')}
            value={values.title}
            onChange={(e) => setValues({ ...values, title: e.target.value })}
          />
          <div className={styles.line}>
            <RegionalLabelSelect
              value={values.area_variant as EnAreaVariantsE}
              onChange={(v) => setValues({ ...values, area_variant: v as EnAreaVariantsE })}
            />
            <WordLevelSelect
              value={values.meaning_level as WordLevelE}
              onChange={(v) => setValues({ ...values, meaning_level: v as WordLevelE })}
            />
            <LanguageRegisterSelect
              onChange={(v) => setValues({ ...values, language_register: v })}
              value={values.language_register as LanguageRegisterE}
            />
          </div>
          <div className={styles.line}>
            <Input
              className={styles.sortOrder}
              size="medium"
              type="number"
              value={values.sort_order}
              onChange={(e) => setValues({ ...values, sort_order: e.currentTarget.valueAsNumber })}
            />
            <CategorySelect
              value={values.categories as CategoryE[]}
              onChange={(v) => setValues({ ...values, categories: v })}
            />
          </div>
          <div>
            <Text strong>{t('full_meaning_description')}</Text>
            <TextArea
              value={values.definition}
              onChange={(e) => setValues({ ...values, definition: e.target.value })}
            />
          </div>
          <WordLinksSelect
            kind="synonyms"
            value={values.synonyms}
            onChange={(synonyms) => setValues({ ...values, synonyms })}
            headword={headword}
            exclude={values.antonyms}
          />
          <WordLinksSelect
            kind="antonyms"
            value={values.antonyms}
            onChange={(antonyms) => setValues({ ...values, antonyms })}
            headword={headword}
            exclude={values.synonyms}
          />
          <div className={styles.examples}>
            <div className={styles.examplesTitle}>
              <Text strong>{t('examples')}</Text>
              <Button size="small" className={styles.addBtn} onClick={addExample} type="primary">
                <PlusOutlined />
              </Button>
            </div>
            {values.examples.map((example, i) => (
              <div className={styles.example} key={i.toString()}>
                <Input onChange={(e) => changeExample(e.target.value, i)} value={example} />
                <Button type="primary" danger onClick={() => removeExample(i)}>
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
