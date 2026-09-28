<p align="center">
  <img src="../.github/assets/main-readme-logo.svg" alt="Логотип Vocab Bloom Hub" />
</p>

<h1 align="center">Vocab Bloom Hub</h1>

<p align="center">
  Un diccionario de inglés autoalojado: 300 000 entradas con acepciones, ejemplos, formas, traducciones y enlaces entre palabras detrás de una API pública, una interfaz de administración, dos SDK, un sitio web y un dataset abierto.
</p>

<p align="center">
  <a href="https://vocab-bloom-hub.com/es"><strong>vocab-bloom-hub.com</strong></a> ·
  <a href="https://vocab-bloom-hub.com/es/docs">Documentación</a> ·
  <a href="https://vocab-bloom-hub.com/es/api">Referencia de la API</a> ·
  <a href="https://vocab-bloom-hub.com/es/playground">Playground</a>
</p>

<p align="center">
  <a href="../README.md">🇺🇸 EN</a> | <a href="README.ru.md">🇷🇺 RU</a> | <strong>🇪🇸 ES</strong> | <a href="README.fr.md">🇫🇷 FR</a> | <a href="README.pt.md">🇵🇹 PT</a> | <a href="README.de.md">🇩🇪 DE</a> | <a href="README.zh.md">🇨🇳 ZH</a> | <a href="README.ar.md">🌐 AR</a>
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

## 📖 Qué es

Un servidor de diccionario que ejecutas tú mismo. Trae los datos, una API para leerlos, un
panel de administración para editarlos y SDK para construir encima.

**El diccionario**

- 89 000 palabras y 26 000 frases en inglés, 161 000 acepciones con definiciones y ejemplos
- transcripción IPA, nivel CEFR, marcas de registro y de ámbito, formas flexionadas
- enlaces de sinónimos y antónimos entre lemas, verbos frasales enlazados a su verbo base
- traducciones al ruso, español, francés, alemán, portugués, chino y árabe
- datos abiertos: [CC BY 4.0](../DATA_LICENSE.md), publicados en HuggingFace, cargados en una
  instancia vacía en el primer arranque; generados con modelos de lenguaje, sin verificación humana

**La API** — `/api/v1`, solo lectura, sin claves

- búsqueda con niveles de relevancia y tolerancia a erratas; un lema con todo lo que lleva
- listas filtradas con paginación por cursor, una entrada aleatoria, una consulta por lotes de hasta 50 palabras
- límite de peticiones por cliente, cada respuesta cacheada con ETag, un documento OpenAPI para generar clientes

**Los SDK** — generados a partir de ese documento OpenAPI

- Node.js / TypeScript: `npm install @vocab-bloom-hub/client`
- Python: `pip install vocab-bloom-hub` (síncrono, asíncrono, un ayudante para pandas)

**El panel de administración** — ocho idiomas de interfaz

- editar palabras, acepciones, traducciones y enlaces; cada cambio queda en un historial con los
  valores anteriores y posteriores, visible para los lectores y reversible con un clic
- moderar las correcciones que los lectores envían desde las páginas de palabras
- lanzar peticiones masivas a un modelo de lenguaje sobre un corte filtrado del diccionario
- importar y exportar el diccionario entero como dataset, en línea o desde un archivo

**El sitio web** — la documentación, la referencia de la API, un playground, páginas públicas de palabras

**Por debajo** — PostgreSQL (SQLite para desarrollo), imágenes Docker, migraciones al arrancar,
sondas de salud, métricas Prometheus, logs JSON.

> [!NOTE]
> Estado: `1.0`, versión estable: la API pública bajo `/api/v1` sigue el versionado semántico; un cambio incompatible implica una nueva versión mayor.

---

## ⚡ Primeros pasos

Tres caminos, del más rápido al más flexible. Todos terminan con el panel de administración,
la API y el diccionario cargado: con Docker en <http://localhost:3241> y
<http://localhost:3240>, sin él en <http://localhost:3000> y <http://localhost:3010>.

### 1. Ejecutar las imágenes publicadas

Sin clonar nada: una carpeta, dos archivos, Docker:

```bash
mkdir vocab-bloom-hub && cd vocab-bloom-hub
curl -fsSLO https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/.env.example -o .env
```

Abre `.env` y define dos contraseñas: `ADMIN_PASSWORD` (el acceso de administración) y
`POSTGRES_PASSWORD` (la base de datos incluida). Después:

