'use client';

import React from 'react';
import { App, Button, Checkbox, Input, Popconfirm, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLocale, useTranslations } from 'next-intl';
import { ChangeActionE, ChangeEntityE, ChangeOriginE, ChangeT } from 'server/types';
import { EnApi } from '@/core/api/EnApi';
import { Select } from '@/core/ui/Select';
import { fullValue, recordName, saysNothing, shortValue, shownFields } from './utils';
import styles from './styles.module.scss';

const PAGE_SIZE = 25;
// a row of the table shows the first fields of a change; the rest is a click away
const FIELDS_IN_ROW = 3;
// the columns with a width of their own, the one of the button that opens a row included
const WIDTHS = { expand: 48, time: 110, what: 200, author: 170, state: 150 };
const VALUES_MIN_WIDTH = 300;
const TABLE_MIN_WIDTH =
  WIDTHS.expand + WIDTHS.time + WIDTHS.what + WIDTHS.author + WIDTHS.state + VALUES_MIN_WIDTH;

const ACTION_COLORS: Record<ChangeActionE, string> = {
  [ChangeActionE.create]: 'green',
  [ChangeActionE.update]: 'blue',
  [ChangeActionE.delete]: 'red',
};

// Who made a change, for the rows that name nobody: the owner of the
// instance, or a reader who gave no name
const UNNAMED_AUTHOR: Record<ChangeOriginE, 'author_admin' | 'author_reader'> = {
  [ChangeOriginE.admin]: 'author_admin',
  [ChangeOriginE.revert]: 'author_admin',
  [ChangeOriginE.suggestion]: 'author_reader',
};

const ORIGIN_COLORS: Record<ChangeOriginE, string> = {
  [ChangeOriginE.admin]: 'default',
  [ChangeOriginE.suggestion]: 'gold',
  [ChangeOriginE.revert]: 'purple',
};

type ChangesHistoryP = {
  /** The history of one article: no search, no column of the headword */
  headword?: string | undefined;
  partOfSpeech?: string | undefined;
  pageSize?: number | undefined;
  /** Changes when the entry was edited next to the list: the list is read again */
  refreshKey?: number | undefined;
  /** The record a change was about has its old values again */
  onReverted?: ((change: ChangeT) => void) | undefined;
};

/**
 * The history of the edits of the active dataset (issue #531): what was
 * changed, with the values before and after, where it came from and whether
 * it still shows in what is served. A change that still shows can be taken
 * back, the latest of a record first.
 */
