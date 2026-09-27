# Operating an instance: backup, upgrade, dataset updates

What an operator needs to know on day two: what holds the state of an instance, what to back
up and when, what a code upgrade does to the database and how to roll it back, and how a
dictionary update differs from a code update. The upgrade itself, step by step:
[`upgrading.md`](./upgrading.md).

> [!NOTE]
> This page says _what_ to back up and _when_; the `pg_dump` / `pg_restore` commands, for the
> bundled database and for any other, are in [`database.md`](./database.md#backups).

## What holds state

The **database behind `DATABASE_URL`** is the only state of an instance:

- the dictionary — imported entries and every edit made in the admin UI; on an instance with
  several datasets ([`datasets.md`](./datasets.md)), every one of them, each in a schema of its
  own inside the same database;
- the registry of the datasets (`datasets`) with the terms of each, and which one is active;
- the `settings` table, including the version of the active dataset
  (`en_dataset_version`, shown by `GET /api/v1/meta`);
- the `migrations` table — which schema migrations have been applied — and the
  `dataset_migrations` of every dataset.

Both processes (server and frontend) are stateless: the only files the server writes are
temporary (under the system temp directory, while an import or export runs). A backup of the
database is a backup of the instance. Keep alongside it the things that are not data but are
needed to bring an instance back:

- the `.env` (or the process environment) — in particular `ADMIN_USERNAME` / `ADMIN_PASSWORD`,
  which are the only credentials; there is no user table;
- the folder named by `DICTIONARY_IMPORT_DIR`, if the instance imports datasets from a local
  folder ([`offline-import.md`](./offline-import.md)) — it is a source, not state, and can be
  re-created from the dataset.

Back it up on whatever schedule matches how often the dictionary is edited — a dictionary
imported once and never edited needs one backup, after the import; an edited one on a
schedule, with a cron recipe in [`database.md`](./database.md#scheduled-backups).

## External uptime check

The instance's own monitoring ([`observability.md`](./observability.md)) runs next to it and
goes down with the host. Something outside — an uptime service, a cron job on another machine,
the load balancer's health check — should poll the readiness probe and alert when it is not
`200`:

```
GET https://dict.example.com/api/ready       every 1–5 minutes, alert after 2 failures
```

`/api/ready` is the right probe for this: it turns `503` when the database is unreachable, an
import runs or fails, or a stop begins, and its body names the reason
([`deployment/README.md`](./deployment/README.md#probes)). `/api/health` only says the process
answers HTTP. Polling readiness also feeds the `VbhNotReady` alert rule of the overlay, which
watches the probe's own answers ([`observability.md`](./observability.md#alerts)). An
installation with the website adds its start page (`GET /en`, `200`) to the same check.

## Database backup vs dictionary export

The admin UI has _Export dictionary_ (`GET /api/en/dictionary/export`). It is not a backup:

|                    | Database backup (`pg_dump`)                           | Dictionary export (dataset)                                       |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Contains           | Everything: entries, edits, settings, ids, migrations | The dictionary content only, as NDJSON files + `manifest.json`    |
| Restores           | The instance exactly as it was                        | Nothing — importing it _merges_ into the current dictionary       |
| Ids and timestamps | Preserved                                             | Stripped; a new import assigns new ids                            |
| Made for           | Disaster recovery, rollback of an upgrade             | Sharing, versioning, moving content between instances, publishing |
| Format             | Postgres-specific, tied to the schema version         | Portable, diffable, independent of the database                   |

The export is taken from the **active dataset** and its manifest carries the terms of that
dataset; the database backup holds all of them.

Take the export when you want the _content_ — to publish it, diff it against the upstream
dataset, or seed another instance ([`offline-import.md`](./offline-import.md)). Take the
database backup when you want to be able to _go back_. The data terms of an export are in
[`DATA_LICENSE.md`](../DATA_LICENSE.md).

## Upgrading the code

> [!TIP]
> The step-by-step upgrade for each way of installing — the published images, a build from a
> checkout, a start without Docker — and the update notice of the admin UI are on their own
> page: [`upgrading.md`](./upgrading.md). This section is about what an upgrade does to the
> database and how to get back.

On start the server applies every pending migration shipped with its version, then serves
requests ([`database.md`](./database.md#the-schema-migrations)). Deploying is
therefore just: ship the new version and restart. Two consequences follow:

1. **The database becomes bound to the new version.** Once a migration has run, the previous
   version of the code no longer matches the schema and is not expected to work against it.
2. **A failed migration stops the server** deliberately (fail-fast; every pending migration of
   a start runs in one transaction, so a failure rolls the whole batch back) — the database is
   left as the previous version left it and the service is down until the problem is fixed or
   the backup is restored.

The procedure:

```bash
# 1. back up the database (pg_dump -Fc / a provider snapshot — database.md#backups)
# 2. see what the new version is about to apply (optional)
DATABASE_URL=... yarn workspace server migration:show
# 3. deploy: new code, yarn install --immutable, rebuild both apps, restart the processes
#    (docs/deployment/README.md) — pending migrations run on the server's start
# 4. confirm: GET /api/ready answers 200 (migrations ran, the database answers),
#    migration:show lists nothing pending, GET /api/health returns the new version
```

> [!CAUTION]
> **Rollback = restore the pre-upgrade backup and start the previous version.** That is the only
> supported way back. `migration:revert` exists for development; migrations are not guaranteed to
> be reversible (some drop or rewrite data), and a revert does not undo the edits made in the
> admin UI after the upgrade — which is why the backup is taken _right before_ the restart.

Upgrades that do not ship a migration (`migration:show` lists nothing pending) do not touch the
schema; rolling those back is just starting the previous build again.

> [!IMPORTANT]
> The frontend has no state of its own, but `NEXT_PUBLIC_*` values are inlined at build time — a
> frontend rebuild is part of every upgrade ([`deployment/README.md`](./deployment/README.md)).

## Dataset updates vs code updates

The dictionary content and the code are versioned independently: the code has releases, the
dataset has its own version (`manifest.json`, stored after import as `en_dataset_version`,
exposed by `GET /api/v1/meta` as `dataset_version`). Upgrading the code never changes the
dictionary; loading a newer dataset never changes the code.

Both are about the project's own dataset, the `default` one. A dataset converted from a public
source is updated by converting the newer dump and importing it — into the same dataset in
update mode, or into a new one that is activated when it is ready and the old one deleted
([`datasets.md`](./datasets.md)).

The import page shows both versions side by side — _Your version_ (`en_dataset_version` from
the settings) against _Latest version_ (the published `manifest.json`) — and offers two ways to
load a newer dataset:

- **Update the dictionary** — the one-click update, shown when the versions differ. It runs the
  import in **update mode** (`POST /api/en/dictionary/import` with `update: true`): every entry
  already in the dictionary is **replaced** with the new dataset content — except the entries
  you edited, which are **kept** (see the flag below). Entries missing in the instance are
  added; entries that disappeared from the dataset are **not** deleted. The completed import
  reports the split — updated / added / kept with your edits — in the UI, the server log and
  the _History_ page.
- **Start importing** — the historical add-only merge: entries missing in the instance are
  added, entries that already exist (same word, part of speech and form) are **skipped**,
  whatever the dataset says about them. This is what the first load, uploads and the automatic
  import on first start (`DICTIONARY_AUTO_IMPORT`) do.

### The user-modified flag

Every admin mutation of an entry's content — editing the word, its forms, meanings,
translations or links — flags the whole entry as **modified by you** (`user_modified` on
`en_entries`; an edit to a form flags its base word's entry, because a base word and its forms
are replaced as one unit). The flag is what update mode consults: flagged entries keep your
content, everything else follows the dataset. It is visible:

- on the word card in the admin UI (the _Modified by you_ tag) and in every word answer of the
  admin API (`user_modified` on `GET /api/en/{id}`; the public `/api/v1` projection does not
  carry editorial state);
- in the _History_ page — the edit that set it is an audit row like any other.

_Return to the official version_ on the word card (or `PATCH
/api/en/reset-user-modified/:word`) clears the flag: your content stays until the next update
replaces the entry with the dataset again. Two caveats:

- deleting an **entire** entry leaves nothing to carry the flag, so the next update re-adds the
  entry from the dataset; deleting only a part of it (one part of speech, a form, a meaning)
  flags the entry and survives updates;
- a word the admin created from scratch is flagged from the start — updates never touch it.

## Sizing

The full English dictionary takes about **0.9 GB** in Postgres, tables and indexes together; a
compressed `pg_dump -Fc` of it is about 150 MB. Plan for the database, the working space Postgres
needs for index builds during migrations, and the backups you keep. The breakdown by table and the
row counts: [`database.md`](./database.md#size).

SQLite is development-only — nothing to back up or upgrade, and the server refuses it with
`NODE_ENV=production` ([`database.md`](./database.md#sqlite-for-development)).
