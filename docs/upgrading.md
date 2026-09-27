# Upgrading an instance

One version covers the whole project — the server, the admin UI and the website — so an upgrade
moves all of them together. How it is done depends on how the instance was installed; the rule
is the same everywhere: **back up, switch to the new version, restart, check**.

> [!IMPORTANT]
> The server applies the database migrations of the new version when it starts. After that the
> previous version is not expected to work against the database: the only supported way back is
> the backup taken before the upgrade ([`operations.md`](./operations.md#upgrading-the-code)).

## Update notice

When a newer stable release exists, the admin UI says so: a notice at the top of every admin
page names the available version and the running one, and the version in the footer carries the
same mark. That is all it does — **the instance never updates itself**. An upgrade runs database
migrations and binds the database to the new version, so it stays a deliberate step of the
operator, with a backup taken first — the rest of this page.

How it works:

- **Where the version comes from.** The server asks GitHub for the latest release of the project
  (`api.github.com/repos/Fristail27/vocab-bloom-hub/releases/latest`). GitHub's "latest" skips
  drafts and prereleases, and versions are compared as semantic versions: `1.10.0` is newer than
  `1.9.0`, and an instance on `1.1.0-beta.1` is not offered `1.0.0`.
- **How often.** A few times a day: the answer is kept for six hours, a failure for half an hour.
  No page view triggers a request of its own. When GitHub does not answer — no network, a rate
  limit — the result is "unknown" and nothing is shown; the server logs one warning per period.
- **Who sees it.** The signed-in admin only (`GET /api/settings/update-check` is behind the admin
  guard). Visitors of the website and of `/api/v1` learn nothing about the version's age.
- **What is sent.** One anonymous `GET` with a `User-Agent` of `vocab-bloom-hub/<version>`. Nothing
  about the instance or its data; GitHub sees the address the request comes from, as with any
  request.
- **Turning it off.** `UPDATE_CHECK=false` ([environment.md](./environment.md)): no outgoing
  request at all, no notice. The startup log names the setting.

Closing the notice hides it for that release in this browser; the next release shows it again.
The two links of the notice lead to the release notes on GitHub and to this page.

## Before you upgrade

1. **Read the release notes** — the [changelog](../CHANGELOG.md) entry of every version between
   yours and the new one. It names the migrations a release ships and the settings that changed
   (`v1.0.0`, for one, moved the default ports of docker compose).
2. **Know what you run.** The admin footer shows the version; so does `GET /api/health`
   (`{"status":"ok","version":"1.0.0"}`).
3. **Back up the database.** For the bundled Postgres of docker compose:

   ```bash
   docker compose exec -T postgres pg_dump -U vocab vocab_bloom | gzip > backup-$(date +%F).sql.gz
   ```

   `vocab` / `vocab_bloom` are `POSTGRES_USER` / `POSTGRES_DB` of `.env`. Any other database,
   and restoring: [`database.md`](./database.md#backups).

## Docker: the published images

The installation of the [quick start](./deployment/docker.md#quick-start): images pulled from
GHCR, the version picked by `VBH_TAG` in `.env`.

```bash
# .env: VBH_TAG=1.1.0
docker compose pull
docker compose up -d
```

`up -d` recreates only the services whose image changed; the database and its volume are not
touched. What `VBH_TAG` may hold:

| `VBH_TAG`    | What an upgrade is                                                            |
| ------------ | ----------------------------------------------------------------------------- |
| `1.1.0`      | Edit the line, then `pull` and `up -d` — nothing moves until you say so       |
| `1.1` or `1` | `pull` and `up -d` fetch the newest patch (or minor) release of that line     |
| `latest`     | The newest stable release, whatever its number — for trying things out        |
| `main`       | The development build of every merge; may carry migrations of unreleased code |

> [!NOTE]
> With the observability overlay, or any second compose file, pass the same `-f` files to `pull`
> and `up -d` as at the first start — or name them once in `.env`:
> `COMPOSE_FILE=docker-compose.yml:docker-compose.observability.yml`
> ([`deployment/docker.md`](./deployment/docker.md#everything-together)).

## Docker: built from a checkout

An instance built on the server with `docker-compose.build.yml` — the way to run the website
under a hostname of your own ([`deployment/docker.md`](./deployment/docker.md#the-website)).

```bash
git pull --ff-only                 # or: git fetch --tags && git checkout v1.1.0
docker compose -f docker-compose.yml -f docker-compose.build.yml build
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d
docker image prune -f              # the images of the previous build
```

The old containers keep serving while the new images build; the switch itself takes seconds.
A change to the documentation only rebuilds the website: `build site`, then `up -d site`. The
same steps with the backup and the checks around them, as an `update.sh`:
[`deployment/vps.md`](./deployment/vps.md#update).

## Without Docker

```bash
git pull --ff-only                 # or a release tag
yarn install --immutable
yarn build                         # the server and the admin UI
yarn site:build                    # the website, when you run it
# restart the processes: systemctl restart …, pm2 reload …
```

The admin UI and the website inline their `NEXT_PUBLIC_*` values when they are built, so the
rebuild is part of every upgrade. Process managers, probes and a restart without dropped
requests: [`deployment/README.md`](./deployment/README.md).

## After the upgrade

```bash
curl -s localhost:3240/api/ready     # {"status":"ok"}: the migrations ran, the database answers
curl -s localhost:3240/api/health    # "version" is the new one
```

(`3010` instead of `3240` without Docker.) A `503` on `/api/ready` that does not go away means
the server could not migrate or reach the database — `docker compose logs server` says which.
The update notice disappears by itself: it compares the running version on every request.

## Rolling back

Restore the backup taken before the upgrade and start the previous version — `VBH_TAG` back to
the old number, or `git checkout` of the old tag and a rebuild. A release without migrations
rolls back by starting the previous build alone. Why a plain downgrade is not enough, and what
a failed migration leaves behind: [`operations.md`](./operations.md#upgrading-the-code).

## Upgrading to a version with datasets

The first version that keeps several datasets ([`datasets.md`](./datasets.md)) migrates the
database by itself, like any other, and changes nothing a reader can see:

- the dictionary tables **stay where they are**, in `public`, and become the dataset `default`
  — the active one. Nothing is copied, the migration takes a moment whatever the size;
- the registry (`datasets`) is created with that one row: the project's dataset, CC BY 4.0, the
  version the instance had recorded;
- the public API gains fields and loses none: `source` on a word, `dataset`, `source` and
  `attribution_url` in `/api/v1/meta`. The SDKs of 1.0 read the answers of the new server, the
  new SDKs read the answers of a 1.0 server.

Rolling back is the usual restore of the backup taken before the upgrade. An instance that
already holds other datasets cannot be served by a version that does not know them: its tables
are in schemas the old code never looks into.

## The dictionary is updated separately

A new version of the code does not change the dictionary data, and a new dataset revision does
not need a new version of the code. The import page of the admin UI says when a newer dataset
exists; what an update replaces and what it keeps:
[`operations.md`](./operations.md#dataset-updates-vs-code-updates).
