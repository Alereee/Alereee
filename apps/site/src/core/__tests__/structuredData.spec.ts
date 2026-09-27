import {
  breadcrumbJsonLd,
  DATA_LICENSE_URL,
  definedTermJsonLd,
  JsonLdT,
  softwareSourceCodeJsonLd,
  techArticleJsonLd,
  webSiteJsonLd,
} from '../structuredData';

// The JSON-LD of the pages (issue #480): every graph has the schema.org
// context, a type and absolute URLs, and the fields a rich result reads

const ABSOLUTE = /^http:\/\/localhost:3020\//;

const urlsIn = (value: unknown): string[] => {
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(urlsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(urlsIn);
  return [];
};

const isGraph = (value: JsonLdT, type: string) => {
  expect(value['@context']).toBe('https://schema.org');
  expect(value['@type']).toBe(type);
  expect(JSON.stringify(value)).not.toContain('undefined');
};

describe('structured data', () => {
  it('describes the site with its word search', () => {
    const graph = webSiteJsonLd({ locale: 'ru', description: 'Словарь' });

    isGraph(graph, 'WebSite');
    expect(graph).toMatchObject({ url: 'http://localhost:3020/ru', inLanguage: 'ru', description: 'Словарь' });
    const action = graph.potentialAction as { target: { urlTemplate: string }; 'query-input': string };
    expect(action.target.urlTemplate).toBe('http://localhost:3020/ru/word?q={search_term_string}');
    expect(action['query-input']).toBe('required name=search_term_string');
  });

  it('describes the project as source code with its repository and licence', () => {
    const graph = softwareSourceCodeJsonLd({ locale: 'en', description: 'A dictionary', version: '1.2.3' });

    isGraph(graph, 'SoftwareSourceCode');
    expect(graph).toMatchObject({
      codeRepository: 'https://github.com/Fristail27/vocab-bloom-hub',
      license: 'https://opensource.org/license/mit',
      version: '1.2.3',
      author: { '@type': 'Person' },
    });
  });

  it('numbers the breadcrumb from one, with absolute item URLs', () => {
    const graph = breadcrumbJsonLd('de', [
      { name: 'Dokumentation', path: '/docs' },
      { name: 'Docker', path: '/docs/deployment/docker' },
    ]);

    isGraph(graph, 'BreadcrumbList');
    expect(graph.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Dokumentation', item: 'http://localhost:3020/de/docs' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Docker',
        item: 'http://localhost:3020/de/docs/deployment/docker',
      },
    ]);
  });

  it('describes a docs page as a technical article in the language of its file', () => {
    const graph = techArticleJsonLd({
      locale: 'de',
      path: '/docs/operations',
      headline: 'Operations',
      inLanguage: 'en',
      dateModified: new Date('2026-09-01T10:00:00Z'),
    });

    isGraph(graph, 'TechArticle');
    expect(graph).toMatchObject({
      headline: 'Operations',
      url: 'http://localhost:3020/de/docs/operations',
      inLanguage: 'en',
      dateModified: '2026-09-01T10:00:00.000Z',
    });
    expect(graph).not.toHaveProperty('description');
  });

  it('describes a headword as a term of the licensed dictionary', () => {
    const graph = definedTermJsonLd({ locale: 'ru', word: 'give up', description: 'to stop trying' });

    isGraph(graph, 'DefinedTerm');
    expect(graph).toMatchObject({
      name: 'give up',
      termCode: 'give up',
      description: 'to stop trying',
      url: 'http://localhost:3020/ru/word/give%20up',
      inLanguage: 'en',
      inDefinedTermSet: {
        '@type': 'DefinedTermSet',
        url: 'http://localhost:3020/ru/word',
        license: DATA_LICENSE_URL,
        sameAs: 'https://huggingface.co/datasets/Fristail27/vocab-bloom-hub-en',
      },
    });
  });

  // issue #527: an instance may serve a dataset of another source
  it('names the license and the source of the dataset the instance serves', () => {
    const terms = {
      source: 'wiktionary',
      license: 'CC-BY-SA-4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: 'Wiktionary',
      attribution_url: 'https://en.wiktionary.org',
      notice: '',
    };

    expect(definedTermJsonLd({ locale: 'en', word: 'lamp', terms }).inDefinedTermSet).toMatchObject({
      license: 'https://creativecommons.org/licenses/by-sa/4.0/',
      sameAs: 'https://en.wiktionary.org',
    });

    const unnamed = definedTermJsonLd({
      locale: 'en',
      word: 'lamp',
      terms: { ...terms, source: 'custom', license: 'NOASSERTION', license_url: '', attribution_url: null },
    }).inDefinedTermSet;
    expect(unnamed).not.toHaveProperty('license');
    expect(unnamed).not.toHaveProperty('sameAs');
  });

  it('uses absolute URLs everywhere', () => {
    const graphs = [
      webSiteJsonLd({ locale: 'en', description: 'x' }),
      softwareSourceCodeJsonLd({ locale: 'en', description: 'x', version: '1' }),
      breadcrumbJsonLd('en', [{ name: 'Words', path: '/word' }]),
      techArticleJsonLd({
        locale: 'en',
        path: '/docs/api',
        headline: 'API',
        inLanguage: 'en',
        dateModified: new Date(0),
      }),
      definedTermJsonLd({ locale: 'en', word: 'run' }),
    ];
    for (const graph of graphs) {
      const own = urlsIn(graph).filter(
        (url) => !/github\.com|huggingface\.co|opensource\.org|creativecommons\.org|schema\.org/.test(url),
      );
      expect(own.length).toBeGreaterThan(0);
      for (const url of own) expect(url).toMatch(ABSOLUTE);
    }
  });
});
