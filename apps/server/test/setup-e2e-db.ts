import { Client } from 'pg';
import { DataSource } from 'typeorm';

// Companion of setup-e2e.ts for the Postgres mode (issue #400), registered in
// setupFilesAfterEnv so it can hook beforeAll. Before every spec file it
// creates this worker's database on first use and drops its schema, so each
// file starts empty and the app rebuilds the real production schema through
// the migrations (migrationsRun in typeorm-options). Every later boot of an
// application inside the file then starts from empty tables too — on sqlite
// each DataSource is a fresh :memory: database, and the specs are written for
// that: the same isolation on both drivers, or a spec passes on one and fails
// on the other.
const adminUrl = process.env.E2E_DATABASE_URL;

if (adminUrl?.startsWith('postgres')) {
  // app.init() now runs the whole migration set per file — far past the 5s default
  jest.setTimeout(120_000);

  // every table but the migration journals, emptied right after the data
  // source (and the migrations it runs) came up. `dataset_migrations` is the
  // journal of the dictionary tables of `public` (issue #527): emptied, the
  // next boot would build those tables a second time
  const truncateAll = async (dataSource: DataSource): Promise<void> => {
    const tables = (await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('migrations', 'dataset_migrations')`,
    )) as Array<{ tablename: string }>;
    if (tables.length === 0) return;
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  };

  // Only the application's connection starts a boot from empty tables, and
  // only once: the short-lived connections that run the migrations ahead of
  // it carry no entities, the connection an import opens on another dataset
  // carries no migrations, and a switch of the active dataset re-initializes
  // the same DataSource — none may wipe what the boot has built (issue #527)
  const emptied = new WeakSet<DataSource>();
  const initialize = DataSource.prototype.initialize;
  const some = (list: unknown): boolean => (Array.isArray(list) ? list.length > 0 : Boolean(list));
  DataSource.prototype.initialize = async function (this: DataSource) {
    const dataSource = await initialize.call(this);
    const isApplication = some(dataSource.options.entities) && some(dataSource.options.migrations);
    if (dataSource.options.type === 'postgres' && isApplication && !emptied.has(dataSource)) {
      emptied.add(dataSource);
      await truncateAll(dataSource);
    }
    return dataSource;
  };

  beforeAll(async () => {
    const workerDb = new URL(process.env.DATABASE_URL as string).pathname.replace(/^\//, '');

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${workerDb}"`);
    } catch (error) {
      // 42P04: the database already exists (a previous file of this worker made it)
      if ((error as { code?: string }).code !== '42P04') throw error;
    } finally {
      await admin.end();
    }

    const worker = new Client({ connectionString: process.env.DATABASE_URL });
    await worker.connect();
    try {
      await worker.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      // the schemas of the datasets a previous file created (issue #527)
      const datasets = await worker.query<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ds\\_%'`,
      );
      for (const { nspname } of datasets.rows) await worker.query(`DROP SCHEMA "${nspname}" CASCADE`);
    } finally {
      await worker.end();
    }
  });
}
