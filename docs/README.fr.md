<p align="center">
  <img src="../.github/assets/main-readme-logo.svg" alt="Логотип Vocab Bloom Hub" />
</p>

<h1 align="center">Vocab Bloom Hub</h1>

<p align="center">
  Un dictionnaire d’anglais auto-hébergé : 300 000 entrées avec sens, exemples, formes, traductions et liens entre mots derrière une API publique, une interface d’administration, deux SDK, un site web et un jeu de données ouvert.
</p>

<p align="center">
  <a href="https://vocab-bloom-hub.com/fr"><strong>vocab-bloom-hub.com</strong></a> ·
  <a href="https://vocab-bloom-hub.com/fr/docs">Documentation</a> ·
  <a href="https://vocab-bloom-hub.com/fr/api">Référence de l’API</a> ·
  <a href="https://vocab-bloom-hub.com/fr/playground">Playground</a>
</p>

<p align="center">
  <a href="../README.md">🇺🇸 EN</a> | <a href="README.ru.md">🇷🇺 RU</a> | <a href="README.es.md">🇪🇸 ES</a> | <strong>🇫🇷 FR</strong> | <a href="README.pt.md">🇵🇹 PT</a> | <a href="README.de.md">🇩🇪 DE</a> | <a href="README.zh.md">🇨🇳 ZH</a> | <a href="README.ar.md">🌐 AR</a>
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

## 📖 Qu’est-ce que c’est

Un serveur de dictionnaire que vous hébergez vous-même. Il est livré avec les données, une API
pour les lire, un panneau d’administration pour les modifier et des SDK pour construire dessus.

**Le dictionnaire**

- 89 000 mots et 26 000 expressions en anglais, 161 000 sens avec définitions et exemples
- transcription API, niveau CECRL, marques de registre et de domaine, formes fléchies
- liens de synonymes et d’antonymes entre les vedettes, verbes à particule reliés à leur verbe de base
- traductions vers le russe, l’espagnol, le français, l’allemand, le portugais, le chinois et l’arabe
- données ouvertes : [CC BY 4.0](../DATA_LICENSE.md), publiées sur HuggingFace, chargées dans
  une instance vide au premier démarrage ; générées par des modèles de langage, non vérifiées par des humains

**L’API** — `/api/v1`, lecture seule, sans clé

- recherche par niveaux de pertinence avec tolérance aux fautes de frappe ; une vedette avec tout ce qui s’y rattache
- listes filtrées paginées par curseur, une entrée aléatoire, une consultation par lot de 50 mots au plus
- limitation de débit par client, chaque réponse mise en cache avec un ETag, un document OpenAPI pour générer des clients

**Les SDK** — générés à partir de ce document OpenAPI

- Node.js / TypeScript : `npm install @vocab-bloom-hub/client`
- Python : `pip install vocab-bloom-hub` (synchrone, asynchrone, un utilitaire pandas)

**Le panneau d’administration** — huit langues d’interface

- modifier les mots, les sens, les traductions et les liens ; chaque changement reste dans un
  historique avec les valeurs avant et après, visible des lecteurs et annulable en un clic
- modérer les corrections que les lecteurs envoient depuis les pages de mots
- lancer des requêtes en masse vers un modèle de langage sur une tranche filtrée du dictionnaire
- importer et exporter le dictionnaire entier en jeu de données, en ligne ou depuis un fichier

**Le site web** — la documentation, la référence de l’API, un bac à sable, des pages de mots publiques

**Sous le capot** — PostgreSQL (SQLite pour le développement), images Docker, migrations au
démarrage, sondes de santé, métriques Prometheus, journaux JSON.

> [!NOTE]
> Statut : `1.0`, version stable : l’API publique sous `/api/v1` suit le versionnage sémantique ; un changement incompatible implique une nouvelle version majeure.

---

## ⚡ Démarrage

Trois chemins, du plus rapide au plus souple. Tous aboutissent au panneau d’administration,
à l’API et au dictionnaire chargé : avec Docker sur <http://localhost:3241> et
<http://localhost:3240>, sans lui sur <http://localhost:3000> et <http://localhost:3010>.

### 1. Lancer les images publiées

Aucun dépôt à cloner — un dossier, deux fichiers, Docker :

```bash
mkdir vocab-bloom-hub && cd vocab-bloom-hub
curl -fsSLO https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/.env.example -o .env
```

Ouvrez `.env` et définissez deux mots de passe : `ADMIN_PASSWORD` (la connexion
administrateur) et `POSTGRES_PASSWORD` (la base de données incluse). Puis :

