'use client';

import React from 'react';
import { App, Input, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLocale, useTranslations } from 'next-intl';
import { AuditActionE, AuditEntityTypeE, AuditEntryT } from 'server/types';
import { EnApi } from '@/core/api/EnApi';
import { Select } from '@/core/ui/Select';
import styles from './styles.module.scss';

const PAGE_SIZE = 25;

const ACTION_COLORS: Record<AuditActionE, string> = {
  [AuditActionE.create]: 'green',
  [AuditActionE.update]: 'blue',
  [AuditActionE.delete]: 'red',
  [AuditActionE.import]: 'purple',
};

// What the journal is written for (issue #531): the edits of the dictionary
// are the history of the dataset. The rows of the other kinds, written
// before that, are still listed until they expire — nothing new to filter by
const EVENT_ENTITY_TYPES: AuditEntityTypeE[] = [
  AuditEntityTypeE.dictionary,
  AuditEntityTypeE.dataset,
  AuditEntityTypeE.setting,
  AuditEntityTypeE.suggestion,
  AuditEntityTypeE.word,
];

const short = (value: unknown): string => {
  const text = value === null || value === undefined ? '—' : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

/** The journal of what was done on the instance (issue #334): filters + a server-paged table */
export const HistorySection: React.FC = () => {
  // dates in the interface language, not the browser's (issue #479)
  const locale = useLocale();
  const t = useTranslations('history');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();

  const [items, setItems] = React.useState<AuditEntryT[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [entityTypes, setEntityTypes] = React.useState<AuditEntityTypeE[]>([]);
  const [actions, setActions] = React.useState<AuditActionE[]>([]);
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await EnApi.getAuditLog({
        page,
        limit: PAGE_SIZE,
        entity_type: entityTypes.length ? entityTypes : undefined,
        action: actions.length ? actions : undefined,
        search: search.trim() || undefined,
      });
      if (cancelled) return;
      setLoading(false);
      if ('error' in res) {
        message.error(tErr(res.message));
        return;
      }
      setItems(res.items);
      setTotal(res.total);
    })();
    return () => {
      cancelled = true;
    };
    // message / tErr are stable enough; only the query inputs should refetch
  }, [page, entityTypes, actions, search]);

  const columns: ColumnsType<AuditEntryT> = [
    {
      title: t('col_time'),
      dataIndex: 'created_at',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(locale),
    },
    {
      title: t('col_action'),
      dataIndex: 'action',
      width: 110,
      render: (action: AuditActionE) => <Tag color={ACTION_COLORS[action]}>{t(`action_${action}`)}</Tag>,
    },
    {
      title: t('col_entity'),
      dataIndex: 'entity_type',
      width: 160,
      render: (entity: AuditEntityTypeE, row) => (
        <span>
          {t(`entity_${entity}`)}
          {row.entity_id !== null && <span className={styles.entityId}> #{row.entity_id}</span>}
        </span>
      ),
    },
    {
      title: t('col_headword'),
      dataIndex: 'headword',
      width: 180,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: t('col_changes'),
      dataIndex: 'diff',
      render: (diff: AuditEntryT['diff']) =>
        diff ? (
          <ul className={styles.diff}>
            {Object.entries(diff).map(([field, change]) => (
              <li key={field}>
                <code>{field}</code>: <span title={JSON.stringify(change.before)}>{short(change.before)}</span>{' '}
                → <span title={JSON.stringify(change.after)}>{short(change.after)}</span>
              </li>
            ))}
          </ul>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.filters}>
        <Select<AuditEntityTypeE[]>
          label={t('filter_entity')}
          mode="multiple"
          allowClear
          containerClassName={styles.filter}
          value={entityTypes}
          onChange={(next) => {
            setEntityTypes(next ?? []);
            setPage(1);
          }}
          options={EVENT_ENTITY_TYPES.map((value) => ({ label: t(`entity_${value}`), value }))}
        />
        <Select<AuditActionE[]>
          label={t('filter_action')}
          mode="multiple"
          allowClear
          containerClassName={styles.filter}
          value={actions}
          onChange={(next) => {
            setActions(next ?? []);
            setPage(1);
          }}
          options={Object.values(AuditActionE).map((value) => ({ label: t(`action_${value}`), value }))}
        />
        <Input.Search
          className={styles.search}
          placeholder={t('filter_search')}
          allowClear
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
      </div>
      <Table<AuditEntryT>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={items}
        loading={loading}
        locale={{ emptyText: t('empty') }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />
    </div>
  );
};
