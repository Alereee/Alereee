# Observability: metrics and logs

Two things tell you how a running instance is doing:

- **Metrics** — numbers over time: requests per second and their latency per route, the error
  rate, which search tier answers, how big the dictionary is, what an import is doing, how busy
  the Postgres pool is. They answer _can it take my traffic?_ and _why is it slow since
  yesterday?_
- **Logs** — one line per event, every request included, on stdout. They answer _what happened
  to this one request, with which error?_ ([Logs](#logs) below).

## How the monitoring works

Three parts, each doing one job:

1. **The server** counts things as it runs and publishes the counters as a text page at
   `/metrics`. Open it in a browser and you see lines like
   `http_requests_total{method="GET",route="/api/v1/search",status="200"} 1523`. Nothing is
   stored here: it is the current value of every counter, and the page is off until
   `METRICS_ENABLED=true`.
2. **Prometheus** is a database for those numbers. Every 15 s it fetches (_scrapes_) that
   page, stamps the values with the time and keeps them, so "requests per second over the
   last hour" becomes a question it can answer. It has a small UI of its own (port 9090; the bundled stack
   publishes it on 3243) for ad-hoc queries in its query language, PromQL.
3. **Grafana** draws the graphs. It asks Prometheus for the numbers and shows them on
   dashboards; this repository ships one dashboard with the panels an operator needs, and
   Grafana loads it at start.

The server needs neither of the other two to run. Three ways to have them, from the least to
the most work:

| Setup                                                           | What you do                                                                                                                                                                     | For                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Nothing**                                                     | leave `METRICS_ENABLED` off (the default); read the logs                                                                                                                        | a small instance                              |
| **The bundled stack** ([below](#prometheus--grafana-in-docker)) | one `docker compose` command with an overlay file: Prometheus, Grafana and a ready dashboard start next to the instance, on localhost                                           | a self-hosted server, a look at a slow search |
| **Your own Prometheus**                                         | set `METRICS_ENABLED=true`, add the server to your scrape config, import the dashboard file, keep `/metrics` off the internet ([Enabling and scraping](#enabling-and-scraping)) | a company setup with monitoring already there |

## Enabling and scraping

```dotenv
METRICS_ENABLED=true
METRICS_PATH=/metrics
```

> [!WARNING]
> The endpoint **must not be reachable from the internet** — it lists routes, versions and
> traffic.

The endpoint lives outside both API surfaces (`/api/v1`, the admin prefixes): no
authentication, no rate limit, `Cache-Control: no-store`, `text/plain` in the Prometheus text
format. It is off by default. Behind the reverse proxy of
[`deployment/reverse-proxy.md`](./deployment/reverse-proxy.md) either do not route it at all
(Prometheus scrapes the server's port directly, on the private network) or fence it like the
admin prefixes:

```nginx
location = /metrics { allow 10.0.0.0/8; deny all; proxy_pass http://vbh_server; }
```

```caddyfile
@metrics path /metrics
handle @metrics {
	@scraper remote_ip 10.0.0.0/8
	handle @scraper {
		reverse_proxy 127.0.0.1:3010
	}
	respond 404
}
```

A scrape job:

```yaml
scrape_configs:
  - job_name: vocab-bloom-hub
    scrape_interval: 15s
    static_configs:
      - targets: ['127.0.0.1:3010']
```

## Prometheus + Grafana in Docker

A ready-made local stack ships next to the main compose file — optional, never
part of the default stack. `docker-compose.observability.yml` is an _overlay_: a second compose
file merged over the first, which adds two services and sets `METRICS_ENABLED=true` on the
server. Start the instance with both files instead of one:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

> [!NOTE]
> The overlay mounts its configuration from the `observability/` folder next to the compose
> files. An installation made from the two downloaded files of the quick start does not have
> it: [Everything together](./deployment/docker.md#everything-together) lists the five files to
> fetch.

That starts, on localhost only:

- **Prometheus** at `http://localhost:3243` (`PROMETHEUS_PORT`), scraping the server's
  `/metrics` over the compose network every 15 s (`observability/prometheus.yml`; edit it if
  you change `METRICS_PATH`), keeping `PROMETHEUS_RETENTION` (15 days) of data in a named
  volume;
- **Grafana** at `http://localhost:3244` (`GRAFANA_PORT`), log in with
  `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (`admin` / `admin` unless set in `.env`).
  The Prometheus datasource and the **Vocab Bloom Hub** dashboard are provisioned from
  `observability/grafana/` at start — request rate, error rate and p95 latency by route,
  search tiers, dictionary size, import/export progress, the Postgres pool, CPU / memory /
  event loop lag. The dashboard is a committed file
  (`observability/grafana/dashboards/vocab-bloom-hub.json`), versioned with the code.

Stopping is the mirror image — add the same `-f` flags to
`docker compose down`; the named volumes `prometheus-data` and `grafana-data` keep the metric
history and Grafana state across restarts.

**An instance that does not run in this compose** — the native start (`yarn start`, systemd,
PM2) or a server on another machine — takes two steps instead of one:

1. Turn the metrics on in that instance's `.env` and restart it: `METRICS_ENABLED=true`. Check
   with `curl localhost:3010/metrics`.
2. Point Prometheus at it. In `observability/prometheus.yml` replace the target `server:3010`
   with the instance's address — `host.docker.internal:3010` for a server running on the
   Docker host itself, `10.0.0.5:3010` for another machine on the private network (never a
   public address, see above) — and start only the two monitoring services:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d prometheus grafana
   ```

Already running a Prometheus? Skip the compose file: add the instance to its scrape config,
load `observability/alerts.yml` as a rule file and import
`observability/grafana/dashboards/vocab-bloom-hub.json` into your Grafana.

> [!TIP]
> **Target DOWN with `connection refused`?** The scrape fails while the server is not listening
> yet — most often the server container cannot reach its database and keeps restarting (check
> `docker compose logs server`). The usual cause in a development checkout: the root `.env` holds
> a development `DATABASE_URL` pointing at `localhost` — inside a container that is the container
> itself ([`deployment/docker.md`](./deployment/docker.md#what-is-in-docker-composeyml)). Run the
> stack against the bundled Postgres without editing `.env`:
>
> ```bash
> COMPOSE_PROFILES=db DATABASE_URL= docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
> ```
>
> (shell variables override the `.env` values: the empty `DATABASE_URL` falls back to the bundled
> database, the profile starts it) — or point the container at the host's database with
> `DATABASE_URL=postgres://…@host.docker.internal:5432/… docker compose …`. A target that is
> `down` only briefly right after `up -d` is normal: the server answers `/metrics` once its
> migrations and startup are done.

## Alerts

The overlay's Prometheus loads `observability/alerts.yml` (`rule_files` in `prometheus.yml`):
seven rules over the metrics below, visible at `http://localhost:3243/alerts` and validated in
CI with `promtool`. What they watch, and what to do:

| Alert                | Fires when                                                                   | Look at                                                                                                |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `VbhInstanceDown`    | `/metrics` could not be scraped for 2 min                                    | `docker compose logs server`; the target address in `prometheus.yml`                                   |
| `VbhNotReady`        | `GET /api/ready` answered `503` only for 5 min                               | the reason in the probe's body: `database_unreachable`, `shutting_down`, `importing`, `import_failed`  |
| `VbhHighErrorRate`   | more than 5 % of the answers are `5xx` over 5 min, on real traffic           | the request ids of the errors in the log ([Logs](#logs))                                               |
| `VbhSlowRequests`    | the p95 latency of `/api/v1` is above 1 s for 10 min                         | the indexes and the query plans ([`performance.md`](./performance.md)), the pool                       |
| `VbhDbPoolExhausted` | clients wait for a Postgres connection for 5 min                             | `DB_POOL_SIZE`, slow queries ([`environment.md`](./environment.md))                                    |
| `VbhTransferStuck`   | an import or export is in progress with no change of its progress for 30 min | the server log; a stuck import holds readiness at `503 importing` ([`operations.md`](./operations.md)) |
| `VbhEventLoopLag`    | the p99 event-loop lag is above 0.5 s for 10 min                             | CPU and memory on the dashboard                                                                        |

`VbhNotReady` needs something that polls the readiness probe — an external uptime check
([`operations.md`](./operations.md#external-uptime-check)) or a load balancer; the probe is
counted like any other request, and without a poller the rule has nothing to see. The
thresholds suit one instance on the full dictionary: tune `for` and the ratios to your traffic
in the file, `docker compose … restart prometheus` reloads it.

Prometheus only shows a firing alert. To be notified — mail, a chat, a pager — run an
[Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) and name it in
`prometheus.yml`:

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
```

The overlay does not ship one: where the notifications go is a decision of the installation,
not of the project.

## Metrics

### Process (prom-client defaults)

`process_cpu_*`, `process_resident_memory_bytes`, `nodejs_heap_size_*`,
`nodejs_eventloop_lag_seconds` (and its percentiles), `nodejs_gc_duration_seconds`,
`nodejs_active_handles_total`, … — the standard Node.js set, plus:

| Metric           | Labels                | Meaning                                                           |
| ---------------- | --------------------- | ----------------------------------------------------------------- |
| `vbh_build_info` | `version`, `database` | Always `1`; the server version and driver (`postgres` / `sqlite`) |

### HTTP

Every request is timed by a middleware that runs before routing, so answers produced by the
surface switches and plain 404s count too.

| Metric                          | Type      | Labels                      | Meaning                                                               |
| ------------------------------- | --------- | --------------------------- | --------------------------------------------------------------------- |
| `http_requests_total`           | counter   | `method`, `route`, `status` | Requests answered                                                     |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` | Time from the request to the end of the response; buckets 5 ms – 60 s |
| `http_requests_in_flight`       | gauge     | —                           | Requests being answered right now                                     |

`route` is the **route template** (`/api/v1/words/:word`, `/api/en/add/:entryType`), never the
raw path — paths are unbounded and would create a series per headword. A request that matched
no route is labelled `unmatched`. The metrics endpoint itself is not counted.

### Dictionary and search

| Metric                                     | Type    | Labels               | Meaning                                                                                                                                                                                       |
| ------------------------------------------ | ------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vbh_search_tier_hits_total`               | counter | `tier`, `short_term` | Searches by the tier that produced the top answer: `exact`, `phrasal`, `prefix`, `phrase`, `suffix`, `contains`, `fuzzy`, `none` (nothing matched); `short_term` marks the 1–2 character flow |
| `vbh_dictionary_size`                      | gauge   | `kind`               | Rows served: `entries`, `words`, `phrases`, `grammar_patterns`, `word_forms`, `meanings`, `meaning_translations`, `short_translations`; refreshed at most once a minute, at scrape time       |
| `vbh_dictionary_transfers_total`           | counter | `kind`, `result`     | Finished imports and exports (`success` / `failure`)                                                                                                                                          |
| `vbh_dictionary_transfer_in_progress`      | gauge   | `kind`               | `1` while an import or export runs                                                                                                                                                            |
| `vbh_dictionary_transfer_progress_percent` | gauge   | `kind`, `stage`      | Progress of the running transfer, with its stage (`saving_words`, `linking_synonyms`, …)                                                                                                      |
| `vbh_db_pool_connections`                  | gauge   | `state`              | Postgres pool: `total`, `idle`, `waiting` clients; absent on SQLite                                                                                                                           |

The tier counter is the tuning signal for the search: a growing `fuzzy`
share means users misspell more than the substring tiers catch, a large `none` share means the
dictionary lacks what they look for.

A sustained `waiting` count on `vbh_db_pool_connections` means requests queue for a database
connection: raise `DB_POOL_SIZE` (and mind the connection limit of a managed Postgres — see
[environment.md](./environment.md)). The gauge is about the pool of the application, the one the
active dataset is served through; the small pools of the datasets that are read next to it
([datasets.md](./datasets.md#reading-every-dataset-at-once)) and of a running import are not
counted in it.

## Useful queries

```promql
# request rate and error rate, per route
sum by (route) (rate(http_requests_total[5m]))
sum by (route) (rate(http_requests_total{status=~"5.."}[5m])) / sum by (route) (rate(http_requests_total[5m]))

# p95 latency of the public reads
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{route=~"/api/v1/.*"}[5m])))

# how often the trigram tier saves a search
sum(rate(vbh_search_tier_hits_total{tier="fuzzy"}[1h])) / sum(rate(vbh_search_tier_hits_total[1h]))

# an import that is stuck: in progress for long with no progress change
vbh_dictionary_transfer_in_progress == 1 and changes(vbh_dictionary_transfer_progress_percent[10m]) == 0
```

## Logs

The server writes its log to **stdout**, one line per event, and nothing else: where the lines
end up is the process manager's business — `docker compose logs -f server` (Docker keeps them
in `/var/lib/docker/containers/…/*-json.log`), `journalctl -u vocab-bloom-hub-server` under
systemd, pm2's files. `LOG_FORMAT` picks their shape:

- **`json`** — the default with `NODE_ENV=production`, so in the Docker images: one JSON object
  per line, what a log collector reads without parsing rules;
- **`pretty`** — the default otherwise (`yarn dev`, the tests): the same lines rendered for a
  terminal, `[10:00:01.234] INFO: [Bootstrap] Server listening on port 3010`.

`LOG_LEVEL` is the minimum level, in Nest's names — `verbose` / `debug` / `log` / `warn` /
`error` / `fatal` (pino's `trace` and `info` are accepted too); `log` by default, `debug` with
`NODE_ENV=development`. Both are read
at start: change them in `.env` and restart the server (`docker compose up -d server` recreates
the container with the new environment).

### What the lines look like

```json
{"level":"info","time":"2026-08-30T10:00:01.234Z","pid":1,"hostname":"a1b2c3d4","context":"Bootstrap","msg":"Server listening on port 3010"}
{"level":"info","time":"2026-08-30T10:00:05.678Z","pid":1,"hostname":"a1b2c3d4","reqId":"6f1c2b3a-…","req":{"id":"6f1c2b3a-…","method":"GET","url":"/api/v1/words/run","remoteAddress":"203.0.113.7","userAgent":"curl/8.7.1"},"res":{"statusCode":200},"responseTime":12,"msg":"GET /api/v1/words/run 200 12ms"}
{"level":"error","time":"2026-08-30T10:00:09.012Z","pid":1,"hostname":"a1b2c3d4","reqId":"9c8d7e6f-…","context":"AllExceptionsFilter","statusCode":500,"err":{"type":"QueryFailedError","message":"…","stack":"QueryFailedError: …\n    at …"},"msg":"Unhandled exception on GET /api/en/words"}
```

| Field                        | What                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`                      | `trace` / `debug` / `info` / `warn` / `error` / `fatal` — as a word, not pino's number                                                                                                                                                                                                                                                                                 |
| `time`                       | ISO 8601, UTC                                                                                                                                                                                                                                                                                                                                                          |
| `context`                    | The class that wrote the line (`Bootstrap`, `EnImportDictionaryService`, `AllExceptionsFilter`, …)                                                                                                                                                                                                                                                                     |
| `msg`                        | The message                                                                                                                                                                                                                                                                                                                                                            |
| `req`, `res`, `responseTime` | The **request line**, written once per request when its response has finished: `req.id`, `method`, `url`, `remoteAddress` (the client — from `X-Forwarded-For` behind a proxy with `TRUST_PROXY`), `userAgent`; `res.statusCode`; `responseTime` in milliseconds. At `info`, or `error` when the server answered `5xx`. The probes and the metrics endpoint have none. |
| `reqId`                      | On **every** line written while a request is being handled — the request line, the exception filter, an import that failed in a request — so one id finds all of them                                                                                                                                                                                                  |
| `err`                        | `type`, `message`, `stack` on the errors the server raised itself                                                                                                                                                                                                                                                                                                      |

The **request id** is a UUID generated per request and echoed in the `X-Request-Id` response
header. An `X-Request-Id` that comes in — from the reverse proxy
(`header_up X-Request-Id {http.request.uuid}` in Caddy, `proxy_set_header X-Request-Id $request_id;`
in nginx) or from a client — is reused when it is 1–128 characters of `A-Z a-z 0-9 . _ -`, so
the proxy's access log and the server's lines share one id; anything else is replaced.

> [!NOTE]
> Not logged: `GET /api/health`, `GET /api/ready` and `METRICS_PATH` — polled every few seconds.
> Never logged: the `Authorization` header, the `Cookie` header (the admin `bearer`), `Set-Cookie`.
> The request line carries no headers but the user agent, and pino's redaction masks those three
> should a request object ever be logged by hand.

### Reading them

```bash
docker compose logs -f server                                  # as they come
docker compose logs --no-log-prefix server | jq -Rc 'fromjson? | select(.level == "error")'
docker compose logs --no-log-prefix server | jq -Rc 'fromjson? | select(.res.statusCode >= 500) | {time, msg, id: .req.id}'
docker compose logs --no-log-prefix server | jq -Rc 'fromjson? | select(.reqId == "6f1c2b3a-…")'   # everything of one request
docker compose logs --no-log-prefix server | jq -Rc 'fromjson? | select(.responseTime > 1000) | .msg'
journalctl -u vocab-bloom-hub-server -o cat | jq -Rc 'fromjson? | select(.level == "error")'   # native start under systemd
```

(`jq -R … fromjson?` skips the odd non-JSON line, such as a Node warning on stderr.)

### Shipping them to a collector

Nothing in the images or the compose file: a collector reads what Docker already stores. The
usual self-hosted setup is [Grafana Loki](https://grafana.com/oss/loki/) with an agent on the
Docker host — Grafana Alloy discovers the containers through the Docker socket, reads their
stdout and pushes the lines to Loki:

```alloy
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "containers" {
  targets = discovery.docker.containers.targets
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }
}

loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

In Grafana the JSON fields become filters: `{container="vocab-bloom-hub-server-1"} | json | level="error"`,
`… | json | res_statusCode >= 500`, `… | json | reqId="6f1c2b3a-…"`. The same lines suit any
collector that reads container stdout (Promtail, Fluent Bit, Vector, Filebeat, the CloudWatch
or Datadog agents), and Docker's own
[logging drivers](https://docs.docker.com/engine/logging/configure/) send them straight from
the daemon — `awslogs`, `gelf`, `syslog`, `fluentd`, or the Loki plugin — through a compose
override or `/etc/docker/daemon.json`, again without touching this repository's files. A native
start under systemd goes through journald, which every collector reads as well.

## Not here yet

Traces (OpenTelemetry) are out of scope; the metrics can be re-exported through an OTel
collector's Prometheus receiver. An Alertmanager and its notification channels are not part
of the overlay either ([Alerts](#alerts)).