```bash
docker compose up -d
```

Le premier démarrage télécharge le dictionnaire et l’importe — quelques minutes.
`GET /api/ready` répond `503` pendant ce temps et `200` ensuite ; connectez-vous alors avec
`ADMIN_USERNAME` / `ADMIN_PASSWORD` du `.env`.

```bash
curl -s localhost:3240/api/ready            # {"status":"ok"}
curl -s localhost:3240/api/v1/words/run     # le dictionnaire répond

# recherche : les entrées correspondantes, la meilleure d'abord
curl -s 'localhost:3240/api/v1/search?search=run&limit=5'
# la même avec les sens, les exemples et les traductions
curl -s 'localhost:3240/api/v1/search/detailed?search=run&with_meanings=true'
```

> [!TIP]
> Pour épingler une version au lieu de la construction `main`, mettez `VBH_TAG=1.0.0` dans
> `.env`. Pour ajouter le site web (documentation, référence de l’API, bac à sable, pages de mots)
> sur <http://localhost:3242>, mettez `COMPOSE_PROFILES=db,site`.

### 2. Lancer depuis le dépôt

Le même fichier compose, construit depuis les sources — pour un fork ou une modification non
publiée :

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
cp .env.example .env                           # les deux mêmes mots de passe
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 3. Lancer sans Docker

Un lancement de production sur la machine elle-même : Node.js 22.13+, Yarn 4 (`corepack enable`)
et un Postgres accessible ([`docs/database.md`](database.md)).

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
yarn install
printf 'NODE_ENV=production\nDATABASE_URL=postgres://user:password@localhost:5432/vocab_bloom\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\nDICTIONARY_AUTO_IMPORT=true\n' > .env
yarn build && yarn start                       # API :3010, administration :3000 ; le dictionnaire se charge seul au premier démarrage
yarn site:build && yarn start:site             # le site :3020, optionnel, dans un autre terminal
```

Derrière un domaine et TLS, avec systemd ou PM2 : [`docs/deployment/`](deployment/README.md).

### Pour le développement

Aucune base de données nécessaire : sans `DATABASE_URL` le serveur utilise un fichier SQLite
local, et chaque application redémarre à la modification.

```bash
printf 'NODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\n' > .env
yarn dev                                       # API :3010, administration :3000, site :3020
```

> [!IMPORTANT]
> Chargez le dictionnaire avec _Import dictionary_ dans l’administration.

Tout le reste pour les contributeurs : [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### Ensuite

- La documentation sous forme de site, avec la référence de l’API et un playground :
  [vocab-bloom-hub.com](https://vocab-bloom-hub.com/fr/docs).
- Le mettre sur un serveur : [`docs/deployment/`](deployment/README.md) — TLS et reverse
  proxy, systemd / PM2, mises à niveau.
- La base de données : [`docs/database.md`](database.md) — prérequis Postgres, migrations,
  sauvegardes, taille.
- Tous les réglages : [`docs/environment.md`](environment.md).
- Métriques et logs : [`docs/observability.md`](observability.md) — Prometheus et Grafana en
  une commande, ou les vôtres.
- Lire les données : [`docs/api.md`](api.md), les SDK [Node.js](../packages/npm-sdk/README.md)
  et [Python](../packages/python-sdk/README.md).

---

## 🤝 Contribuer

Les contributions sont les bienvenues. [`CONTRIBUTING.md`](../CONTRIBUTING.md) décrit le flux de
travail (noms de branches, messages de commit, liste de contrôle des PR), la pile technique et
l’organisation du dépôt, tous les scripts, l’index de la documentation et la feuille de route ;
le [Code de conduite](../CODE_OF_CONDUCT.md) s’applique à toute interaction. Un bug ou une idée ?
Ouvrez une [issue](https://github.com/Fristail27/vocab-bloom-hub/issues/new/choose) — les
modèles vous guident.

---

## 📄 Licence

- **Code** — [MIT](../LICENSE) © Aleksei Ryzhov (Fristail27)
- **Données du dictionnaire** (exports, API publique, jeu de données HuggingFace) — [CC BY 4.0](../DATA_LICENSE.md) : libres d’utilisation et d’adaptation, y compris commerciales, avec attribution.

> [!IMPORTANT]
> Les données sont en grande partie générées par des LLM et non vérifiées par des humains — lisez
> [`data.md`](data.md) avant de vous y fier.
