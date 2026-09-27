import { InterfaceLanguageEnum } from '@/types/common';

export enum DocSectionE {
  start = 'start',
  deployment = 'deployment',
  database = 'database',
  operations = 'operations',
  api = 'api',
  sdk = 'sdk',
  data = 'data',
  project = 'project',
}

export type DocPageT = {
  /** Route segment(s) under /docs */
  slug: string;
  /** The Markdown file, relative to the repository root */
  file: string;
  /**
   * The translated versions of the page the repository has, by locale
   * (`<name>.<lang>.md` next to the English file; the README's live under docs/)
   */
  translations?: Partial<Record<Exclude<InterfaceLanguageEnum, InterfaceLanguageEnum.en>, string>>;
  /**
   * Render one level-2 section of the file instead of the whole file: the
   * heading that starts it, matched against the raw Markdown line — the same
   * pattern must hit in every translation (`content/sections.ts`)
   */
  extract?: RegExp;
  section: DocSectionE;
  title: string;
  titleRu: string;
};

// The documentation of the repository, one page per Markdown file. Order is
// the order in the sidebar
export const DOC_PAGES: DocPageT[] = [
  // the README's getting-started section (⚡ in every language), not the whole README
  {
    slug: 'getting-started',
    file: 'README.md',
    extract: /^## ⚡ /,
    translations: {
      [InterfaceLanguageEnum.ru]: 'docs/README.ru.md',
      [InterfaceLanguageEnum.es]: 'docs/README.es.md',
      [InterfaceLanguageEnum.fr]: 'docs/README.fr.md',
      [InterfaceLanguageEnum.pt]: 'docs/README.pt.md',
      [InterfaceLanguageEnum.de]: 'docs/README.de.md',
      [InterfaceLanguageEnum.zh]: 'docs/README.zh.md',
      [InterfaceLanguageEnum.ar]: 'docs/README.ar.md',
    },
    section: DocSectionE.start,
    title: 'Getting started',
    titleRu: 'Быстрый старт',
  },
  {
    slug: 'deployment',
    file: 'docs/deployment/README.md',
    translations: { [InterfaceLanguageEnum.ru]: 'docs/deployment/README.ru.md' },
    section: DocSectionE.deployment,
    title: 'Deployment',
    titleRu: 'Развёртывание',
  },
  {
    slug: 'deployment/docker',
    file: 'docs/deployment/docker.md',
    section: DocSectionE.deployment,
    title: 'Docker',
    titleRu: 'Docker',
  },
  {
    slug: 'deployment/reverse-proxy',
    file: 'docs/deployment/reverse-proxy.md',
    section: DocSectionE.deployment,
    title: 'Reverse proxy',
    titleRu: 'Reverse proxy',
  },
  {
    slug: 'deployment/vps',
    file: 'docs/deployment/vps.md',
    section: DocSectionE.deployment,
    title: 'A VPS from a git checkout',
    titleRu: 'VPS из git-чекаута',
  },
  {
    slug: 'environment',
    file: 'docs/environment.md',
    translations: { [InterfaceLanguageEnum.ru]: 'docs/environment.ru.md' },
    section: DocSectionE.deployment,
    title: 'Environment variables',
    titleRu: 'Переменные окружения',
  },
  {
    slug: 'operations',
    file: 'docs/operations.md',
    section: DocSectionE.operations,
    title: 'Operations',
    titleRu: 'Эксплуатация',
  },
  {
    slug: 'upgrading',
    file: 'docs/upgrading.md',
    section: DocSectionE.operations,
    title: 'Upgrading',
    titleRu: 'Обновление',
  },
  {
    slug: 'database',
    file: 'docs/database.md',
    section: DocSectionE.database,
    title: 'Database',
    titleRu: 'База данных',
  },
  {
    slug: 'migrations',
    file: 'docs/migrations.md',
    section: DocSectionE.database,
    title: 'Migrations',
    titleRu: 'Миграции',
  },
  {
    slug: 'observability',
    file: 'docs/observability.md',
    section: DocSectionE.operations,
    title: 'Observability',
    titleRu: 'Наблюдаемость',
  },
  {
    slug: 'performance',
    file: 'docs/performance.md',
    section: DocSectionE.operations,
    title: 'Performance',
    titleRu: 'Производительность',
  },
  {
    slug: 'offline-import',
    file: 'docs/offline-import.md',
    section: DocSectionE.operations,
    title: 'Offline import',
    titleRu: 'Офлайн-импорт',
  },
  {
    slug: 'api',
    file: 'docs/api.md',
    translations: { [InterfaceLanguageEnum.ru]: 'docs/api.ru.md' },
    section: DocSectionE.api,
    title: 'API surfaces',
    titleRu: 'Устройство API',
  },
  {
    slug: 'api-tools',
    file: 'docs/api-tools.md',
    section: DocSectionE.api,
    title: 'Swagger and the API docs',
    titleRu: 'Swagger и документация API',
  },
  {
    slug: 'authentication',
    file: 'docs/authentication.md',
    section: DocSectionE.api,
    title: 'Authentication',
    titleRu: 'Аутентификация',
  },
  {
    slug: 'sdk/node',
    file: 'packages/npm-sdk/README.md',
    section: DocSectionE.sdk,
    title: 'Node.js SDK',
    titleRu: 'Node.js SDK',
  },
  {
    slug: 'sdk/python',
    file: 'packages/python-sdk/README.md',
    section: DocSectionE.sdk,
    title: 'Python SDK',
    titleRu: 'Python SDK',
  },
  {
    slug: 'data',
    file: 'docs/data.md',
    section: DocSectionE.data,
    title: 'The data',
    titleRu: 'Данные',
  },
  // several datasets per instance and the converters of the public sources (issue #527)
  {
    slug: 'datasets',
    file: 'docs/datasets.md',
    section: DocSectionE.data,
    title: 'Datasets',
    titleRu: 'Датасеты',
  },
  {
    slug: 'datasets/converters',
    file: 'apps/server/src/converters/README.md',
    section: DocSectionE.data,
    title: 'Converters of public sources',
    titleRu: 'Конвертеры открытых источников',
  },
  {
    slug: 'data-license',
    file: 'DATA_LICENSE.md',
    section: DocSectionE.data,
    title: 'Data license',
    titleRu: 'Лицензия данных',
  },
  {
    slug: 'contributing',
    file: 'CONTRIBUTING.md',
    section: DocSectionE.project,
    title: 'Contributing',
    titleRu: 'Участие в разработке',
  },
  {
    slug: 'security',
    file: 'SECURITY.md',
    section: DocSectionE.project,
    title: 'Security policy',
    titleRu: 'Политика безопасности',
  },
  // the curated release notes (issue #404): every tagged release has a page
  // on the site, and a link to CHANGELOG.md from any documented file lands here
  {
    slug: 'changelog',
    file: 'CHANGELOG.md',
    section: DocSectionE.project,
    title: 'Release notes',
    titleRu: 'История версий',
  },
];

