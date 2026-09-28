'use client';

import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { App, Button, Collapse, Popconfirm, Tag, Typography } from 'antd';
import { useParams, useRouter } from 'next/navigation';
import { EditOutlined } from '@ant-design/icons';
import {
  DatasetT,
  EnMeaningT,
  EnPartOfSpeechE,
  EnShortTranslationT,
  EnWordFormT,
  EnWordT,
  EnAreaVariantsE,
} from 'server/types';
import { WordForms } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/WordForms';
import { FormsByPartOfSpeech } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/constants';
import { Icon } from '@/core/ui/Icon';
import { FlagByAreaEnum } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/WordForms/constants';
import { IconNamesT } from '@/core/ui/icons/types';
import { NounInfoTags } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/NounInfoTags';
import { useTranslations } from 'next-intl';
import { VerbInfoTags } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/VerbInfoTags';
import { CategoriesTags } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/CategoriesTags';
import { ShortTranslationsPreview } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/ShortTranslationsPreview';
import { MeaningsPreview } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/MeaningsPreview';
import { UpdateTypeE, WordCardModeE } from './constants';
import { EditCommonDataModal } from '@/app/[locale]/(main-admin-content)/managing/_components/WordCard/components/EditCommonDataModal';
import { CommonInfoDataT } from '@/app/[locale]/(main-admin-content)/managing/_components/EnWordForm/types';
import { EnApi } from '@/core/api/EnApi';
import { ChangesHistory } from '@/components/ChangesHistory';
import {
  EditedDatasetContext,
  EditLicenseNote,
} from '@/app/[locale]/(main-admin-content)/managing/_components/EditLicenseNote';
import styles from './styles.module.scss';

const { Text } = Typography;

type WordCardP = {
  word: EnWordT;
  mode?: WordCardModeE | undefined;
  // the dataset the word belongs to (issue #531): the card and its dialogs
  // say under which license an edit is published
  dataset?: DatasetT | undefined;
};

