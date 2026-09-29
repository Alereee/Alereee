<p align="center">
  <img src="../.github/assets/main-readme-logo.svg" alt="Логотип Vocab Bloom Hub" />
</p>

<h1 align="center">Vocab Bloom Hub</h1>
<!-- reviewed: ru · @Karodar · 2026-09-29 · 375cb7d -->

<p align="center">
  Самостоятельно размещаемый английский словарь: 300 000 записей со значениями, примерами, формами, переводами и связями между словами, доступных через публичный API, админка, две SDK, сайт и открытый датасет.
</p>

<p align="center">
  <a href="https://vocab-bloom-hub.com/ru"><strong>vocab-bloom-hub.com</strong></a> ·
  <a href="https://vocab-bloom-hub.com/ru/docs">Документация</a> ·
  <a href="https://vocab-bloom-hub.com/ru/api">Справочник API</a> ·
  <a href="https://vocab-bloom-hub.com/ru/playground">Песочница</a>
</p>

<p align="center">
  <a href="../README.md">🇺🇸 EN</a> | <strong>🇷🇺 RU</strong> | <a href="README.es.md">🇪🇸 ES</a> | <a href="README.fr.md">🇫🇷 FR</a> | <a href="README.pt.md">🇵🇹 PT</a> | <a href="README.de.md">🇩🇪 DE</a> | <a href="README.zh.md">🇨🇳 ZH</a> | <a href="README.ar.md">🌐 AR</a>
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

## 📖 Что это

Сервер словаря, который вы запускаете у себя. В комплекте данные, API для чтения, админка для
правки и SDK, чтобы строить поверх.

**Словарь**

- 89 000 английских слов и 26 000 фраз, 161 000 значений с определениями и примерами
- транскрипция IPA, уровень CEFR, пометы регистра и предметной области, словоформы
- связи синонимов и антонимов между словами, фразовые глаголы привязаны к базовому глаголу
- переводы на русский, испанский, французский, немецкий, португальский, китайский и арабский
- открытые данные: [CC BY 4.0](../DATA_LICENSE.md), опубликованы на HuggingFace, загружаются в
  пустой экземпляр при первом запуске; сгенерированы языковыми моделями, людьми не проверены

**API** — `/api/v1`, только чтение, без ключей

- поиск с уровнями релевантности и допуском опечаток; слово со всем, что к нему привязано
- отфильтрованные списки с курсорной пагинацией, случайная запись, пакетный поиск до 50 слов
- rate limit на клиента, каждый ответ кэшируется с ETag, OpenAPI-документ для генерации клиентов

**SDK** — сгенерированы из этого OpenAPI-документа

- Node.js / TypeScript: `npm install @vocab-bloom-hub/client`
- Python: `pip install vocab-bloom-hub` (синхронный, асинхронный, помощник для pandas)

**Админка** — восемь языков интерфейса

- правка слов, значений, переводов и связей; каждое изменение остаётся в истории со значениями
  до и после, видно читателям и откатывается одним кликом
- модерация исправлений, которые читатели присылают со страниц слов
- массовые запросы к языковой модели по отфильтрованному срезу словаря
- импорт и экспорт всего словаря датасетом, онлайн или из файла

**Сайт** — документация, справочник API, песочница, публичные страницы слов

**Под капотом** — PostgreSQL (SQLite для разработки), Docker-образы, миграции при старте, пробы
готовности, метрики Prometheus, JSON-логи.

> [!NOTE]
> Статус: `1.0`, стабильный релиз: публичный API под `/api/v1` следует семантическому версионированию — несовместимое изменение означает новую мажорную версию.

---

## ⚡ Быстрый старт

Три пути, от самого быстрого к самому гибкому. Все заканчиваются админкой, API
и загруженным словарём: в Docker на <http://localhost:3241> и <http://localhost:3240>, без него
на <http://localhost:3000> и <http://localhost:3010>.

### 1. Запуск готовых образов

Без клонирования — одна папка, два файла, Docker:

```bash
mkdir vocab-bloom-hub && cd vocab-bloom-hub
curl -fsSLO https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/.env.example -o .env
```

Откройте `.env` и задайте два пароля: `ADMIN_PASSWORD` (вход в админку) и `POSTGRES_PASSWORD`
(встроенная база). Затем:

