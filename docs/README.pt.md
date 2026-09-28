<p align="center">
  <img src="../.github/assets/main-readme-logo.svg" alt="Логотип Vocab Bloom Hub" />
</p>

<h1 align="center">Vocab Bloom Hub</h1>

<p align="center">
  Um dicionário de inglês auto-hospedado: 300 000 verbetes com sentidos, exemplos, formas, traduções e ligações entre palavras atrás de uma API pública, uma interface de administração, dois SDKs, um site e um dataset aberto.
</p>

<p align="center">
  <a href="https://vocab-bloom-hub.com/pt"><strong>vocab-bloom-hub.com</strong></a> ·
  <a href="https://vocab-bloom-hub.com/pt/docs">Documentação</a> ·
  <a href="https://vocab-bloom-hub.com/pt/api">Referência da API</a> ·
  <a href="https://vocab-bloom-hub.com/pt/playground">Playground</a>
</p>

<p align="center">
  <a href="../README.md">🇺🇸 EN</a> | <a href="README.ru.md">🇷🇺 RU</a> | <a href="README.es.md">🇪🇸 ES</a> | <a href="README.fr.md">🇫🇷 FR</a> | <strong>🇵🇹 PT</strong> | <a href="README.de.md">🇩🇪 DE</a> | <a href="README.zh.md">🇨🇳 ZH</a> | <a href="README.ar.md">🌐 AR</a>
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

## 📖 O que é

Um servidor de dicionário que você executa por conta própria. Vem com os dados, uma API para
lê-los, um painel de administração para editá-los e SDKs para construir em cima.

**O dicionário**

- 89 000 palavras e 26 000 expressões em inglês, 161 000 sentidos com definições e exemplos
- transcrição IPA, nível CEFR, marcas de registro e de domínio, formas flexionadas
- ligações de sinônimos e antônimos entre verbetes, verbos frasais ligados ao seu verbo base
- traduções para russo, espanhol, francês, alemão, português, chinês e árabe
- dados abertos: [CC BY 4.0](../DATA_LICENSE.md), publicados no HuggingFace, carregados em uma
  instância vazia na primeira inicialização; gerados por modelos de linguagem, sem verificação humana

**A API** — `/api/v1`, somente leitura, sem chaves

- busca com camadas de relevância e tolerância a erros de digitação; um verbete com tudo que está ligado a ele
- listas filtradas com paginação por cursor, um verbete aleatório, uma consulta em lote de até 50 palavras
- limite de requisições por cliente, cada resposta em cache com ETag, um documento OpenAPI para gerar clientes

**Os SDKs** — gerados a partir desse documento OpenAPI

- Node.js / TypeScript: `npm install @vocab-bloom-hub/client`
- Python: `pip install vocab-bloom-hub` (síncrono, assíncrono, um auxiliar para pandas)

**O painel de administração** — oito idiomas de interface

- editar palavras, sentidos, traduções e ligações; cada alteração fica em um histórico com os
  valores antes e depois, visível para os leitores e reversível com um clique
- moderar as correções que os leitores enviam das páginas de palavras
- disparar requisições em massa a um modelo de linguagem sobre um recorte filtrado do dicionário
- importar e exportar o dicionário inteiro como dataset, online ou a partir de um arquivo

**O site** — a documentação, a referência da API, um playground, páginas públicas de palavras

**Por baixo** — PostgreSQL (SQLite para desenvolvimento), imagens Docker, migrações na
inicialização, sondas de saúde, métricas Prometheus, logs JSON.

> [!NOTE]
> Status: `1.0`, versão estável: a API pública em `/api/v1` segue o versionamento semântico; uma mudança incompatível implica uma nova versão principal.

---

## ⚡ Primeiros passos

Três caminhos, do mais rápido ao mais flexível. Todos terminam com o painel de administração,
a API e o dicionário carregado: com Docker em <http://localhost:3241> e
<http://localhost:3240>, sem ele em <http://localhost:3000> e <http://localhost:3010>.

### 1. Rodar as imagens publicadas

Sem clonar nada — uma pasta, dois arquivos, Docker:

```bash
mkdir vocab-bloom-hub && cd vocab-bloom-hub
curl -fsSLO https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/.env.example -o .env
```

Abra o `.env` e defina duas senhas: `ADMIN_PASSWORD` (o login de administração) e
`POSTGRES_PASSWORD` (o banco incluído). Depois:

