# Database migrations

TypeORM migrations manage the **Postgres** schema. The SQLite dev fallback does not use
migrations at all — it stays on `synchronize`, so entity changes reshape `dev.sqlite`
automatically.

| Mode                                           | Schema management                                 | `synchronize` |
| ---------------------------------------------- | ------------------------------------------------- | ------------- |
| Postgres (`DATABASE_URL` set)                  | Migrations, applied automatically on server start | off           |
| SQLite (no `DATABASE_URL`, or a `sqlite:` one) | Auto-DDL from entities, dev only                  | on            |

All the relevant code lives in `apps/server/src/db/`:

- `typeorm-options.ts` — the runtime TypeORM configuration used by `AppModule`;
- `data-source.ts` — a CLI-only DataSource for the `typeorm` commands (requires `DATABASE_URL`);
- `migrations/` — the **shared** migrations plus `index.ts`, the **explicit list** of them;
- `dataset-migrations/` — the migrations of the dictionary tables, run in every dataset schema,
  with a list of their own ([below](#shared-and-dataset-migrations));
- `datasets.ts` — runs both lists before the server's connection exists.

## Commands

All commands run in the `server` workspace and need `DATABASE_URL` (they refuse to start
without it — migrations target Postgres only):

```bash
DATABASE_URL=postgres://user:pass@host:5432/db yarn workspace server migration:show      # list applied/pending
DATABASE_URL=... yarn workspace server migration:run                                     # apply pending
DATABASE_URL=... yarn workspace server migration:revert                                  # roll back the last one
DATABASE_URL=... yarn workspace server migration:generate src/db/migrations/MyChange     # diff entities vs DB
yarn workspace server migration:create src/db/migrations/MyDataFix                       # empty migration skeleton
DATABASE_URL=... yarn workspace server db:reset                                          # DEV ONLY: wipe schema, re-run all migrations
```

> [!CAUTION]
> `db:reset` drops every table and type in the database and replays all migrations from
> scratch — a factory reset for a broken or half-migrated **development** database. Never point
> it at a database whose data you care about.

> [!TIP]
> `DATABASE_URL` may also come from the root `.env` — the CLI DataSource loads it the same way
> the server does. A variable already set in the shell wins over the `.env` value.

## Shared and dataset migrations

An instance holds several datasets, each in a Postgres schema of its own
([`database.md`](./database.md#datasets-a-schema-each)). The dictionary tables exist once per
dataset, so their migrations run once per dataset:

|                  | Shared                                                          | Dataset                                                                                           |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Folder           | `src/db/migrations/`                                            | `src/db/dataset-migrations/`                                                                      |
| Tables           | `settings`, `datasets`, `audit_log`; the enum types; extensions | `en_entries`, `en_words`, `en_meanings`, the translations, the links, `en_changes`, `suggestions` |
| Runs in          | `public`, once                                                  | every registered schema — `public` for the `default` dataset, every `ds_<name>`                   |
| Journal          | `public.migrations`                                             | `dataset_migrations` of each schema                                                               |
| Names the schema | yes: `"public"."settings"`                                      | **never**: `"en_words"` — the `search_path` of the connection decides where it lands              |
| Runs             | at server start, first                                          | at server start, after the shared ones; and when a dataset is created                             |

Everything up to `AddDatasets` is history: those migrations built the dictionary tables in
`public` before datasets existed and stay in the shared list. `DatasetBaseline` builds the same
tables in a new schema and is recorded as applied in `public` by `AddDatasets`. **From here on a
change to a dictionary table is a dataset migration**; `test:postgres` compares the structure of
a new schema with `public` (columns, indexes, foreign keys) and fails when the two lists drift
apart.

The first dataset migrations after the baseline are the ones of the history of edits
([`datasets.md`](./datasets.md#editing-a-dataset-the-history-of-edits)): `AddChanges` creates
`en_changes` in every schema, empty; `AddSuggestionAuthor` adds the name a reader asked to be
credited by to `suggestions`; `ChangesCarryValues` makes the values of an edit mandatory and
removes the rows without them that the builds before it wrote. `part_of_speech` of `en_changes` is text, not the enum of `en_words`: an enum
type lives in `public` and is shared by every schema, a column of it would tie a dataset
migration to a shared one.

Reverting `AddDatasets` (`migration:revert` while it is the newest shared migration) takes the
registry away and leaves the journal of the dataset migrations of `public` with the rows of the
migrations that ran since: what they built in `public` is still there, and running the
migration again finds them applied.

Writing a dataset migration:

1. Edit the entity and generate the migration as usual — the generator diffs against `public`:

   ```bash
   DATABASE_URL=... yarn workspace server migration:generate src/db/dataset-migrations/AddFrequencyRank
   ```

2. Remove every `"public".` in front of a **table or an index** in the generated SQL — the
   generator leaves the tables unqualified and writes the schema into `DROP INDEX
"public"."IDX_…"`. A statement that names `public` would change the `default` dataset again
   and again and never the others.
3. **Enum types are shared.** A new enum type or a new value of one goes into a shared migration
   (`CREATE TYPE "public"."…"`, `ALTER TYPE "public"."…" ADD VALUE`), which runs before the
   dataset migrations; the dataset migration only uses the type, by its qualified name.
4. Register the class in `src/db/dataset-migrations/index.ts`.
5. Run `yarn workspace server test:postgres`.

The `migration:*` commands work on the shared list and on `public`. The dataset migrations have
no command of their own: they are applied by the server at start (the log names every schema
and what ran there), and that is also the way to apply them by hand — start the server.

> [!CAUTION]
> `db:reset` drops `public` only. The schemas of the datasets stay behind without a registry
> that knows them; drop them by hand (`DROP SCHEMA ds_<name> CASCADE`) before creating a dataset
> of the same name.

## Changing the schema: the workflow

1. Edit the entity (add a column, index, table, …).
2. Generate a migration against a Postgres database that has the **current** (pre-change)
   schema:

   ```bash
   DATABASE_URL=... yarn workspace server migration:generate src/db/migrations/AddFrequencyRank
   ```

   TypeORM diffs the entities against that database and writes
   `src/db/migrations/<timestamp>-AddFrequencyRank.ts` with `up()`/`down()`.

3. **Register the class in `src/db/migrations/index.ts`** — both the CLI and the running
   server read this explicit array (an explicit list resolves identically from ts-node and
   from the compiled `dist`, unlike path globs). A generated migration that is not listed
   there will never run.
4. Review the generated SQL, run `yarn format`, and commit the migration file together with
   the entity change in the same PR.

No local Postgres? Spin up a throwaway one, apply the already-committed migrations to bring
it to the current schema, then generate:

```bash
docker run -d --rm --name vbh-pg -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=vbh -p 55432:5432 postgres:17-alpine
export DATABASE_URL=postgres://postgres:pg@localhost:55432/vbh
yarn workspace server migration:run
# ...edit the entity...
yarn workspace server migration:generate src/db/migrations/MyChange
docker stop vbh-pg
```

### Extensions

`AddEntryWordTrigramIndex` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` (trigram search).
`pg_trgm` ships with every Postgres distribution and is a _trusted_ extension since Postgres 13, so the database owner can create it without superuser rights; managed
services (RDS, Cloud SQL, Supabase, Neon, …) allow it too.

> [!TIP]
> If the migration fails with a permission error, create the extension once as a superuser and
> rerun `migration:run`.

### Hand-written migrations

`migration:generate` only diffs the schema. Write the migration yourself (start from
`migration:create`) when you need:

- **data backfills** — e.g. adding a `NOT NULL` column: add it as nullable, `UPDATE` existing
  rows, then set `NOT NULL`;
- **renames** — the generator sees a rename as drop + create, which loses data; write
  `ALTER TABLE ... RENAME COLUMN ...` manually;
- any other data transformation.

Keep `down()` a real inverse of `up()` — `migration:revert` executes it.

## How migrations run on deployment

On every start on Postgres, before its own connection is opened, the server
(`prepareDatabase` in `src/db/datasets.ts`):

1. reads the `migrations` table to see what has already been applied;
2. executes every pending shared migration in order inside **one transaction** (TypeORM's
   default `migrationsTransactionMode: "all"`) and records each;
3. does the same with the dataset migrations in every schema the registry names, a transaction
   per schema;
4. opens its connection on the schema of the active dataset and only then lets Nest accept
   requests.

A failed migration rolls that transaction back — every migration of that start with it, so the
database stays where the previous version left it — and **the server does not start**: better a
service that is down than one running against a schema its code does not match. A start with no
pending migrations is effectively instant. The operator's side — what an upgrade does to the
database, backups, and why the rollback is the pre-upgrade backup rather than `migration:revert`
— is in [`database.md`](./database.md#the-schema-migrations) and
[`operations.md`](./operations.md#upgrading-the-code).

## Adopting a pre-existing database

Databases created by the old `synchronize` mode already have all the tables, but no
`migrations` bookkeeping. Mark the baseline as applied **without executing it**, one time:

```bash
DATABASE_URL=... yarn workspace server migration:run --fake
```

After that, `migration:show` reports the baseline as applied and only future migrations will
actually execute.

> [!IMPORTANT]
> Skipping this step would make the first `migration:run` (or server start) fail on
> `CREATE TABLE` statements for tables that already exist.

> [!WARNING]
> `--fake` records **every** pending migration as applied, `AddDatasets` included — and the
> registry of the datasets it would have created is then missing. The server says so at start
> (`The "datasets" table is missing although every shared migration is recorded as applied`).
> Take its row back and start the server, which runs the migration for real:
>
> ```sql
> DELETE FROM "migrations" WHERE "name" = 'AddDatasets1789600000000';
> ```

## Troubleshooting

- **`DATABASE_URL must be set to run migration commands`** — the CLI DataSource refuses to run
  against SQLite. Export `DATABASE_URL` or put it in the root `.env`.
- **Baseline fails with `type "..." already exists`** — the database holds orphaned enum types
  (e.g. tables were dropped manually but Postgres types survived). The baseline drops such
  orphans itself (`DROP TYPE IF EXISTS` before every `CREATE TYPE`), so update to a version
  that includes it or run `db:reset` to start from a clean schema.
- **Baseline fails with `cannot drop type ... because other objects depend on it`** — the
  database has a real schema created by the old `synchronize` but no migrations bookkeeping;
  adopt it with `migration:run --fake` (see above) instead of executing the baseline.
- **`migration:generate` produces a huge diff or wants to drop everything** — the target
  database is not at the current schema. Run `migration:run` first (or point at the right
  database), then generate.
- **A new migration never runs** — check it is exported from `src/db/migrations/index.ts`
  (or `src/db/dataset-migrations/index.ts`); the array is the single source of truth for both
  the CLI and the server.
- **A dataset migration changed `default` and no other dataset**, or fails in the second schema
  with `already exists` — it names `public` in front of a table, or creates an enum type. See
  [Shared and dataset migrations](#shared-and-dataset-migrations).
- **`The database connection is on schema "public", the active dataset lives in "ds_…"`** — a
  connection pooler dropped the startup option that carries the `search_path`
  ([`database.md`](./database.md#datasets-a-schema-each)).
- **Driver mismatch errors** — entity column types are locked to a driver at import time
  (`checkIsPostgres`, see [environment.md](./environment.md#database-driver-locking)). The CLI
  DataSource loads `.env` before importing the entities for exactly this reason; always run
  migrations through the workspace scripts, not by invoking `typeorm` on ad-hoc files.