```bash
docker compose up -d
```

Первый запуск скачивает словарь и импортирует его — несколько минут. `GET /api/ready`
отвечает `503`, пока идёт загрузка, и `200` после; затем войдите с `ADMIN_USERNAME` /
`ADMIN_PASSWORD` из `.env`.

```bash
curl -s localhost:3240/api/ready            # {"status":"ok"}
curl -s localhost:3240/api/v1/words/run     # словарь отвечает

# поиск: статьи по запросу, лучшее совпадение первым
curl -s 'localhost:3240/api/v1/search?search=run&limit=5'
# то же со значениями, примерами и переводами
curl -s 'localhost:3240/api/v1/search/detailed?search=run&with_meanings=true'
```

> [!TIP]
> Чтобы закрепить релиз вместо сборки `main`, задайте `VBH_TAG=1.0.0` в `.env`. Чтобы
> добавить сайт (документация, справочник API, песочница, страницы слов) на
> <http://localhost:3242>, задайте `COMPOSE_PROFILES=db,site`.

### 2. Запуск из репозитория

Тот же compose-файл, собранный из исходников — для форка или неопубликованного изменения:

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
cp .env.example .env                           # те же два пароля
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 3. Запуск без Docker

Запуск в production прямо на машине: Node.js 22.13+, Yarn 4 (`corepack enable`) и доступный
Postgres ([`docs/database.md`](database.md)).

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
yarn install
printf 'NODE_ENV=production\nDATABASE_URL=postgres://user:password@localhost:5432/vocab_bloom\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\nDICTIONARY_AUTO_IMPORT=true\n' > .env
yarn build && yarn start                       # API :3010, админка :3000; словарь загрузится сам при первом запуске
yarn site:build && yarn start:site             # сайт :3020, по желанию, в другом терминале
```

Домен и TLS, запуск под systemd или PM2: [`docs/deployment/`](deployment/README.md).

### Для разработки

База не нужна: без `DATABASE_URL` сервер использует локальный файл SQLite, а все приложения
перезапускаются при изменениях.

```bash
printf 'NODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\n' > .env
yarn dev                                       # API :3010, админка :3000, сайт :3020
```

> [!IMPORTANT]
> Загрузите словарь через _Import dictionary_ в админке.

Всё остальное для контрибьюторов: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### Дальше

- Документация в виде сайта, со справочником API и песочницей:
  [vocab-bloom-hub.com](https://vocab-bloom-hub.com/ru/docs).
- На сервер: [`docs/deployment/`](deployment/README.ru.md) — TLS и обратный прокси, systemd /
  PM2, обновления.
- База данных: [`docs/database.md`](database.md) — требования к Postgres, миграции, бэкапы,
  размер.
- Все настройки: [`docs/environment.md`](environment.ru.md).
- Метрики и логи: [`docs/observability.md`](observability.md) — Prometheus и Grafana одной
  командой или свои.
- Чтение данных: [`docs/api.md`](api.ru.md), SDK для [Node.js](../packages/npm-sdk/README.md)
  и [Python](../packages/python-sdk/README.md).

---

## 🤝 Участие в разработке

Вклад приветствуется. В [`CONTRIBUTING.md`](../CONTRIBUTING.md) — процесс (имена веток,
сообщения коммитов, чеклист PR), стек технологий и структура репозитория, все скрипты,
указатель документации и roadmap; [Кодекс поведения](../CODE_OF_CONDUCT.md) действует для
любого взаимодействия. Нашли баг или есть идея? Откройте
[issue](https://github.com/Fristail27/vocab-bloom-hub/issues/new/choose) — шаблоны подскажут.

---

## 📄 Лицензия

- **Код** — [MIT](../LICENSE) © Aleksei Ryzhov (Fristail27)
- **Данные словаря** (выгрузки, публичный API, датасет на HuggingFace) — [CC BY 4.0](../DATA_LICENSE.md): свободное использование и переработка, в том числе коммерческие, с указанием источника.

> [!IMPORTANT]
> Данные в основном сгенерированы LLM и не проверены людьми — см. [`data.md`](data.md), прежде чем
> на них полагаться.
