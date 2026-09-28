'use client';

import React from 'react';
import { App, Button, Input, Popconfirm, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SuggestionKindE, SuggestionStatusE, SuggestionT } from 'server/types';
import { EnApi } from '@/core/api/EnApi';
import { Select } from '@/core/ui/Select';
import styles from './styles.module.scss';

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<SuggestionStatusE, string> = {
  [SuggestionStatusE.new]: 'gold',
  [SuggestionStatusE.resolved]: 'green',
  [SuggestionStatusE.dismissed]: 'default',
};

/** The moderation queue of reader reports (issue #327): filters + a server-paged table */
export const SuggestionsSection: React.FC = () => {
  const t = useTranslations('suggestions');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();
  const { locale } = useParams();

  const [items, setItems] = React.useState<SuggestionT[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [statuses, setStatuses] = React.useState<SuggestionStatusE[]>([SuggestionStatusE.new]);
  const [search, setSearch] = React.useState('');
  // bumped after a verdict so the effect refetches the open page
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await EnApi.getSuggestions({
        page,
        limit: PAGE_SIZE,
        status: statuses.length ? statuses : undefined,
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
  }, [page, statuses, search, refresh]);

  const setStatus = async (id: number, status: SuggestionStatusE) => {
    const res = await EnApi.updateSuggestionStatus(id, status);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    message.success(t(`marked_${status}`));
    setRefresh((n) => n + 1);
  };

  const remove = async (id: number) => {
    const res = await EnApi.deleteSuggestion(id);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    message.success(t('deleted'));
    setRefresh((n) => n + 1);
  };

  // one click: the proposed values go through the normal edit flow on the
  // server (audited, flags the entry user_modified) and the report resolves
  const apply = async (id: number) => {
    const res = await EnApi.applySuggestion(id);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    message.success(t('applied'));
    setRefresh((n) => n + 1);
  };

  const columns: ColumnsType<SuggestionT> = [
    {
      title: t('col_time'),
      dataIndex: 'created_at',
      width: 170,
      // in the interface language, not the browser's (issue #479)
      render: (value: string) => new Date(value).toLocaleString(locale),
    },
    {
      title: t('col_status'),
      dataIndex: 'status',
      width: 110,
      render: (status: SuggestionStatusE) => <Tag color={STATUS_COLORS[status]}>{t(`status_${status}`)}</Tag>,
    },
    {
      title: t('col_headword'),
      dataIndex: 'headword',
      width: 180,
      render: (headword: string, row) =>
        // the entry reference survives until a dictionary update replaces the
        // rows (#328); the headword alone still finds the word via search
        row.word_id !== null ? (
          <Link href={`/${locale}/managing/edit-word/${row.word_id}`}>{headword}</Link>
        ) : (
          headword
        ),
    },
    {
      title: t('col_kind'),
      dataIndex: 'kind',
      width: 100,
      render: (kind: SuggestionKindE) => (
        <Tag color={kind === SuggestionKindE.edit ? 'geekblue' : 'default'}>{t(`kind_${kind}`)}</Tag>
      ),
    },
    {
      title: t('col_message'),
      key: 'content',
      render: (_, row) => (
        <div className={styles.message}>
          {row.edits?.map((edit) => (
            <div key={`${edit.target_type}-${edit.target_id}`} className={styles.editBlock}>
              <span className={styles.editTarget}>
                {t(`target_${edit.target_type}`)} #{edit.target_id}
              </span>
              <ul className={styles.diff}>
                {Object.entries(edit.changes).map(([field, change]) => (
                  <li key={field}>
                    <code>{field}</code>: <span className={styles.before}>{change.before ?? '—'}</span> →{' '}
                    <span className={styles.after}>{change.after}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {row.message && <span>{row.message}</span>}
        </div>
      ),
    },
    {
      // who asked to be credited (issue #531): named in the history once the correction is applied
      title: t('col_author'),
      dataIndex: 'author_name',
      render: (value: string | null) => value ?? '—',
    },
    {
      title: t('col_dataset_version'),
      dataIndex: 'dataset_version',
      width: 130,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 240,
      render: (_, row) => (
        <div className={styles.actions}>
          {row.kind === SuggestionKindE.edit && row.status === SuggestionStatusE.new && (
            <Popconfirm title={t('apply_confirm')} onConfirm={() => apply(row.id)}>
              <Button size="small" type="primary">
                {t('action_apply')}
              </Button>
            </Popconfirm>
          )}
          {row.status !== SuggestionStatusE.resolved && (
            <Button
              size="small"
              type={row.kind === SuggestionKindE.edit ? 'default' : 'primary'}
              onClick={() => setStatus(row.id, SuggestionStatusE.resolved)}
            >
              {t('action_resolve')}
            </Button>
          )}
          {row.status !== SuggestionStatusE.dismissed && (
            <Button size="small" onClick={() => setStatus(row.id, SuggestionStatusE.dismissed)}>
              {t('action_dismiss')}
            </Button>
          )}
          <Popconfirm title={t('delete_confirm')} onConfirm={() => remove(row.id)}>
            <Button size="small" danger>
              {t('action_delete')}
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.filters}>
        <Select<SuggestionStatusE[]>
          label={t('filter_status')}
          mode="multiple"
          allowClear
          containerClassName={styles.filter}
          value={statuses}
          onChange={(next) => {
            setStatuses(next ?? []);
            setPage(1);
          }}
          options={Object.values(SuggestionStatusE).map((value) => ({
            label: t(`status_${value}`),
            value,
          }))}
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
      <Table<SuggestionT>
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
