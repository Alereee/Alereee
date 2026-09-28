'use client';

import React, { useState } from 'react';
import { Alert, Empty, Segmented, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { ErrorResT } from 'server/types';
import { extractMeta, extractWords, ResponseMetaT } from '../../utils';
import { WordsTable } from '../WordsTable';
import styles from './styles.module.scss';

const { Text } = Typography;

enum ResponseViewModeE {
  json = 'json',
  table = 'table',
}

type ResponseViewP = {
  response: unknown;
  elapsedMs: number | null;
};

const isErrorResponse = (response: unknown): response is ErrorResT =>
  !!response && typeof response === 'object' && 'error' in response;

// A failed validation answers with an array of messages instead of an error code
const readErrorMessage = (message: ErrorResT['message']): string =>
  Array.isArray(message) ? message.join('; ') : String(message ?? '');

export const ResponseView: React.FC<ResponseViewP> = ({ response, elapsedMs }) => {
  const t = useTranslations('documentation');
  const tErr = useTranslations('errors');
  const [mode, setMode] = useState<ResponseViewModeE>(ResponseViewModeE.json);

  if (response === null) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('no_request_yet')} />;
  }

  const words = extractWords(response);
  const meta = extractMeta(response);
  const json = JSON.stringify(response, null, 2);

  const metaColumns: ColumnsType<ResponseMetaT> = [
    { title: t('col_field'), dataIndex: 'key', key: 'key', render: (key: string) => <Text code>{key}</Text> },
    { title: t('col_value'), dataIndex: 'value', key: 'value' },
  ];

  const renderError = () => {
    const rawMessage = readErrorMessage((response as ErrorResT).message);
    const description = tErr.has(rawMessage) ? tErr(rawMessage) : rawMessage;

    return <Alert type="error" showIcon title={t('request_failed')} description={description} />;
  };

  const renderTable = () => {
    if (words?.length) {
      return (
        <div className={styles.tableView}>
          {meta.length > 0 && (
            <Table<ResponseMetaT>
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={meta}
              columns={metaColumns}
            />
          )}
          <WordsTable words={words} />
        </div>
      );
    }

    if (meta.length > 0) {
      return (
        <Table<ResponseMetaT>
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={meta}
          columns={metaColumns}
        />
      );
    }

    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('empty_result')} />;
  };

  return (
    <div className={styles.responseView}>
      <div className={styles.toolbar}>
        <Segmented<ResponseViewModeE>
          value={mode}
          onChange={setMode}
          options={[
            { label: t('view_json'), value: ResponseViewModeE.json },
            { label: t('view_table'), value: ResponseViewModeE.table },
          ]}
        />
        <div className={styles.badges}>
          {elapsedMs !== null && <Tag>{t('elapsed', { ms: elapsedMs })}</Tag>}
          {words !== null && <Tag>{t('items_count', { count: words.length })}</Tag>}
          <Text copyable={{ text: json }}>{t('copy_json')}</Text>
        </div>
      </div>

      {isErrorResponse(response) && renderError()}

      {mode === ResponseViewModeE.json ? <pre className={styles.json}>{json}</pre> : renderTable()}
    </div>
  );
};