```bash
docker compose up -d
```

A primeira inicialização baixa o dicionário e o importa — alguns minutos. `GET /api/ready`
responde `503` enquanto isso e `200` ao terminar; então entre com `ADMIN_USERNAME` /
`ADMIN_PASSWORD` do `.env`.

```bash
curl -s localhost:3240/api/ready            # {"status":"ok"}
curl -s localhost:3240/api/v1/words/run     # o dicionário responde

# busca: os verbetes correspondentes, o melhor primeiro
curl -s 'localhost:3240/api/v1/search?search=run&limit=5'
# o mesmo com significados, exemplos e traduções
curl -s 'localhost:3240/api/v1/search/detailed?search=run&with_meanings=true'
```

> [!TIP]
> Para fixar uma versão em vez da build `main`, defina `VBH_TAG=1.0.0` no `.env`. Para
> adicionar o site (documentação, referência da API, playground, páginas de palavras) em
> <http://localhost:3242>, defina `COMPOSE_PROFILES=db,site`.

### 2. Rodar a partir do repositório

O mesmo arquivo compose, construído a partir das fontes — para um fork ou uma alteração não
publicada:

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
cp .env.example .env                           # as mesmas duas senhas
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 3. Rodar sem Docker

Uma execução de produção na própria máquina: Node.js 22.13+, Yarn 4 (`corepack enable`) e um
Postgres acessível ([`docs/database.md`](database.md)).

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
yarn install
printf 'NODE_ENV=production\nDATABASE_URL=postgres://user:password@localhost:5432/vocab_bloom\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\nDICTIONARY_AUTO_IMPORT=true\n' > .env
yarn build && yarn start                       # API :3010, administração :3000; o dicionário carrega sozinho no primeiro arranque
yarn site:build && yarn start:site             # o site :3020, opcional, em outro terminal
```

Atrás de um domínio e TLS, com systemd ou PM2: [`docs/deployment/`](deployment/README.md).

### Para desenvolvimento

Não precisa de banco de dados: sem `DATABASE_URL` o servidor usa um arquivo SQLite local, e cada
aplicação reinicia ao mudar.

```bash
printf 'NODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\n' > .env
yarn dev                                       # API :3010, administração :3000, site :3020
```

> [!IMPORTANT]
> Carregue o dicionário com _Import dictionary_ no painel de administração.

Todo o resto para contribuidores: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### A seguir

- A documentação como site, com a referência da API e um playground:
  [vocab-bloom-hub.com](https://vocab-bloom-hub.com/pt/docs).
- Colocar em um servidor: [`docs/deployment/`](deployment/README.md) — TLS e proxy reverso,
  systemd / PM2, atualizações.
- O banco de dados: [`docs/database.md`](database.md) — requisitos do Postgres, migrações,
  backups, tamanho.
- Todas as configurações: [`docs/environment.md`](environment.md).
- Métricas e logs: [`docs/observability.md`](observability.md) — Prometheus e Grafana com um
  comando, ou os seus.
- Ler os dados: [`docs/api.md`](api.md), os SDKs de [Node.js](../packages/npm-sdk/README.md) e
  [Python](../packages/python-sdk/README.md).

---

## 🤝 Contribuir

Contribuições são bem-vindas. O [`CONTRIBUTING.md`](../CONTRIBUTING.md) tem o fluxo de trabalho
(nomes de branches, mensagens de commit, o checklist de PR), a stack tecnológica e a estrutura
do repositório, todos os scripts, o índice da documentação e o roadmap; o
[Código de conduta](../CODE_OF_CONDUCT.md) vale para toda interação. Encontrou um bug ou tem uma
ideia? Abra uma [issue](https://github.com/Fristail27/vocab-bloom-hub/issues/new/choose) — os
modelos orientam você.

---

## 📄 Licença

- **Código** — [MIT](../LICENSE) © Aleksei Ryzhov (Fristail27)
- **Dados do dicionário** (exportações, a API pública, o dataset no HuggingFace) — [CC BY 4.0](../DATA_LICENSE.md): livres para usar e adaptar, inclusive comercialmente, com atribuição.

> [!IMPORTANT]
> Os dados são em grande parte gerados por LLM e não verificados por pessoas — leia
> [`data.md`](data.md) antes de confiar neles.
