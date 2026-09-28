<p align="center">
  <img src="../.github/assets/main-readme-logo.svg" alt="Логотип Vocab Bloom Hub" />
</p>

<h1 align="center">Vocab Bloom Hub</h1>

<p align="center">
  Ein selbst gehostetes englisches Wörterbuch: 300 000 Einträge mit Bedeutungen, Beispielen, Formen, Übersetzungen und Wortlinks hinter einer öffentlichen API, einer Admin-Oberfläche, zwei SDKs, einer Website und einem offenen Datensatz.
</p>

<p align="center">
  <a href="https://vocab-bloom-hub.com/de"><strong>vocab-bloom-hub.com</strong></a> ·
  <a href="https://vocab-bloom-hub.com/de/docs">Dokumentation</a> ·
  <a href="https://vocab-bloom-hub.com/de/api">API-Referenz</a> ·
  <a href="https://vocab-bloom-hub.com/de/playground">Playground</a>
</p>

<p align="center">
  <a href="../README.md">🇺🇸 EN</a> | <a href="README.ru.md">🇷🇺 RU</a> | <a href="README.es.md">🇪🇸 ES</a> | <a href="README.fr.md">🇫🇷 FR</a> | <a href="README.pt.md">🇵🇹 PT</a> | <strong>🇩🇪 DE</strong> | <a href="README.zh.md">🇨🇳 ZH</a> | <a href="README.ar.md">🌐 AR</a>
</p>

<p align="center">
  <a href="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/check-pull-request.yml"><img src="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/check-pull-request.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/codeql.yml"><img src="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL" /></a>
  <a href="../LICENSE"><img src="https://img.shields.io/github/license/Fristail27/vocab-bloom-hub" alt="Лицензия: MIT" /></a>
  <a href="../DATA_LICENSE.md"><img src="https://img.shields.io/badge/data-CC%20BY%204.0-lightgrey" alt="Данные: CC BY 4.0" /></a>
  <a href="https://www.npmjs.com/package/@vocab-bloom-hub/client"><img src="https://img.shields.io/npm/v/%40vocab-bloom-hub%2Fclient?logo=npm&label=npm" alt="npm: @vocab-bloom-hub/client" /></a>
  <a href="https://pypi.org/project/vocab-bloom-hub/"><img src="https://img.shields.io/pypi/v/vocab-bloom-hub?logo=pypi&logoColor=white" alt="PyPI: vocab-bloom-hub" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/commits/main"><img src="https://img.shields.io/github/last-commit/Fristail27/vocab-bloom-hub" alt="Последний коммит" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/issues"><img src="https://img.shields.io/github/issues/Fristail27/vocab-bloom-hub" alt="Открытые issues" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/pulls"><img src="https://img.shields.io/github/issues-pr/Fristail27/vocab-bloom-hub" alt="Открытые pull requests" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/stargazers"><img src="https://img.shields.io/github/stars/Fristail27/vocab-bloom-hub?style=flat" alt="Звёзды" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Node >= 22" />
  <img src="https://img.shields.io/badge/yarn-4-2C8EBB?logo=yarn&logoColor=white" alt="Yarn 4" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white" alt="NestJS 12" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/tests-Jest%20%7C%20Playwright-C21325?logo=jest&logoColor=white" alt="Jest и Playwright" />
  <a href="../CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PR приветствуются" /></a>
  <a href="../CODE_OF_CONDUCT.md"><img src="https://img.shields.io/badge/code%20of%20conduct-Contributor%20Covenant-5E0D73.svg" alt="Contributor Covenant" /></a>
</p>

---

## 📖 Was es ist

Ein Wörterbuchserver, den Sie selbst betreiben. Er bringt die Daten mit, eine API zum Lesen,
ein Admin-Panel zum Bearbeiten und SDKs, um darauf aufzubauen.

**Das Wörterbuch**

