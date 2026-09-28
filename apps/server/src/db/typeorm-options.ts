import * as path from 'path';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { checkIsPostgres, parseDatabaseUrl } from '../../configuration';
import { DICTIONARY_ENTITIES } from '../modules/EnModule/entities/dictionary-entities';
import { Settings } from '../modules/SettingsModule/entities/settings.entity';
import { AuditLog } from '../modules/AuditModule/entities/audit_log.entity';
import { Suggestion } from '../modules/SuggestionsModule/entities/suggestion.entity';
import { Dataset } from '../modules/DatasetsModule/entities/dataset.entity';
import { DEFAULT_DATASET_SCHEMA } from '../../core/constants/datasets';
import { getDbPoolConfig } from '../core/utils/db-pool';
import { migrations } from './migrations';
import { searchPathExtra } from './datasets';

export const DB_ENTITIES = [...DICTIONARY_ENTITIES, Settings, AuditLog, Suggestion, Dataset];

// checkIsPostgres() is locked at the first call (entity import), so the
// DataSource driver can never diverge from the entity column types.
// `activeSchema` is the schema of the active dataset (issue #527), answered
// by prepareDatabase(): the connection's search_path puts it first, so the
// entities and every query reach that dataset's tables without naming it
export const buildTypeOrmOptions = (activeSchema: string = DEFAULT_DATASET_SCHEMA): TypeOrmModuleOptions => {
  const base = {
    entities: DB_ENTITIES,
    autoLoadEntities: true,
  };

  if (checkIsPostgres()) {
    const pool = getDbPoolConfig();
    return {
      ...base,
      type: 'postgres',
      url: process.env.DATABASE_URL,
      // Pool limits for the pg driver (issue #333): DB_POOL_SIZE connections
      // at most, an idle client closed after DB_POOL_IDLE_TIMEOUT seconds.
      // Keep replicas × DB_POOL_SIZE under a managed instance's connection
      // limit (docs/environment.md)
      extra: {
        max: pool.max,
        idleTimeoutMillis: pool.idleTimeoutSeconds * 1000,
        ...searchPathExtra(activeSchema),
      },
      // Schema changes reach Postgres only through committed migrations;
      // auto-DDL against a real database is destructive (see issue #181)
      synchronize: false,
      migrations,
      // Pending migrations run on server start, before requests are accepted.
      // A failed migration keeps the server down instead of serving a schema
      // the code does not match. The server runs them in prepareDatabase(),
      // ahead of this connection — with the dataset migrations of every
      // schema — so on `public` the list is found applied, and a DataSource
      // built without that step (a script, a test) still gets them. On
      // another dataset the connection must not look for them: the journal
      // `migrations` is searched in the schema the connection is on, would
      // not be found there, and the whole list would run a second time.
      migrationsRun: activeSchema === DEFAULT_DATASET_SCHEMA,
      // The database may still be starting (docker compose brings both up at
      // once, an external instance may lag): keep trying for a minute before
      // giving up — the process manager restarts the server after that
      retryAttempts: 20,
      retryDelay: 3000,
    };
  }

  // An explicit sqlite:<path> DATABASE_URL (e.g. an isolated e2e database)
  // resolves relative to the server workspace cwd; :memory: is passed through
  const { sqlitePath } = parseDatabaseUrl(process.env.DATABASE_URL);
  const database = sqlitePath
    ? sqlitePath === ':memory:'
      ? sqlitePath
      : path.resolve(sqlitePath)
    : path.join(process.cwd(), '..', '..', 'dev.sqlite');

  return {
    ...base,
    type: 'better-sqlite3',
    database,
    // The SQLite mode is a development/test database (production requires a
    // postgres:// DATABASE_URL, see assertRequiredConfig): auto-DDL keeps it
    // in sync with the entities without migrations
    synchronize: true,
    prepareDatabase: (db) => {
      db.pragma('foreign_keys = ON');
    },
  };
};
