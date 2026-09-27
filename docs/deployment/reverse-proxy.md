# Reverse proxy, TLS and keeping the admin API private

The server (`SERVER_PORT`, 3010) and the frontend (`FRONT_PORT`, 3000) speak plain HTTP on
their own ports. Under docker compose the host ports default to `3240` (API), `3241` (admin UI)
and `3242` (website): use those in the upstreams below instead of `3010` / `3000` / `3020`. In production a reverse proxy in front of them does three things:

1. **Terminates TLS.** The admin cookie is `secure` only over HTTPS; on plain `http://` the login
   works but the token travels unencrypted, and the server logs a warning at every such login.
2. **Routes one origin to two processes.** `/api/*` goes to the server, everything else to the
   frontend, so the UI calls the API on its own origin (`NEXT_PUBLIC_BASE_API_URL=https://dict.example.com/api`).
3. **Decides what is reachable from where.** The public API (`/api/v1`) and the admin API
   (`/api/en`, `/api/settings`, `/api/auth`) share one host; the proxy exposes the first and
   fences the second.

The configs below are templates: replace `dict.example.com` and the ports with yours.

## Before the proxy: the server side

| Setting                    | Value behind a proxy           | Why                                                                                                                                                                           |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY`              | `1` (one proxy hop)            | The rate limits and the logs key on the client address; without it every request carries the proxy's address                                                                  |
| `NEXT_PUBLIC_BASE_API_URL` | `https://dict.example.com/api` | The browser calls the API through the proxy — so does the frontend's server-side rendering unless `API_INTERNAL_URL` names the server directly. Baked into the frontend build |
| `CORS_ORIGINS`             | `https://dict.example.com`     | The origin(s) a browser may call the API from with credentials                                                                                                                |
| `NODE_ENV`                 | `production`                   | Postgres required, Swagger UI off, JSON logs; a login over plain http is logged as a warning                                                                                  |

`TRUST_PROXY` is Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html)
setting: a hop count (`1` for one proxy, `2` for a CDN in front of it), `loopback`, an IP or CIDR
list, or `true` for every hop. Leave it unset without a proxy — the server then ignores
`X-Forwarded-*`. The startup log confirms the setting.

> [!WARNING]
> Prefer the hop count: `true` lets a client forge its address in `X-Forwarded-For` and dodge the
> limits.

> [!NOTE]
> Requests that reach the API through the frontend's or the website's own `/api/*` forwarding (the
> no-proxy setup) are attributed to the Next.js process, whatever `TRUST_PROXY` says: per-client
> rate limiting needs the reverse proxy in front of the API.

## What the proxy must do

- Pass `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` (Caddy does by default; nginx needs
  the `proxy_set_header` lines).
- **Not buffer `/api/*` responses.** Import and export report progress as an NDJSON stream; a
  buffering proxy freezes the progress bar at 0 % and then jumps to done. The server sends
  `X-Accel-Buffering: no` (nginx honours it) and Caddy flushes chunked responses by itself; the
  explicit settings below are belt and braces.
- **Allow long requests on `/api/*`**: an import runs for minutes (`proxy_read_timeout 600s`).
- **Allow large request bodies on `/api/*`**: an uploaded archive is up to 512 MB (nginx:
  `client_max_body_size 512m`; Caddy has no limit by default). An instance that installs
  datasets of public sources ([`../datasets.md`](../datasets.md)) uploads their files: the
  extract of Wiktionary is 0.5 GB and grows, the server takes up to 2 GiB — `client_max_body_size
2g` for the time of the installation, or for good.
- **Add `Strict-Transport-Security`.** The other security headers come from the apps
  themselves — the server through helmet, the admin UI and the website from their Next.js
  configs (`X-Content-Type-Options: nosniff`, `X-Frame-Options` / `frame-ancestors`,
  `Referrer-Policy`, `Permissions-Policy`) — so every installation has them. HSTS is the one
  that only makes sense where TLS ends, which is here; the templates below add it. Leave it
  out while a hostname is still served over plain `http://`: browsers remember it for the
  whole `max-age`.

## Caddy

Recommended for self-hosting: certificates for a public hostname are obtained and renewed by
themselves. `/etc/caddy/Caddyfile`:

```caddyfile
dict.example.com {
	encode gzip
	# TLS ends here: tell browsers to come back over https only
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"

	# API: streamed progress must reach the browser as it is produced
	handle /api/* {
		reverse_proxy 127.0.0.1:3010 {
			flush_interval -1
		}
	}

	# everything else is the Next.js frontend
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

> [!TIP]
> For a LAN hostname without a public certificate add `tls internal` inside the site block
> (Caddy's own CA; install its root certificate on the clients).

## nginx

`/etc/nginx/conf.d/vocab-bloom-hub.conf`, with certificates from certbot or any other source:

```nginx
upstream vbh_server   { server 127.0.0.1:3010; }
upstream vbh_frontend { server 127.0.0.1:3000; }

