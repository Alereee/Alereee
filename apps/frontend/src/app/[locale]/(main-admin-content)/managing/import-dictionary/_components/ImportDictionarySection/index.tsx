'use client';

import React from 'react';
import { App, Button, Progress, Tabs, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { DatasetsListT, ImportDictionaryChunkT, ImportSourceFileT, ImportSourceKindE } from 'server/types';
import { DEFAULT_DATASET_NAME } from 'server/core/constants/datasets';
import { EnDictionaryImportPhasesE } from 'server/src/modules/EnModule/modules/EnImportDictionary/constants';
import { ErrorCodes } from 'server/core/constants/error_codes';
import { EnApi } from '@/core/api/EnApi';
import { Select } from '@/core/ui/Select';
import { useImportStatus } from '@/components/AutoImportBanner/useImportStatus';
import { formatTime, getDownloadProgressStr } from './utils';
import { ImportStatusE } from './constants';
import { ImportSourceTabE, ManifestModeE, ManualManifestT, SlotFilesT } from './types';
import { ArchiveSource } from './components/ArchiveSource';
import { JSONL_SLOTS, SeparateFilesSource } from './components/SeparateFilesSource';
import styles from './styles.module.scss';

const EMPTY_MANUAL_MANIFEST: ManualManifestT = { version: '', synonym_links: '', antonym_links: '' };

const { Text } = Typography;

type ImportDictionarySectionP = {
  // dataset version of the last successful import, from the settings store
  yourVersion?: string | undefined;
  // dataset version from the published manifest, fetched server-side;
  // undefined when the dataset has no manifest yet
  latestVersion?: string | undefined;
  // the datasets of the instance (issue #527); absent when the list could not be read
  datasets?: DatasetsListT | undefined;
  // the dataset the page was opened for (the "import into it" link of the datasets page)
  initialTarget?: string | undefined;
};

export const ImportDictionarySection: React.FC<ImportDictionarySectionP> = ({
  yourVersion,
  latestVersion: latestVersionProp,
  datasets,
  initialTarget,
}) => {
  // Where the import writes (issue #527): the active dataset or another one
  // the instance holds. A dataset of a public source is installed on the
  // datasets page, from the file of its source; what is imported here is a
  // dataset in the project's format — the published one, an export. Only a
  // driver with schemas offers the choice, and only when there is one.
  const installed = (datasets?.datasets ?? []).filter((d) => d.installed);
  const canChooseTarget = !!datasets?.supported && installed.length > 1;
  const activeName = datasets?.active ?? DEFAULT_DATASET_NAME;
  const [target, setTarget] = React.useState<string>(
    canChooseTarget && initialTarget && installed.some((d) => d.name === initialTarget)
      ? initialTarget
      : activeName,
  );
  // what the request names: nothing for the active dataset, as before
  const targetName = !canChooseTarget || target === activeName ? undefined : target;
  const intoActive = targetName === undefined;
  const [percents, setPercents] = React.useState<number>(0);
  const [status, setStatus] = React.useState<ImportStatusE>(ImportStatusE.idle);
  const [statusMessage, setStatusMessage] = React.useState<string>('');
  // summary of an update-mode import (issue #328), from the completed chunk
  const [updateSummary, setUpdateSummary] = React.useState<{
    updated: number;
    added: number;
    kept: number;
  } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number>(0);
  // The published dataset is the project's own and goes into the project's
  // dataset only: its version is compared with that one, and an import of it
  // into a dataset of a public source would be refused (issue #530). Those
  // are updated on the datasets page, from the file of their source.
  const ownTarget = (targetName ?? activeName) === DEFAULT_DATASET_NAME;
  const [activeVersion, setInstalledVersion] = React.useState<string | undefined>(yourVersion);
  // the version the chosen dataset holds: the active one's from the settings, another one's from the registry
  const installedVersion = intoActive
    ? activeVersion
    : (datasets?.datasets.find((d) => d.name === targetName)?.version ?? undefined);
  const [latestVersion, setLatestVersion] = React.useState<string | undefined>(latestVersionProp);
  // where the next import reads from (issue #269): the published dataset, an
  // archive (uploaded or picked on the server) or the dataset files in slots
  const [sourceTab, setSourceTab] = React.useState<ImportSourceTabE>(ImportSourceTabE.huggingface);
  const [archive, setArchive] = React.useState<File | null>(null);
  const [serverFiles, setServerFiles] = React.useState<ImportSourceFileT[]>([]);
  // version tags of the published dataset (issue #322); '' = the moving main
  const [revisions, setRevisions] = React.useState<string[]>([]);
  const [revision, setRevision] = React.useState('');
  const [importDirConfigured, setImportDirConfigured] = React.useState(false);
  const [serverPath, setServerPath] = React.useState<string | undefined>(undefined);
  const [slotFiles, setSlotFiles] = React.useState<SlotFilesT>({});
  const [manifestMode, setManifestMode] = React.useState<ManifestModeE>(ManifestModeE.file);
  const [manualManifest, setManualManifest] = React.useState<ManualManifestT>(EMPTY_MANUAL_MANIFEST);
  const t = useTranslations('import_dictionary');
  const tErr = useTranslations('errors');
  const { message } = App.useApp();

  const inProgress = status === ImportStatusE.in_progress;
  // a populated dictionary updates in place (issue #328): entries the admin
  // edited are kept, the rest is replaced with the new dataset
  const updateAvailable =
    ownTarget && !!installedVersion && !!latestVersion && installedVersion !== latestVersion;
  // the server runs one import at a time (issue #268): while the automatic
  // load on first start or an import from another session holds the slot,
  // the start button waits — the banner above says what is running
  const slot = useImportStatus();
  const lockedByOther = !inProgress && !!slot?.running;
  const fromHuggingFace = sourceTab === ImportSourceTabE.huggingface;
  const isUpToDate =
    ownTarget && fromHuggingFace && !!installedVersion && !!latestVersion && installedVersion === latestVersion;
  // nothing chosen disables the start: an archive (uploaded or picked on the
  // server) on the archive tab, at least one jsonl slot on the files tab
  const canStart =
    (fromHuggingFace && ownTarget) ||
    (sourceTab === ImportSourceTabE.archive && (!!archive || !!serverPath)) ||
    (sourceTab === ImportSourceTabE.files && JSONL_SLOTS.some((slot) => !!slotFiles[slot]));

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await EnApi.getImportSources();
      if (cancelled || 'error' in res) return;
      setImportDirConfigured(res.import_dir_configured);
      setServerFiles(res.files);
      setRevisions(res.revisions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!inProgress) return undefined;

    const startedAt = Date.now();
    setElapsedSeconds(0);

    const intervalId = setInterval(() => {
      setElapsedSeconds((Date.now() - startedAt) / 1000);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [inProgress]);

  const onError = React.useCallback(
    (err: string) => {
      message.error(tErr(err || ErrorCodes.unknown_error));
      setStatus(ImportStatusE.error);
    },
    [message, tErr],
  );

  const importDictionary = async (update = false) => {
    setStatus(ImportStatusE.in_progress);
    setPercents(0);
    setStatusMessage('');
    setUpdateSummary(null);

    let completedSeen = false;
    let seenDatasetVersion: string | undefined;

    const handleChunk = (c: ImportDictionaryChunkT) => {
      const percent = Math.min(100, Math.max(0, c.percent ?? 0));

      if (c.datasetVersion) {
        seenDatasetVersion = c.datasetVersion;
        setLatestVersion(c.datasetVersion);
      }

      if (c.stage === EnDictionaryImportPhasesE.completed) {
        completedSeen = true;
        setPercents(100);
        setStatusMessage('');
        if (c.updated_entries !== undefined) {
          setUpdateSummary({
            updated: c.updated_entries,
            added: c.added_entries ?? 0,
            kept: c.kept_user_modified ?? 0,
          });
        }
      } else if (c.stage === EnDictionaryImportPhasesE.downloading_database) {
        const progressPart = getDownloadProgressStr(c);
        setStatusMessage(`${t(`en_saving_${c.stage}`)} ${progressPart} ${percent.toFixed(2)}%`);
      } else {
        setPercents(Number(percent.toFixed(2)));
        setStatusMessage(t(`en_saving_${c.stage}`));
      }
    };

    const runImport = () => {
      if (sourceTab === ImportSourceTabE.files) {
        // a manifest typed by hand replaces the manifest slot
        const { manifest: _manifest, ...jsonl } = slotFiles;
        const manual = manifestMode === ManifestModeE.manual;
        return EnApi.uploadDictionary(
          manual ? jsonl : slotFiles,
          {
            ...(manual
              ? {
                  version: manualManifest.version.trim() || undefined,
                  synonym_links:
                    manualManifest.synonym_links === '' ? undefined : Number(manualManifest.synonym_links),
                  antonym_links:
                    manualManifest.antonym_links === '' ? undefined : Number(manualManifest.antonym_links),
                }
              : {}),
            dataset: targetName,
          },
          handleChunk,
          onError,
        );
      }
      if (sourceTab === ImportSourceTabE.archive && archive) {
        return EnApi.uploadDictionary({ archive }, { dataset: targetName }, handleChunk, onError);
      }
      return EnApi.importDictionary(
        {
          ...(targetName ? { dataset: targetName } : {}),
          ...(sourceTab === ImportSourceTabE.archive && serverPath
            ? { source: { kind: ImportSourceKindE.file, path: serverPath } }
            : fromHuggingFace && revision
              ? // a chosen version tag pins the HF import to that revision (issue #322)
                { source: { kind: ImportSourceKindE.huggingface, revision } }
              : {}),
          ...(update ? { update: true } : {}),
        },
        handleChunk,
        onError,
      );
    };
    const res = await runImport();
    if ('error' in res) {
      onError(res.message);
      return;
    }

    // Стрим закончился без чанка completed — сервер оборвал импорт.
    if (!completedSeen) {
      onError(ErrorCodes.unknown_error);
      return;
    }

    if (seenDatasetVersion && intoActive) {
      setInstalledVersion(seenDatasetVersion);
    }
    setStatus(ImportStatusE.success);
  };

  const progressStatus =
    status === ImportStatusE.in_progress
      ? 'active'
      : status === ImportStatusE.success
        ? 'success'
        : status === ImportStatusE.error
          ? 'exception'
          : 'normal';

  return (
    <div className={styles.importDictionarySection}>
      {canChooseTarget && (
        <div className={styles.target}>
          <Select<string>
            label={t('dataset_target')}
            value={target}
            disabled={inProgress}
            onChange={(value) => setTarget(value)}
            options={[
              { value: activeName, label: t('dataset_active', { name: activeName }) },
              ...installed
                .filter((d) => d.name !== activeName)
                .map((d) => ({ value: d.name, label: `${d.name} — ${d.title}` })),
            ]}
          />
          {!intoActive && <Text type="secondary">{t('dataset_hint')}</Text>}
        </div>
      )}
      <Tabs
        activeKey={sourceTab}
        onChange={(key) => !inProgress && setSourceTab(key as ImportSourceTabE)}
        items={[
          {
            key: ImportSourceTabE.huggingface,
            label: t('source_huggingface'),
            children: (
              <div className={styles.hfTab}>
                <Text strong>
                  {t('latest_version')}: {latestVersion || '—'}
                </Text>
                {revisions.length > 0 && (
                  <Select<string>
                    label={t('revision')}
                    value={revision}
                    disabled={inProgress}
                    onChange={(value) => setRevision(value)}
                    options={[
                      { value: '', label: t('revision_latest') },
                      ...revisions.map((tag) => ({ value: tag, label: tag })),
                    ]}
                  />
                )}
                {updateAvailable && !inProgress && <Text type="warning">{t('update_available')}</Text>}
                {!ownTarget && (
                  <Text type="secondary" data-testid="published-not-for-target">
                    {t('published_is_own', { name: targetName ?? activeName })}
                  </Text>
                )}
              </div>
            ),
          },
          {
            key: ImportSourceTabE.archive,
            label: t('source_archive'),
            children: (
              <ArchiveSource
                archive={archive}
                onArchiveChange={setArchive}
                importDirConfigured={importDirConfigured}
                serverFiles={serverFiles}
                serverPath={serverPath}
                onServerPathChange={setServerPath}
                disabled={inProgress}
              />
            ),
          },
          {
            key: ImportSourceTabE.files,
            label: t('source_files'),
            children: (
              <SeparateFilesSource
                files={slotFiles}
                onFilesChange={setSlotFiles}
                manifestMode={manifestMode}
                onManifestModeChange={setManifestMode}
                manual={manualManifest}
                onManualChange={setManualManifest}
                disabled={inProgress}
              />
            ),
          },
        ]}
      />
      <Text strong>
        {t('your_version')}: {installedVersion || '—'}
      </Text>
      <Progress
        className={styles.progress}
        percent={percents}
        status={progressStatus}
        format={(p = 0) => `${p.toFixed(2)}%`}
      />
      {isUpToDate && !inProgress && <Text type="success">{t('up_to_date')}</Text>}
      {(status === ImportStatusE.idle || status === ImportStatusE.error) && (
        <div className={styles.actions}>
          {/* the one-click update (issue #328): replaces everything except
              the entries the admin edited; only for the published dataset */}
          {fromHuggingFace && updateAvailable && (
            <Button
              type="primary"
              onClick={() => importDictionary(true)}
              disabled={lockedByOther}
              className={styles.startBtn}
            >
              {t('start_update')}
            </Button>
          )}
          {/* an up-to-date dictionary (or an offered update) demotes the
              add-only button but keeps re-import possible */}
          <Button
            type={isUpToDate || (fromHuggingFace && updateAvailable) ? 'default' : 'primary'}
            onClick={() => importDictionary()}
            disabled={!canStart || lockedByOther}
            className={styles.startBtn}
          >
            {status === ImportStatusE.error ? t('retry_importing') : t('start_importing')}
          </Button>
        </div>
      )}
      {updateSummary && status === ImportStatusE.success && (
        <Text type="success">
          {t('update_summary', {
            updated: updateSummary.updated,
            added: updateSummary.added,
            kept: updateSummary.kept,
          })}
        </Text>
      )}
      {lockedByOther && <Text type="warning">{t('import_locked')}</Text>}
      {inProgress && statusMessage && <Text italic>{statusMessage}</Text>}
      {status !== ImportStatusE.idle && (
        <Text type="secondary">
          {t('elapsed_time')}: {formatTime(elapsedSeconds)}
        </Text>
      )}
    </div>
  );
};