```bash
docker compose up -d
```

El primer arranque descarga el diccionario y lo importa: unos minutos. `GET /api/ready`
responde `503` mientras tanto y `200` cuando termina; entonces inicia sesión con
`ADMIN_USERNAME` / `ADMIN_PASSWORD` del `.env`.

```bash
curl -s localhost:3240/api/ready            # {"status":"ok"}
curl -s localhost:3240/api/v1/words/run     # el diccionario responde

# búsqueda: las entradas que coinciden, la mejor primero
curl -s 'localhost:3240/api/v1/search?search=run&limit=5'
# lo mismo con significados, ejemplos y traducciones
curl -s 'localhost:3240/api/v1/search/detailed?search=run&with_meanings=true'
```

> [!TIP]
> Para fijar una versión en lugar de la compilación `main`, pon `VBH_TAG=1.0.0` en `.env`.
> Para añadir el sitio web (documentación, referencia de la API, playground, páginas de palabras)
> en <http://localhost:3242>, pon `COMPOSE_PROFILES=db,site`.

### 2. Ejecutar desde el repositorio

El mismo archivo compose, construido desde las fuentes, para un fork o un cambio no publicado:

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
cp .env.example .env                           # las mismas dos contraseñas
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 3. Ejecutar sin Docker

Una ejecución de producción en la propia máquina: Node.js 22.13+, Yarn 4 (`corepack enable`) y
un Postgres accesible ([`docs/database.md`](database.md)).

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
yarn install
printf 'NODE_ENV=production\nDATABASE_URL=postgres://user:password@localhost:5432/vocab_bloom\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\nDICTIONARY_AUTO_IMPORT=true\n' > .env
yarn build && yarn start                       # API :3010, administración :3000; el diccionario se carga solo en el primer arranque
yarn site:build && yarn start:site             # el sitio :3020, opcional, en otra terminal
```

Detrás de un dominio y TLS, con systemd o PM2: [`docs/deployment/`](deployment/README.md).

### Para desarrollo

No hace falta base de datos: sin `DATABASE_URL` el servidor usa un archivo SQLite local, y cada
aplicación se reinicia al cambiar.

```bash
printf 'NODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\n' > .env
yarn dev                                       # API :3010, administración :3000, sitio :3020
```

> [!IMPORTANT]
> Carga el diccionario con _Import dictionary_ en el panel de administración.

Todo lo demás para contribuir: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### Siguiente

- La documentación como sitio web, con la referencia de la API y un playground:
  [vocab-bloom-hub.com](https://vocab-bloom-hub.com/es/docs).
- Ponerlo en un servidor: [`docs/deployment/`](deployment/README.md) — TLS y proxy inverso,
  systemd / PM2, actualizaciones.
- La base de datos: [`docs/database.md`](database.md) — requisitos de Postgres, migraciones,
  copias de seguridad, tamaño.
- Todos los ajustes: [`docs/environment.md`](environment.md).
- Métricas y logs: [`docs/observability.md`](observability.md) — Prometheus y Grafana con un
  comando, o los tuyos.
- Leer los datos: [`docs/api.md`](api.md), los SDK de [Node.js](../packages/npm-sdk/README.md)
  y [Python](../packages/python-sdk/README.md).

---

## 🤝 Contribuir

Las contribuciones son bienvenidas. [`CONTRIBUTING.md`](../CONTRIBUTING.md) tiene el flujo de
trabajo (nombres de ramas, mensajes de commit, la lista de comprobación de PR), la pila
tecnológica y la estructura del repositorio, todos los scripts, el índice de la documentación y
la hoja de ruta; el [Código de conducta](../CODE_OF_CONDUCT.md) se aplica a toda interacción.
¿Has encontrado un error o tienes una idea? Abre un
[issue](https://github.com/Fristail27/vocab-bloom-hub/issues/new/choose): las plantillas te guían.

---

## 📄 Licencia

- **Código**: [MIT](../LICENSE) © Aleksei Ryzhov (Fristail27)
- **Datos del diccionario** (exportaciones, la API pública, el dataset de HuggingFace): [CC BY 4.0](../DATA_LICENSE.md): libres de usar y adaptar, también comercialmente, con atribución.

> [!IMPORTANT]
> Los datos son en gran parte generados por LLM y no verificados por personas; consulta
> [`data.md`](data.md) antes de confiar en ellos.