export const ChangesHistory: React.FC<ChangesHistoryP> = ({
  headword,
  partOfSpeech,
  pageSize = PAGE_SIZE,
  refreshKey,
  onReverted,
}) => {
  // dates in the interface language, not the browser's (issue #479)
  const locale = useLocale();
  const t = useTranslations('changes');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();

  const [items, setItems] = React.useState<ChangeT[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [entities, setEntities] = React.useState<ChangeEntityE[]>([]);
  const [origins, setOrigins] = React.useState<ChangeOriginE[]>([]);
  const [search, setSearch] = React.useState('');
  const [author, setAuthor] = React.useState('');
  const [activeOnly, setActiveOnly] = React.useState(false);
  const [reverting, setReverting] = React.useState<number | null>(null);
  // bumped to read the list again after a change was taken back
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await EnApi.getChanges({
        page,
        limit: pageSize,
        headword,
        part_of_speech: partOfSpeech,
        entity: entities.length ? entities : undefined,
        origin: origins.length ? origins : undefined,
        search: search.trim() || undefined,
        author: author.trim() || undefined,
        active: activeOnly ? true : undefined,
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
  }, [
    page,
    pageSize,
    headword,
    partOfSpeech,
    entities,
    origins,
    search,
    author,
    activeOnly,
    version,
    refreshKey,
  ]);

  const revert = async (change: ChangeT) => {
    setReverting(change.id);
    const res = await EnApi.revertChange(change.id);
    setReverting(null);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    message.success(t('reverted'));
    setVersion((current) => current + 1);
    onReverted?.(change);
  };

  // Four columns, the values the widest: what was changed is what the table
  // is read for. The others have a width of their own, the values take the
  // rest and never less than VALUES_MIN_WIDTH — a narrow window scrolls the
  // table sideways instead of squeezing them
  const columns: ColumnsType<ChangeT> = [
    {
      title: t('col_time'),
      dataIndex: 'created_at',
      width: WIDTHS.time,
      render: (value: string) =>
        new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }),
    },
    {
      title: t('col_what'),
      key: 'what',
      width: WIDTHS.what,
      render: (_, row) => (
        <>
          {!headword && (
            <span className={styles.headword}>
              {row.headword}
              {row.part_of_speech && <span className={styles.partOfSpeech}> {row.part_of_speech}</span>}
            </span>
          )}
          <Tag color={ACTION_COLORS[row.action]}>{t(`action_${row.action}`)}</Tag>
          {t(`entity_${row.entity}`)}
          {recordName(row.record) && <span className={styles.record}>{recordName(row.record)}</span>}
        </>
      ),
    },
    {
      title: t('col_changes'),
      dataIndex: 'diff',
      render: (diff: ChangeT['diff']) => {
        const fields = shownFields(diff);
        return (
          <ul className={styles.diff}>
            {fields.slice(0, FIELDS_IN_ROW).map(([field, change]) => (
              <li key={field}>
                <code>{field}</code>: {shortValue(change.before)} → {shortValue(change.after)}
              </li>
            ))}
            {fields.length > FIELDS_IN_ROW && (
              <li className={styles.more}>{t('more_fields', { count: fields.length - FIELDS_IN_ROW })}</li>
            )}
          </ul>
        );
      },
    },
    {
      title: t('col_author'),
      key: 'author',
      width: WIDTHS.author,
      render: (_, row) => (
        <>
          <span className={row.author ? styles.authorName : styles.author} data-testid={`author-${row.id}`}>
            {row.author ?? t(UNNAMED_AUTHOR[row.origin])}
          </span>
          {/* an edit of the owner is the rule; what is not is said */}
          {row.origin !== ChangeOriginE.admin && (
            <Tag color={ORIGIN_COLORS[row.origin]}>{t(`origin_${row.origin}`)}</Tag>
          )}
        </>
      ),
    },
    {
      title: t('col_state'),
      key: 'state',
      width: WIDTHS.state,
      // stays in sight when the table scrolls sideways: the way back is in this column
      fixed: 'right',
      render: (_, row) =>
        row.superseded_at ? (
          <span className={styles.superseded}>
            {t('state_superseded', { date: new Date(row.superseded_at).toLocaleDateString(locale) })}
          </span>
        ) : (
          <div className={styles.state}>
            <Tag color="orange">{t('state_active')}</Tag>
            {row.revertible && (
              <Popconfirm
                title={t('revert_confirm')}
                okText={t('revert')}
                cancelText={t('cancel')}
                onConfirm={() => revert(row)}
              >
                <Button size="small" loading={reverting === row.id} data-testid={`revert-${row.id}`}>
                  {t('revert')}
                </Button>
              </Popconfirm>
            )}
          </div>
        ),
    },
  ];

  return (
    <div className={styles.section} data-testid="changes-history">
      <div className={styles.filters}>
        <Select<ChangeEntityE[]>
          label={t('filter_entity')}
          mode="multiple"
          allowClear
          containerClassName={styles.filter}
          value={entities}
          onChange={(next) => {
            setEntities(next ?? []);
            setPage(1);
          }}
          options={Object.values(ChangeEntityE).map((value) => ({ label: t(`entity_${value}`), value }))}
        />
        <Select<ChangeOriginE[]>
          label={t('filter_origin')}
          mode="multiple"
          allowClear
          containerClassName={styles.filter}
          value={origins}
          onChange={(next) => {
            setOrigins(next ?? []);
            setPage(1);
          }}
          options={Object.values(ChangeOriginE).map((value) => ({ label: t(`origin_${value}`), value }))}
        />
        {!headword && (
          <Input.Search
            className={styles.search}
            placeholder={t('filter_search')}
            allowClear
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
        )}
        <Input.Search
          className={styles.search}
          placeholder={t('filter_author')}
          aria-label={t('filter_author')}
          allowClear
          onSearch={(value) => {
            setAuthor(value);
            setPage(1);
          }}
        />
        <Checkbox
          checked={activeOnly}
          onChange={(event) => {
            setActiveOnly(event.target.checked);
            setPage(1);
          }}
        >
          {t('filter_active')}
        </Checkbox>
      </div>
      <Table<ChangeT>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={items}
        loading={loading}
        locale={{ emptyText: t('empty') }}
        tableLayout="fixed"
        scroll={{ x: TABLE_MIN_WIDTH }}
        expandable={{
          columnWidth: WIDTHS.expand,
          expandedRowRender: (row) => (
            <dl className={styles.values} data-testid={`values-${row.id}`}>
              {shownFields(row.diff).map(([field, change]) => (
                <React.Fragment key={field}>
                  <dt>
                    <code>{field}</code>
                  </dt>
                  <dd>
                    <span className={styles.side}>{t('before')}</span>
                    <pre>{saysNothing(change.before) ? '—' : fullValue(change.before)}</pre>
                  </dd>
                  <dd>
                    <span className={styles.side}>{t('after')}</span>
                    <pre>{saysNothing(change.after) ? '—' : fullValue(change.after)}</pre>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          ),
          expandIcon: ({ expanded, expandable, onExpand, record }) =>
            expandable ? (
              <Button
                type="text"
                size="small"
                aria-expanded={expanded}
                aria-label={t(expanded ? 'hide_values' : 'show_values')}
                title={t(expanded ? 'hide_values' : 'show_values')}
                onClick={(event) => onExpand(record, event)}
              >
                {expanded ? '−' : '+'}
              </Button>
            ) : null,
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          onChange: setPage,
        }}
      />
    </div>
  );
};

/**
 * Takes a name out of the history (issue #531): a reader who was named as
 * the author of a correction may ask for it. The edits stay.
 */
export const ForgetAuthor: React.FC<{ onForgotten?: (() => void) | undefined }> = ({ onForgotten }) => {
  const t = useTranslations('changes');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const author = name.trim();

  const forget = async () => {
    setBusy(true);
    const res = await EnApi.forgetChangeAuthor({ author });
    setBusy(false);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    if (res.forgotten === 0) {
      message.info(t('forgotten_none', { name: author }));
      return;
    }
    message.success(t('forgotten', { count: res.forgotten }));
    setName('');
    onForgotten?.();
  };

  return (
    <section className={styles.forget} data-testid="forget-author">
      <h3>{t('forget_title')}</h3>
      <p>{t('forget_hint')}</p>
      <div className={styles.forgetRow}>
        <Input
          className={styles.forgetInput}
          value={name}
          maxLength={128}
          placeholder={t('forget_placeholder')}
          aria-label={t('forget_placeholder')}
          onChange={(event) => setName(event.target.value)}
        />
        <Popconfirm
          title={t('forget_confirm', { name: author })}
          okText={t('forget_btn')}
          cancelText={t('cancel')}
          disabled={!author}
          onConfirm={forget}
        >
          <Button danger disabled={!author} loading={busy}>
            {t('forget_btn')}
          </Button>
        </Popconfirm>
      </div>
    </section>
  );
};