export const WordCard: React.FC<WordCardP> = ({ word, mode = WordCardModeE.view, dataset }) => {
  const [state, setState] = useState<EnWordT>(word);
  const [showEditDataModal, setShowEditDataModal] = useState<boolean>(false);
  const t = useTranslations('en_managing_words');
  const tError = useTranslations('errors');
  const tChanges = useTranslations('changes');
  const { wordId, locale } = useParams();
  const router = useRouter();
  const { message } = App.useApp();
  // the history under the card is read again after every edit made in the card (issue #531)
  const [edits, setEdits] = useState(0);
  const shown = useRef(state);
  useEffect(() => {
    if (shown.current === state) return;
    shown.current = state;
    setEdits((current) => current + 1);
  }, [state]);

  // a change was taken back: the card shows what the entry says now
  const reload = async () => {
    const res = await EnApi.getWordById(word.id);
    if ('error' in res) {
      // the creation of the word itself was taken back
      router.push(`/${locale as string}/managing`);
      return;
    }
    setState(res);
  };
  const formNames = FormsByPartOfSpeech[word.part_of_speech];

  // An edit that changed something flags the entry as modified on the server
  // (issue #328); one that changed nothing does not. The server knows which
  // it was, so the card asks it instead of assuming
  const syncUserModified = async () => {
    const res = await EnApi.getWordById(word.id);
    if ('error' in res) return;
    setState((p) => ({ ...p, user_modified: res.user_modified }));
  };

  const editCommonInfo = async (data: Omit<CommonInfoDataT, 'id' | 'form_of_word' | 'base_phrasal'>) => {
    // The card data carries `version` (loaded with the word), but the edit
    // endpoint whitelists its request fields and rejects unknown ones
    const { version: _version, ...payload } = data;
    const res = await EnApi.editCommonInfoOfWord(wordId as string, payload);
    if ('error' in res) {
      message.error(tError(res.message));
    } else {
      setShowEditDataModal(false);
      setState((p) => ({ ...p, ...data }));
      void syncUserModified();
    }
  };

  // Clears the user-modified flag (issue #328): the next dictionary update
  // replaces this entry with the official dataset content again
  const resetUserModified = async () => {
    const res = await EnApi.resetEntryUserModified(word.word);
    if ('error' in res) {
      message.error(tError(res.message));
    } else {
      setState((p) => ({ ...p, user_modified: false }));
      message.success(t('user_modified_reset_done'));
    }
  };

  const updateFormOfWord = (f: EnWordFormT, type: UpdateTypeE) => {
    switch (type) {
      case UpdateTypeE.add:
        setState((p) => ({ ...p, forms: [...p.forms, f] }));
        break;
      case UpdateTypeE.edit:
        setState((p) => ({ ...p, forms: p.forms.map((fo) => (fo.id === f.id ? f : fo)) }));
        break;
      case UpdateTypeE.delete:
        setState((p) => ({ ...p, forms: p.forms.filter((fo) => fo.id !== f.id) }));
        break;
    }
    void syncUserModified();
  };

  const updateShortTranslation = (t: EnShortTranslationT, type: UpdateTypeE) => {
    switch (type) {
      case UpdateTypeE.add:
        setState((p) => ({ ...p, short_translations: [...p.short_translations, t] }));
        break;
      case UpdateTypeE.edit:
        setState((p) => ({
          ...p,
          short_translations: p.short_translations.map((tr) => (tr.id === t.id ? t : tr)),
        }));
        break;
      case UpdateTypeE.delete:
        setState((p) => ({
          ...p,
          short_translations: p.short_translations.filter((f) => f.id !== t.id),
        }));
        break;
    }
    void syncUserModified();
  };

  const updateMeaning = (m: EnMeaningT, type: UpdateTypeE) => {
    switch (type) {
      case UpdateTypeE.add:
        setState((p) => ({ ...p, meanings: [...p.meanings, m] }));
        break;
      case UpdateTypeE.edit:
        setState((p) => ({
          ...p,
          meanings: p.meanings.map((tr) => (tr.id === m.id ? m : tr)),
        }));
        break;
      case UpdateTypeE.delete:
        setState((p) => ({ ...p, meanings: p.meanings.filter((f) => f.id !== m.id) }));
        break;
    }
    void syncUserModified();
  };

  const updatePhrasal = (v: string | null) => {
    setState((p) => ({ ...p, base_phrasal: v || undefined }));
    void syncUserModified();
  };

  return (
    <EditedDatasetContext.Provider value={mode === WordCardModeE.edit ? dataset : undefined}>
      {mode === WordCardModeE.edit && <EditLicenseNote />}
      <EditCommonDataModal
        data={state}
        isOpen={showEditDataModal}
        onClose={() => setShowEditDataModal(false)}
        pos={word.part_of_speech}
        submit={editCommonInfo}
      />
      <section className={styles.wordCard}>
        {mode === WordCardModeE.edit && (
          <Button
            className={styles.editCommonData}
            type="primary"
            size="small"
            onClick={() => setShowEditDataModal(true)}
          >
            <EditOutlined />
            {t('edit_common_data_btn')}
          </Button>
        )}
        <div className={clsx(styles.line, styles.mainLine)}>
          <Tag className={styles.mainTag} color="volcano" variant="outlined">
            <Icon name={FlagByAreaEnum[word.area_variant ?? EnAreaVariantsE.common] as IconNamesT} />
            {word.word}
          </Tag>
          <Tag color="blue" variant="outlined">
            {word.part_of_speech}
          </Tag>
        </div>
        <div className={styles.line}>
          <Tag className={styles.tag} color="geekblue" variant="outlined">
            <Text>{t('version')}:</Text>
            {state.version}
          </Tag>
          <Tag className={styles.tag} color="geekblue" variant="outlined">
            <Text>{t('pronunciation')}:</Text>
            {state.transcription}
          </Tag>
          <Tag className={styles.tag} color="success" variant="outlined">
            <Text>{t('level')}:</Text>
            {state.word_level}
          </Tag>
          <Tag className={styles.tag} color="geekblue" variant="outlined">
            <Text>{t('register')}:</Text>
            {state.language_register}
          </Tag>
          <Tag className={styles.tag} color="geekblue" variant="outlined">
            {t('is_obsolete')}
          </Tag>
          {state.generated && (
            <Tag className={styles.tag} color="geekblue" variant="outlined">
              {t('is_ai_generated')}
            </Tag>
          )}
          {state.generated && (
            <Tag className={styles.tag} color="geekblue" variant="outlined">
              <Text>{t('source_model')}:</Text>
              {state.generated_by_model}
            </Tag>
          )}
          {state.user_modified && (
            <Tag className={styles.tag} color="orange" variant="outlined">
              {t('user_modified')}
            </Tag>
          )}
          {mode === WordCardModeE.edit && state.user_modified && (
            <Popconfirm
              title={t('user_modified_reset_confirm')}
              onConfirm={resetUserModified}
              okText={t('user_modified_reset_ok')}
              cancelText={t('user_modified_reset_cancel')}
            >
              <Button size="small">{t('user_modified_reset')}</Button>
            </Popconfirm>
          )}
        </div>
        {word.part_of_speech === EnPartOfSpeechE.noun && <NounInfoTags word={state} />}
        {word.part_of_speech === EnPartOfSpeechE.verb && (
          <VerbInfoTags word={state} mode={mode} updatePhrasal={updatePhrasal} />
        )}
        {state.categories && state.categories.length > 0 && (
          <CategoriesTags categories={state.categories || []} word={word.word} />
        )}
        <div className={styles.desc}>
          <Text strong>{t('description')}</Text>
          <Text code>{state.description}</Text>
        </div>
        {word.part_of_speech === EnPartOfSpeechE.grammar_pattern && state.pattern && (
          <div className={styles.desc}>
            <Text strong>{t('pattern')}</Text>
            <Text italic>{state.pattern?.join(' ')}</Text>
          </div>
        )}
        {formNames && (
          <WordForms
            updateFormOfWord={updateFormOfWord}
            forms={state.forms}
            formNames={formNames}
            mode={mode}
          />
        )}
        <ShortTranslationsPreview
          translations={state.short_translations}
          mode={mode}
          updateShortTranslation={updateShortTranslation}
        />
        <MeaningsPreview
          meanings={state.meanings}
          mode={mode}
          updateMeaning={updateMeaning}
          headword={word.word}
        />
      </section>
      {mode === WordCardModeE.edit && (
        // a wrapper of its own: the margin of a class does not outweigh the styles of the component
        <div className={styles.history}>
          <Collapse
            items={[
              {
                key: 'history',
                label: tChanges('title'),
                children: (
                  <>
                    <p className={styles.historyIntro}>{tChanges('intro')}</p>
                    <ChangesHistory
                      headword={word.word}
                      partOfSpeech={word.part_of_speech}
                      pageSize={10}
                      refreshKey={edits}
                      onReverted={reload}
                    />
                  </>
                ),
              },
            ]}
          />
        </div>
      )}
    </EditedDatasetContext.Provider>
  );
};