server {
    listen 80;
    server_name dict.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name dict.example.com;

    ssl_certificate     /etc/letsencrypt/live/dict.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dict.example.com/privkey.pem;

    # TLS ends here: tell browsers to come back over https only
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # dataset upload (import from an archive)
    client_max_body_size 512m;

    location /api/ {
        proxy_pass http://vbh_server;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # import / export progress is an NDJSON stream: deliver lines as they come
        proxy_buffering         off;
        proxy_request_buffering off;
        proxy_read_timeout      600s;
    }

    location / {
        proxy_pass http://vbh_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Exposure profiles

Three ways to place one instance, from the most closed to the most open. All use the configs
above; the profile decides what is added.

### (a) Everything private

The instance lives on a LAN or behind a VPN. Nothing to add: the configs above as they are
(`tls internal` in Caddy or an internal CA certificate in nginx when the hostname is not
public). Both API surfaces and the admin UI are available to whoever can reach the host.

### (b) Public dictionary, private admin

The public API (`/api/v1`) and, if wanted, the frontend are on the internet; the admin prefixes
answer only from trusted networks.

> [!IMPORTANT]
> The rules go **before** the general `/api/` rule.

Caddy — allow from private networks, `404` for the rest:

```caddyfile
dict.example.com {
	encode gzip

	@adminApi path /api/en/* /api/settings /api/settings/* /api/auth /api/auth/*
	@trusted remote_ip 10.0.0.0/8 127.0.0.1 ::1

	handle @adminApi {
		handle @trusted {
			reverse_proxy 127.0.0.1:3010 {
				flush_interval -1
			}
		}
		respond 404
	}

	handle /api/* {
		reverse_proxy 127.0.0.1:3010 {
			flush_interval -1
		}
	}

	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

nginx — a regex `location` wins over the `/api/` prefix and takes the admin prefixes out of it:

```nginx
    location ~ ^/api/(en|settings|auth)(/|$) {
        allow 10.0.0.0/8;   # office / VPN
        allow 127.0.0.1;    # the frontend's server-side rendering, when it runs on this host
        allow ::1;
        deny  all;          # 403; use `return 404;` instead of the allow/deny lines to hide the surface

        proxy_pass http://vbh_server;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering         off;
        proxy_request_buffering off;
        proxy_read_timeout      600s;
    }
```

> [!TIP]
> Basic auth at the proxy (`basicauth` in Caddy, `auth_basic` in nginx) on the same matcher is an
> alternative to the address list; the admin login stays behind it.

Two things to keep in mind:

- **The frontend's server-side rendering calls the admin API too**, from the frontend host
  through the proxy. Its address must be in the allow list — `127.0.0.1` and `::1` when the
  frontend runs on the proxy host and the hostname resolves locally (an `/etc/hosts` entry
  makes sure it does) — or the admin pages fail to render even for a trusted browser.
- **The frontend is the admin UI.** Without the admin API a visitor sees a login page that
  cannot sign in. Restrict `/` with the same allow list if even that is too much; the public
  API does not depend on the frontend.

### (c) Public-only instance

A demo or an embedded dictionary that nobody edits in place: `ADMIN_API_ENABLED=false` makes
the server itself answer `404` on the admin prefixes — no proxy rule to forget. Edit the data
on a private instance and move it over with the dataset export / import
([`../offline-import.md`](../offline-import.md)). The frontend can be left out; `/api/v1` needs
only the server.

This is where the project website belongs (the `site` profile,
[`docker.md`](./docker.md#the-website)): the proxy routes `/api/*` to the server and everything
else to the site (`127.0.0.1:3020`) instead of the admin UI — the documentation, the API
reference, the playground and the word pages then run over this dictionary.

A public website that is still edited in place combines (b) and (c) on two hostnames: the
website with `/api/v1` on the public one, where the admin prefixes answer `404` at the proxy,
and the admin UI with the admin API on `admin.…`, behind an address list and a certificate of
its own, plus a `www` redirect. That layout — the one the project website runs on — is a
complete nginx file: [`examples/nginx-two-hosts.conf`](./examples/nginx-two-hosts.conf); the
whole installation around it: [`vps.md`](./vps.md).

The opposite switch, `PUBLIC_API_ENABLED=false`, makes an editing-only instance
([`../api.md`](../api.md#running-a-public-only-or-admin-only-instance)).

## Checklist

- [ ] `https://` end to end — the admin cookie is `secure` only then; over plain HTTP the token
      travels in the clear.
- [ ] `Strict-Transport-Security` is added by the proxy (the templates do); the other security
      headers are already in every answer of the apps — `curl -I https://dict.example.com/en/login`
      shows `X-Frame-Options: DENY` from the admin UI.
- [ ] `TRUST_PROXY` set to the number of proxy hops; the startup log confirms it.
- [ ] `NEXT_PUBLIC_BASE_API_URL` and `CORS_ORIGINS` are the public origin; the frontend was
      rebuilt after setting them.
- [ ] `ADMIN_USERNAME` / `ADMIN_PASSWORD` are long and random — the single admin account is the
      whole authentication.
- [ ] The Swagger UI is off (`NODE_ENV=production` does that); `GET /api/v1/openapi.json` stays
      on and is public by design ([`../api-tools.md`](../api-tools.md)).
- [ ] The public rate limit (`PUBLIC_API_RATE_LIMIT`) fits the expected traffic; a CDN in front
      honours the `Cache-Control` / `ETag` of `/api/v1` responses ([`../api.md`](../api.md#caching)).
- [ ] Admin prefixes are fenced at the proxy (profile b) or switched off (profile c).
- [ ] The Prometheus endpoint (`METRICS_ENABLED`, [`../observability.md`](../observability.md))
      is scraped on the private network or fenced like the admin prefixes — never public.
- [ ] The probes `GET /api/health` and `GET /api/ready` ([`README.md`](./README.md#probes))
      reach the server through the general `/api/` rule.
- [ ] The import/export stream works through the proxy: start an export from the admin UI and
      watch the progress bar move, not jump.