- 89 000 englische Wörter und 26 000 Wendungen, 161 000 Bedeutungen mit Definitionen und Beispielen
- IPA-Transkription, GER-Niveau, Register- und Fachgebietsangaben, flektierte Formen
- Synonym- und Antonymlinks zwischen Stichwörtern, Partikelverben mit ihrem Grundverb verknüpft
- Übersetzungen ins Russische, Spanische, Französische, Deutsche, Portugiesische, Chinesische und Arabische
- offene Daten: [CC BY 4.0](../DATA_LICENSE.md), auf HuggingFace veröffentlicht, beim ersten
  Start in eine leere Instanz geladen; mit Sprachmodellen erzeugt, nicht von Menschen geprüft

**Die API** — `/api/v1`, nur lesend, ohne Schlüssel

- Suche mit Relevanzstufen und Tippfehlertoleranz; ein Stichwort mit allem, was dazugehört
- gefilterte Listen mit Cursor-Paginierung, ein zufälliger Eintrag, eine Stapelabfrage von bis zu 50 Wörtern
- Ratenbegrenzung pro Client, jede Antwort mit ETag gecacht, ein OpenAPI-Dokument zum Generieren von Clients

**Die SDKs** — aus diesem OpenAPI-Dokument generiert

- Node.js / TypeScript: `npm install @vocab-bloom-hub/client`
- Python: `pip install vocab-bloom-hub` (synchron, asynchron, ein pandas-Helfer)

**Das Admin-Panel** — acht Oberflächensprachen

- Wörter, Bedeutungen, Übersetzungen und Links bearbeiten; jede Änderung bleibt im Verlauf, mit
  den Werten davor und danach, für Leser sichtbar und mit einem Klick zurückzunehmen
- die Korrekturen moderieren, die Leser von den Wortseiten schicken
- Massenanfragen an ein Sprachmodell über einen gefilterten Ausschnitt des Wörterbuchs
- das ganze Wörterbuch als Datensatz importieren und exportieren, online oder aus einer Datei

**Die Website** — die Dokumentation, die API-Referenz, ein Playground, öffentliche Wortseiten

**Unter der Haube** — PostgreSQL (SQLite für die Entwicklung), Docker-Images, Migrationen beim
Start, Health-Probes, Prometheus-Metriken, JSON-Logs.

> [!NOTE]
> Status: `1.0`, stabil: die öffentliche API unter `/api/v1` folgt der semantischen Versionierung; eine inkompatible Änderung bedeutet eine neue Hauptversion.

---

## ⚡ Erste Schritte

Drei Wege, vom schnellsten zum flexibelsten. Alle enden mit dem Admin-Panel, der API
und dem geladenen Wörterbuch: mit Docker auf <http://localhost:3241> und
<http://localhost:3240>, ohne Docker auf <http://localhost:3000> und <http://localhost:3010>.

### 1. Die veröffentlichten Images starten

Kein Checkout nötig — ein Ordner, zwei Dateien, Docker:

```bash
mkdir vocab-bloom-hub && cd vocab-bloom-hub
curl -fsSLO https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/.env.example -o .env
```

Öffnen Sie die `.env` und setzen Sie zwei Passwörter: `ADMIN_PASSWORD` (die Admin-Anmeldung)
und `POSTGRES_PASSWORD` (die mitgelieferte Datenbank). Dann:

```bash
docker compose up -d
```

Der erste Start lädt das Wörterbuch herunter und importiert es — einige Minuten.
`GET /api/ready` antwortet solange mit `503` und danach mit `200`; dann melden Sie sich mit
`ADMIN_USERNAME` / `ADMIN_PASSWORD` aus der `.env` an.

```bash
curl -s localhost:3240/api/ready            # {"status":"ok"}
curl -s localhost:3240/api/v1/words/run     # das Wörterbuch antwortet

# Suche: die passenden Einträge, der beste Treffer zuerst
curl -s 'localhost:3240/api/v1/search?search=run&limit=5'
# dasselbe mit Bedeutungen, Beispielen und Übersetzungen
curl -s 'localhost:3240/api/v1/search/detailed?search=run&with_meanings=true'
```

