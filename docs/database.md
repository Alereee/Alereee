# Database

Everything about the database an instance runs on: which one, how to connect it, what the
server does to its schema, how to back it up, how big it gets.

## PostgreSQL in production, SQLite for development

|                              | PostgreSQL                                                                                                                                                             | SQLite                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| When                         | Every real instance; the only database `NODE_ENV=production` accepts                                                                                                   | Development and tests only                                                                      |
| Version                      | 14 or newer; the bundled one is `postgres:17-alpine`                                                                                                                   | better-sqlite3, bundled with the server                                                         |
| Extension                    | `pg_trgm` (the typo-tolerant search); the server creates it on the first start, so the database user needs `CREATE` on the database — every managed Postgres allows it | —                                                                                               |
| Schema                       | Migrations, applied by the server on every start                                                                                                                       | Recreated from the entities on every start (`synchronize`)                                      |
| Speed on the full dictionary | 5–30 ms per read                                                                                                                                                       | ~1 s per search: no trigram index, no byte-order index                                          |
| Choose it with               | `DATABASE_URL=postgres://user:password@host:5432/vocab_bloom`                                                                                                          | no `DATABASE_URL` (a `dev.sqlite` at the repository root), or `DATABASE_URL=sqlite:./my.sqlite` |

## Two ways to run Postgres

The server never starts a database of its own: it connects to whatever `DATABASE_URL` names.
So the first decision of an install is where that Postgres comes from. There are two answers,
and the whole difference between them is one line in `.env`.