export const DOC_SECTIONS: DocSectionE[] = Object.values(DocSectionE);

export const findDocBySlug = (slug: string): DocPageT | undefined =>
  DOC_PAGES.find((page) => page.slug === slug);

/** The page rendered from a repository file, for rewriting the links between the Markdown files */
export const slugForFile = (file: string): string | undefined =>
  DOC_PAGES.find((page) => page.file === file || Object.values(page.translations ?? {}).includes(file))?.slug;

export const docTitle = (page: DocPageT, locale: InterfaceLanguageEnum): string =>
  locale === InterfaceLanguageEnum.ru ? page.titleRu : page.title;

/**
 * The locales a page really exists in: English and the translations the
 * repository has. The other locales render the English file — canonicalized
 * to the English URL and left out of the sitemap (issue #480)
 */
export const docLocales = (page: DocPageT): InterfaceLanguageEnum[] => [
  InterfaceLanguageEnum.en,
  ...(Object.keys(page.translations ?? {}) as InterfaceLanguageEnum[]),
];

/** The translated file of a page in a locale, when the repository has one */
export const translatedDocFile = (page: DocPageT, locale: InterfaceLanguageEnum): string | undefined =>
  locale === InterfaceLanguageEnum.en ? undefined : page.translations?.[locale];

/** The file a page is rendered from in a locale: its translation when there is one, else the English file */
export const docFile = (page: DocPageT, locale: InterfaceLanguageEnum): string =>
  translatedDocFile(page, locale) ?? page.file;