> [!TIP]
> Um ein Release statt des Entwicklungs-Builds `main` zu pinnen, setzen Sie
> `VBH_TAG=1.0.0` in der `.env`. Um die Website (Dokumentation, API-Referenz, Playground,
> Wortseiten) auf <http://localhost:3242> hinzuzufügen, setzen Sie `COMPOSE_PROFILES=db,site`.

### 2. Aus dem Repository starten

Dieselbe Compose-Datei, aus den Quellen gebaut — für einen Fork oder eine unveröffentlichte
Änderung:

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
cp .env.example .env                           # dieselben zwei Passwörter
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 3. Ohne Docker starten

Ein Produktivstart direkt auf der Maschine: Node.js 22.13+, Yarn 4 (`corepack enable`) und ein
erreichbares Postgres ([`docs/database.md`](database.md)).

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
yarn install
printf 'NODE_ENV=production\nDATABASE_URL=postgres://user:password@localhost:5432/vocab_bloom\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\nDICTIONARY_AUTO_IMPORT=true\n' > .env
yarn build && yarn start                       # API :3010, Admin :3000; das Wörterbuch lädt sich beim ersten Start selbst
yarn site:build && yarn start:site             # die Website :3020, optional, in einem zweiten Terminal
```

Hinter einer Domain und TLS, mit systemd oder PM2: [`docs/deployment/`](deployment/README.md).

### Für die Entwicklung

Keine Datenbank nötig: ohne `DATABASE_URL` nutzt der Server eine lokale SQLite-Datei, und jede
App startet bei Änderungen neu.

```bash
printf 'NODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\n' > .env
yarn dev                                       # API :3010, Admin :3000, Website :3020
```

> [!IMPORTANT]
> Laden Sie das Wörterbuch mit _Import dictionary_ im Admin-Panel.

Alles Weitere für Mitwirkende: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### Weiter

- Die Dokumentation als Website, mit der API-Referenz und einem Playground:
  [vocab-bloom-hub.com](https://vocab-bloom-hub.com/de/docs).
- Auf einen Server bringen: [`docs/deployment/`](deployment/README.md) — TLS und
  Reverse-Proxy, systemd / PM2, Upgrades.
- Die Datenbank: [`docs/database.md`](database.md) — Postgres-Anforderungen, Migrationen,
  Backups, Größe.
- Jede Einstellung: [`docs/environment.md`](environment.md).
- Metriken und Logs: [`docs/observability.md`](observability.md) — Prometheus und Grafana mit
  einem Befehl, oder Ihre eigenen.
- Die Daten lesen: [`docs/api.md`](api.md), die SDKs für [Node.js](../packages/npm-sdk/README.md)
  und [Python](../packages/python-sdk/README.md).

---

## 🤝 Mitwirken

Beiträge sind willkommen. [`CONTRIBUTING.md`](../CONTRIBUTING.md) beschreibt den Ablauf
(Branch-Namen, Commit-Nachrichten, die PR-Checkliste), den Tech-Stack und den Aufbau des
Repositorys, jedes Skript, den Index der Dokumentation und die Roadmap; der
[Verhaltenskodex](../CODE_OF_CONDUCT.md) gilt für jede Interaktion. Einen Fehler gefunden oder
eine Idee? Öffnen Sie ein [Issue](https://github.com/Fristail27/vocab-bloom-hub/issues/new/choose)
— die Vorlagen führen Sie.

---

## 📄 Lizenz

- **Code** — [MIT](../LICENSE) © Aleksei Ryzhov (Fristail27)
- **Wörterbuchdaten** (Exporte, die öffentliche API, der HuggingFace-Datensatz) — [CC BY 4.0](../DATA_LICENSE.md): frei nutzbar und anpassbar, auch kommerziell, mit Namensnennung.

> [!IMPORTANT]
> Die Daten sind größtenteils LLM-generiert und nicht von Menschen geprüft — lesen Sie
> [`data.md`](data.md), bevor Sie sich darauf verlassen.
