import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { checkIsPostgres } from '../../configuration';
import {
  ACTIVE_DATASET_SETTINGS_FIELD,
  DEFAULT_DATASET_NAME,
  DEFAULT_DATASET_SCHEMA,
} from '../../core/constants/datasets';
import { DATASET_MIGRATIONS_TABLE, datasetMigrations } from './dataset-migrations';
import { migrations } from './migrations';

// The database side of the datasets (issue #527), below Nest: what has to
// happen before the application's connection exists — the shared migrations
// in `public`, the dataset migrations in every dataset schema, the choice of
// the active one — and the few statements that create and drop a schema.

const logger = new Logger('Datasets');

// the database may still be starting when the server does (compose brings
// both up at once): the same patience as the application's own connection
const CONNECT_ATTEMPTS = 20;
const CONNECT_DELAY_MS = 3000;

/** A schema name reaches SQL and the connection options unquoted: only what cannot break out */
const SAFE_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;

export const assertSafeSchema = (schema: string): string => {
  if (!SAFE_SCHEMA.test(schema)) throw new Error(`"${schema}" is not a schema name a dataset may have`);
  return schema;
};

/** `search_path` of a connection that works on a dataset: its schema first, the shared tables behind it */
export const searchPathOf = (schema: string): string =>
  assertSafeSchema(schema) === DEFAULT_DATASET_SCHEMA
    ? DEFAULT_DATASET_SCHEMA
    : `${schema},${DEFAULT_DATASET_SCHEMA}`;

/**
 * The pg startup option that puts a connection on a dataset. It travels in
 * the startup packet, so every connection of the pool has it from its first
 * statement on; a pooler that drops startup options (PgBouncer with
 * `ignore_startup_parameters`) would leave the connection on `public` —
 * `assertOnSchema` catches that at start.
 */
export const searchPathExtra = (schema: string): { options: string } | Record<string, never> =>
  assertSafeSchema(schema) === DEFAULT_DATASET_SCHEMA
    ? {}
    : { options: `-c search_path=${searchPathOf(schema)}` };

const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
};

/** A short-lived connection for the work below; never the application's own */
const withConnection = async <T>(
  options: { schema?: string; migrations?: DataSource['options']['migrations']; migrationsTableName?: string },
  work: (dataSource: DataSource) => Promise<T>,
): Promise<T> => {
  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl(),
    entities: [],
    extra: { max: 2, ...searchPathExtra(options.schema ?? DEFAULT_DATASET_SCHEMA) },
    ...(options.migrations ? { migrations: options.migrations } : {}),
    ...(options.migrationsTableName ? { migrationsTableName: options.migrationsTableName } : {}),
  });
  await dataSource.initialize();
  try {
    return await work(dataSource);
  } finally {
    await dataSource.destroy();
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The migrations of one dataset schema; returns the names of the ones that ran */
export const runDatasetMigrations = async (schema: string): Promise<string[]> =>
  withConnection(
    { schema, migrations: datasetMigrations, migrationsTableName: DATASET_MIGRATIONS_TABLE },
    async (dataSource) => (await dataSource.runMigrations()).map((migration) => migration.name),
  );

/** A new, empty dataset schema with the dictionary tables in it */
export const createDatasetSchema = async (schema: string): Promise<void> => {
  assertSafeSchema(schema);
  await withConnection({}, (dataSource) => dataSource.query(`CREATE SCHEMA "${schema}"`));
  try {
    await runDatasetMigrations(schema);
  } catch (error) {
    // half a schema is worse than none: the name stays free for another attempt
    await dropDatasetSchema(schema).catch(() => undefined);
    throw error;
  }
};

export const dropDatasetSchema = async (schema: string): Promise<void> => {
  if (assertSafeSchema(schema) === DEFAULT_DATASET_SCHEMA) {
    throw new Error('the default dataset lives in "public" and is never dropped');
  }
  await withConnection({}, (dataSource) => dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
};

type RegistryRowT = { name: string; schema: string };

/**
 * Brings the database to what the code expects and answers the schema of the
 * active dataset — the one the application's connection is opened on. Runs
 * before that connection exists (AppModule's TypeORM factory): the shared
 * migrations in `public`, then the dataset migrations in every registered
 * schema, so the datasets never drift apart structurally. SQLite has no
 * schemas and no migrations: one dataset, `synchronize` builds its tables.
 */
export const prepareDatabase = async (): Promise<string> => {
  if (!checkIsPostgres()) return DEFAULT_DATASET_SCHEMA;

  let registry: RegistryRowT[] = [];
  let activeName: string = DEFAULT_DATASET_NAME;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await withConnection({ migrations }, async (dataSource) => {
        const ran = await dataSource.runMigrations();
        if (ran.length) logger.log(`Shared migrations applied: ${ran.map((m) => m.name).join(', ')}`);
        const [{ exists }] = (await dataSource.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'datasets') AS "exists"`,
        )) as Array<{ exists: boolean }>;
        if (!exists) {
          throw new DatasetsRegistryMissingError();
        }
        registry = (await dataSource.query(
          `SELECT "name", "schema" FROM "public"."datasets" ORDER BY "id"`,
        )) as RegistryRowT[];
        const setting = (await dataSource.query(`SELECT "value" FROM "public"."settings" WHERE "field" = $1`, [
          ACTIVE_DATASET_SETTINGS_FIELD,
        ])) as Array<{ value: string }>;
        activeName = setting[0]?.value ?? DEFAULT_DATASET_NAME;
      });
      break;
    } catch (error) {
      if (error instanceof DatasetsRegistryMissingError || attempt >= CONNECT_ATTEMPTS) throw error;
      logger.warn(
        `Database not ready for the migrations (attempt ${attempt} of ${CONNECT_ATTEMPTS}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await sleep(CONNECT_DELAY_MS);
    }
  }

  for (const { name, schema } of registry) {
    const ran = await runDatasetMigrations(schema);
    if (ran.length) logger.log(`Dataset "${name}" (${schema}): migrations applied: ${ran.join(', ')}`);
  }

  const active = registry.find((row) => row.name === activeName);
  if (!active) {
    logger.warn(`The active dataset "${activeName}" is not registered; serving "${DEFAULT_DATASET_NAME}"`);
    return DEFAULT_DATASET_SCHEMA;
  }
  if (active.schema !== DEFAULT_DATASET_SCHEMA)
    logger.log(`Active dataset: "${active.name}" (${active.schema})`);
  return active.schema;
};

/**
 * The shared migrations were recorded without being run (`migration:run
 * --fake` adopts a database built by the old `synchronize`): the registry
 * of datasets is missing and nothing below can work without it
 */
export class DatasetsRegistryMissingError extends Error {
  constructor() {
    super(
      'The "datasets" table is missing although every shared migration is recorded as applied — ' +
        'a `migration:run --fake` skipped AddDatasets. Revert its row in "migrations" and start again (docs/migrations.md).',
    );
    this.name = 'DatasetsRegistryMissingError';
  }
}
