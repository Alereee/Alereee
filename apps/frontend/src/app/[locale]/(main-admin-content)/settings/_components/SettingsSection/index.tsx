'use client';

import React from 'react';
import { App, Button, Input, Modal, Popconfirm, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { SettingsApi } from '@/core/api/SettingsApi';
import styles from './styles.module.scss';

type RowT = { field: string; value: string };

// `version` is virtual (the app version from the config; the server refuses
// its mutations), `en_dataset_version` is the import bookkeeping (issue #328),
// `dataset_removed_at` dates the reads of every dataset (issue #528)
const READ_ONLY_FIELDS = ['version'];
const SYSTEM_FIELDS = ['version', 'en_dataset_version', 'dataset_removed_at'];

/** The settings table with its full CRUD (issue #347) */
export const SettingsSection: React.FC = () => {
  const t = useTranslations('settings_page');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();

  const [rows, setRows] = React.useState<RowT[]>([]);
  const [loading, setLoading] = React.useState(false);
  // bumped after a mutation so the effect refetches
  const [refresh, setRefresh] = React.useState(0);

  const [newField, setNewField] = React.useState('');
  const [newValue, setNewValue] = React.useState('');
  const [editing, setEditing] = React.useState<RowT | null>(null);
  const [editingValue, setEditingValue] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const settings = await SettingsApi.getSettings();
      if (cancelled) return;
      setLoading(false);
      setRows(Object.entries(settings).map(([field, value]) => ({ field, value })));
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const add = async () => {
    const res = await SettingsApi.addField(newField.trim(), newValue);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    message.success(t('added'));
    setNewField('');
    setNewValue('');
    setRefresh((n) => n + 1);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await SettingsApi.updateField(editing.field, editingValue);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    message.success(t('updated'));
    setEditing(null);
    setRefresh((n) => n + 1);
  };

  const remove = async (field: string) => {
    const res = await SettingsApi.deleteField(field);
    if ('error' in res) {
      message.error(tErr(res.message));
      return;
    }
    message.success(t('deleted'));
    setRefresh((n) => n + 1);
  };

  const columns: ColumnsType<RowT> = [
    {
      title: t('col_field'),
      dataIndex: 'field',
      width: 260,
      render: (field: string) => (
        <span className={styles.fieldName}>
          <code>{field}</code>
          {SYSTEM_FIELDS.includes(field) && <Tag color="purple">{t('system_tag')}</Tag>}
        </span>
      ),
    },
    {
      title: t('col_value'),
      dataIndex: 'value',
      render: (value: string) => <span className={styles.value}>{value || '—'}</span>,
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 170,
      render: (_, row) =>
        READ_ONLY_FIELDS.includes(row.field) ? null : (
          <div className={styles.actions}>
            <Button
              size="small"
              onClick={() => {
                setEditing(row);
                setEditingValue(row.value);
              }}
            >
              {t('action_edit')}
            </Button>
            <Popconfirm title={t('delete_confirm', { field: row.field })} onConfirm={() => remove(row.field)}>
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
      <div className={styles.addForm}>
        <Input
          className={styles.addField}
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          placeholder={t('field_placeholder')}
          aria-label={t('col_field')}
        />
        <Input
          className={styles.addValue}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={t('value_placeholder')}
          aria-label={t('col_value')}
        />
        <Button type="primary" disabled={!newField.trim()} onClick={add}>
          {t('action_add')}
        </Button>
      </div>

      <Table<RowT>
        rowKey="field"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="middle"
      />

      <Modal
        title={editing ? t('edit_title', { field: editing.field }) : ''}
        open={editing !== null}
        onOk={saveEdit}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <Input.TextArea
          rows={3}
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          aria-label={t('col_value')}
        />
      </Modal>
    </div>
  );
};