|                        | Inside `docker compose` (the bundled database)                                         | A separate database                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| What it is             | A `postgres:17-alpine` container started by the same `docker compose up` as the server | A Postgres you run yourself: managed (RDS, Cloud SQL, Neon, …), on the host, on another VM |
| How to choose it       | `COMPOSE_PROFILES=db` in `.env` — the template's default                               | remove the profile (`COMPOSE_PROFILES=`), set `DATABASE_URL` to your database              |
| Where the data lives   | the named volume `postgres-data` on the Docker host                                    | wherever that database keeps it                                                            |
| Backups, upgrades, RAM | yours, with `docker compose exec postgres pg_dump …` ([Backups](#backups))             | the provider's, or yours on that host                                                      |
| Good for               | one server, quick start, a home or team instance, no other database around             | an existing Postgres, a company setup with managed backups, several apps on one database   |

### 1. Inside docker compose (the default)

`docker-compose.yml` ships a Postgres service, `postgres:17-alpine`, behind the compose
profile `db`. With `COMPOSE_PROFILES=db` in `.env` (the template's default) `docker compose up`
starts three containers — `postgres`, `server`, `frontend` — and the server gets a
`DATABASE_URL` assembled from the same `.env`:
`postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB`. The host is
`postgres` because that is the service's name on the compose network. Leave `DATABASE_URL`
empty and you never write that URL yourself; a `DATABASE_URL` in `.env` wins over the bundled
database, which is how a development `.env` with a `localhost` URL breaks the stack. The
server does not wait for the database: it retries the connection for a minute, and the
bundled one is ready long before that.

- The data lives in the named Docker volume `postgres-data`. `docker compose down`, a reboot,
  an image upgrade — all keep it. Only `docker compose down -v` deletes it.
- The database is not published on the host: nothing outside the compose network can reach
  port 5432. From the host, go through compose (the [backup commands](#backups) below work
  the same way):

  ```bash
  docker compose exec postgres psql -U vocab vocab_bloom   # a psql session
  docker compose down                                       # stops everything, keeps the data
  docker compose down -v                                    # …and deletes the volume: the dictionary is gone
  ```

- The user, password and database name are the `POSTGRES_*` variables. Change them before
  the first start — the image creates the database from them once, on an empty volume, and
  ignores them afterwards.
- Picking a newer Postgres major later means a dump and a restore, not just a new image tag:
  the data directory format changes between majors.

Choose this when the instance is one machine and nobody wants to run a database: a VPS, a
home server, a trial. It is a real Postgres with the right `shm_size`, the extension and the
indexes; the only thing you take on is the backup.

### 2. A Postgres of your own

A managed instance (RDS, Cloud SQL, Neon, Supabase, …), a Postgres already running on the
host or on another server, a database shared with other applications. Drop the profile and
name the database:

```dotenv
# .env: no bundled database, the server connects to this one
# COMPOSE_PROFILES=db
DATABASE_URL=postgres://vocab:secret@db.example.com:5432/vocab_bloom
```

- The database must exist and be empty (or hold this project's schema). The server creates
  the tables through its migrations and the `pg_trgm` extension on the first start, so the
  user in the URL needs `CREATE` on the database; every managed Postgres grants it to the
  owner.
- The server retries the connection for a minute at start and then exits (compose restarts
  it), so a database that boots slower than the application is fine.
- Backups, upgrades and monitoring are the provider's tools, or yours; the commands below
  still apply to any Postgres you can reach with `psql`.

> [!IMPORTANT]
> A Postgres on the Docker host is `host.docker.internal` from inside a container, not `localhost`
> — inside the container `localhost` is the container itself. This is the most common reason a
> first `docker compose up` cannot reach the database.

Choose this when the database should outlive the machine, when several replicas of the
server share one database, or when there is already a Postgres you operate anyway. The native
start (`yarn start`, systemd, PM2) always works this way: there is no compose to bundle a
database, so `DATABASE_URL` is required.

### Switching between the two

Both hold exactly the same schema, so a move is a [dump and a restore](#backups): dump from
the current database, restore into the new one, change `DATABASE_URL` (and the profile) in
`.env`, `docker compose up -d`. The server finds its migrations already applied and starts.

## Connecting

**`DATABASE_URL` itself.** The scheme picks the driver: `postgres://` or `postgresql://` for
Postgres, `sqlite:<path>` for SQLite in development; anything else stops the server with a
one-line error. `NODE_ENV=production` refuses SQLite.

**Pool.** `DB_POOL_SIZE` connections at most (10 by default), idle ones closed after
`DB_POOL_IDLE_TIMEOUT` seconds (10). On a managed instance keep `replicas × DB_POOL_SIZE` under
its connection limit, with a few to spare for `psql` and the migrations.

> [!WARNING]
> **Shared memory.** The full dictionary makes Postgres run parallel hash joins and sorts, whose
> working memory lives in `/dev/shm`. Docker caps it at 64 MB by default and the query then fails
> with `could not resize shared memory segment … No space left on device` (SQLSTATE 53100). The
> bundled service sets `shm_size: 256m`; a Postgres container of your own needs `--shm-size=256m`
> too, or `dynamic_shared_memory_type = mmap` in `postgresql.conf`.

## The schema: migrations

The server owns the schema. On every start it applies the migrations its version ships and did
not run yet — in one transaction, so a failed migration rolls the whole batch back and the
server exits with the error instead of serving a half-changed schema. Nothing to run by hand
for an install or an upgrade.

The commands exist for the cases in between (all need `DATABASE_URL`):

```bash
yarn workspace server migration:show      # what is applied, what is pending
yarn workspace server migration:run       # apply the pending ones now, without starting the server
yarn workspace server migration:revert    # undo the last one — development only
```

> [!TIP]
> From the Docker image:
> `docker compose run --rm server node ../../node_modules/typeorm/cli.js migration:run -d dist/src/db/data-source.js`.

> [!NOTE]
> A database created by an old version through `synchronize`, before migrations existed, is
> adopted with `migration:run --fake`: the baseline is marked as applied without executing it.

Writing a migration, the troubleshooting of a failed one and the full workflow are in
[`migrations.md`](./migrations.md).

## Datasets: a schema each

An instance can hold several dictionaries, one of them served ([`datasets.md`](./datasets.md)).
In the database a dataset is a **schema** — a namespace of tables inside the one database:

| Schema      | What lives there                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public`    | the shared tables (`settings`, `datasets`, `audit_log`, `migrations`), the enum types, the `pg_trgm` extension — and the dictionary tables of the `default` dataset, where they always were                      |
| `ds_<name>` | the dictionary tables of the dataset `<name>` with their indexes, the history of its edits (`en_changes`), its moderation queue (`suggestions`) and its own journal of applied migrations (`dataset_migrations`) |

- **The tables are the same in every schema**, so are the queries: the connection of the server
  carries `search_path = ds_<name>, public`, and `en_words` resolves to the table of the active
  dataset. External tools that read `public.en_words` keep reading the `default` dataset.
- **A switch re-opens the pool** with another `search_path`. It waits for the requests under
  way to finish (five seconds at most) and the requests that arrive meanwhile wait for it — a
  few tens of milliseconds, nobody is answered with an error.
- **An import into another dataset** uses a pool of its own, four connections at most, for as
  long as it runs: count them in when `DB_POOL_SIZE` is close to the connection limit.
- **A dataset is deleted with `DROP SCHEMA … CASCADE`**: instant, whatever its size, and the
  space is returned at once.
- **`pg_dump` of the database takes every schema**: a backup holds all the datasets and the
  registry, a restore brings back the instance with the same one active. One dataset alone:
  `pg_dump -Fc -n ds_<name>` — the dump holds the tables, the row in `datasets` does not travel
  with it.
- **Size**: a dataset takes what its rows take, there is no shared part. Open English WordNet
  2025 is 170 MB with its indexes, the English Wiktionary 1.4 GB
  ([`datasets.md`](./datasets.md#public-sources)).

> [!WARNING]
> **Connection poolers.** The `search_path` travels as a startup option of the connection
> (`options=-c search_path=…`). A pooler between the server and Postgres has to pass it
> through: one that drops it (PgBouncer with `options` in `ignore_startup_parameters`) would
> leave the server on `public`, serving the wrong dataset. The server checks `current_schema()`
> at start and after every switch and refuses to go on from the wrong schema. Connect the
> server to Postgres directly, or make sure the pooler hands the option on. With the `default`
> dataset active no option is sent and any pooler works as before.

## Backups

The database is the whole state of an instance: every dataset with the edits made in the admin
panel, the registry of the datasets and which one is active, the applied migrations. Back it up with the Postgres
tools, not with the dictionary export (the export carries the content only and cannot restore
an instance — [`operations.md`](./operations.md#database-backup-vs-dictionary-export)).

```bash
# the bundled database, from the host
docker compose exec postgres pg_dump -U vocab -Fc vocab_bloom > vocab-bloom-$(date +%F).dump

# restore into an empty database (stop the server first, start it after)
docker compose stop server
docker compose exec -T postgres pg_restore -U vocab -d vocab_bloom --clean --if-exists < vocab-bloom-2026-09-16.dump
docker compose start server

# any Postgres
pg_dump -Fc "$DATABASE_URL" > vocab-bloom.dump
pg_restore -d "$DATABASE_URL" --clean --if-exists vocab-bloom.dump
```

> [!IMPORTANT]
> When: right before an upgrade (the new version may migrate the schema, and the backup is the
> only way back), and on whatever schedule matches how often the dictionary is edited — a
> dictionary loaded once and never edited needs one backup, after the load.

### Scheduled backups

A dictionary that is edited deserves a nightly dump. For the bundled Postgres, a cron entry on
the host that keeps the last 14 dumps (the compose project lives in `/opt/vocab-bloom-hub`):

```cron
# /etc/cron.d/vocab-bloom-hub-backup — 03:10 every night, as the user who runs compose
10 3 * * * deploy cd /opt/vocab-bloom-hub && docker compose exec -T postgres pg_dump -U vocab -Fc vocab_bloom > /var/backups/vocab-bloom-hub/vocab-bloom-$(date +\%F).dump && find /var/backups/vocab-bloom-hub -name 'vocab-bloom-*.dump' -mtime +14 -delete
```

For a Postgres of your own replace the `docker compose exec -T postgres pg_dump -U vocab …` with
`pg_dump -Fc "$DATABASE_URL"`. Whatever the schedule, two things make it a backup rather than a
file: the dumps leave the host (a copy to object storage or another machine — `rclone`,
`restic`, the provider's snapshots), and a restore was tried once, into an empty database, the
way the commands above show. A dump of the full dictionary is a few hundred megabytes
([Size](#size)).

## Size

The full English dictionary with translations into five languages:

|                    |                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Tables and indexes | about 0.9 GB — translations 550 MB, entries, words and senses 280 MB, synonym / antonym links 70 MB                       |
| `pg_dump -Fc`      | about 150 MB                                                                                                              |
| Rows               | 298 000 entries, 327 000 word rows with the forms, 161 000 senses, 807 000 sense translations, 576 000 short translations |

Plan for the working space of an index build during a migration on top of that, and for the
backups you keep. The indexes behind the hot reads and their measured latencies are in
[`performance.md`](./performance.md).

## SQLite for development

Without `DATABASE_URL` the server creates `dev.sqlite` at the repository root and keeps its
schema in sync with the entities by itself — change an entity, restart, done, no migration
until the change is ready for Postgres. The browser tests run on an isolated
`sqlite:./e2e.sqlite`, the server e2e suites on `sqlite::memory:`. Nothing of it is meant to be
backed up, upgraded or put in production: the server refuses to start on SQLite with
`NODE_ENV=production`.
