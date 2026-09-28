import fs from 'node:fs';
import path from 'node:path';

import { listEndpoints, OpenApiSpecT, PUBLIC_SPEC_FILE } from '../../openapi';
import { highlightLanguages } from '../../highlight';
import { buildSnippetRequest, SNIPPET_LANGUAGES, snippetsOf } from '../index';
import { jsLiteral, phpLiteral, pythonLiteral } from '../literals';

// The code snippets of the API reference: every language over
// every endpoint of the committed public document

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../../../..', PUBLIC_SPEC_FILE), 'utf8'),
) as OpenApiSpecT;
const BASE = 'https://x.example/api';

const endpoints = listEndpoints(spec);
const requests = endpoints.map((endpoint) => buildSnippetRequest(endpoint, BASE, spec));
const bySlug = (slug: string) => {
  const request = requests.find((item) => item.slug === slug);
  if (!request) throw new Error(`no endpoint ${slug}`);
  return request;
};
const render = (id: string, slug: string) => {
  const language = SNIPPET_LANGUAGES.find((item) => item.id === id);
  if (!language) throw new Error(`no language ${id}`);
  return language.render(bySlug(slug));
};

describe('the snippet request', () => {
  it('fills the sample path params in and carries the body of a write', () => {
    expect(bySlug('get-words-word-meanings')).toMatchObject({
      method: 'GET',
      url: 'https://x.example/api/v1/words/run/meanings',
      path: '/api/v1/words/run/meanings',
      origin: 'https://x.example',
      body: null,
    });
    expect(bySlug('post-suggestions').body).toEqual(expect.objectContaining({ headword: expect.any(String) }));
  });
});

describe('every language', () => {
  it('has a unique id and a highlight.js language this site registers', () => {
    const ids = SNIPPET_LANGUAGES.map((language) => language.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const language of SNIPPET_LANGUAGES) expect(highlightLanguages()).toContain(language.highlight);
  });

  it.each(SNIPPET_LANGUAGES.map((language) => [language.id, language]))(
    '%s renders every endpoint it claims with the URL in the code',
    (_id, language) => {
      let rendered = 0;
      for (const request of requests) {
        const code = language.render(request);
        if (code === null) continue;
        rendered += 1;
        expect(code).toContain(request.url.includes('x.example') ? 'x.example' : request.url);
        expect(code.trim()).toBe(code);
      }
      expect(rendered).toBeGreaterThan(0);
    },
  );

  it('the generated ones cover every endpoint; the SDK tabs only where a snippet is written', () => {
    for (const id of ['curl', 'javascript', 'python', 'go', 'php']) {
      for (const request of requests) expect(render(id, request.slug)).not.toBeNull();
    }
    expect(render('sdk-node', 'get-meta')).not.toBeNull();
    expect(render('sdk-python', 'get-meta')).not.toBeNull();
    expect(snippetsOf(bySlug('get-meta')).map((snippet) => snippet.id)).toEqual([
      'curl',
      'javascript',
      'python',
      'go',
      'php',
      'sdk-node',
      'sdk-python',
    ]);
    // the reads of every dataset have one in both SDKs (issue #528)
    for (const slug of ['get-words-word-datasets', 'get-words-word-datasets-dataset-history']) {
      expect(snippetsOf(bySlug(slug)).map((snippet) => snippet.id)).toEqual(
        expect.arrayContaining(['sdk-node', 'sdk-python']),
      );
    }
    expect(render('sdk-node', 'get-words-word')).toBeNull();
    // the first tab is curl everywhere: a reader without a choice yet sees it
    for (const request of requests) expect(snippetsOf(request)[0].id).toBe('curl');
  });
});

describe('the exact text', () => {
  it('curl: a bare GET, a POST with the JSON body', () => {
    expect(render('curl', 'get-words-word-meanings')).toBe(
      "curl 'https://x.example/api/v1/words/run/meanings'",
    );
    expect(render('curl', 'post-words-batch')).toBe(
      "curl -X POST 'https://x.example/api/v1/words/batch' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"words\":[\"example\"]}'",
    );
  });

  it('JavaScript: fetch with a JSON body on a write', () => {
    expect(render('javascript', 'get-meta')).toBe(
      [
        "const res = await fetch('https://x.example/api/v1/meta');",
        'if (!res.ok) throw new Error(`HTTP ${res.status}`);',
        'const answer = await res.json();',
      ].join('\n'),
    );
    expect(render('javascript', 'post-words-batch')).toContain(
      "  body: JSON.stringify({\n    words: ['example']\n  }),",
    );
  });

  it('Python: requests with json= on a write', () => {
    expect(render('python', 'get-meta')).toBe(
      [
        'import requests',
        '',
        'res = requests.get("https://x.example/api/v1/meta")',
        'res.raise_for_status()',
        'answer = res.json()',
      ].join('\n'),
    );
    expect(render('python', 'post-words-batch')).toContain(
      'requests.post("https://x.example/api/v1/words/batch", json={\n  "words": ["example"]\n})',
    );
  });

  it('Go and PHP: the standard clients', () => {
    expect(render('go', 'get-meta')).toContain('resp, err := http.Get("https://x.example/api/v1/meta")');
    expect(render('go', 'post-words-batch')).toContain(
      'http.Post("https://x.example/api/v1/words/batch", "application/json", strings.NewReader(`{"words":["example"]}`))',
    );
    expect(render('php', 'get-meta')).toContain("$ch = curl_init('https://x.example/api/v1/meta');");
    expect(render('php', 'post-words-batch')).toContain(
      "CURLOPT_POSTFIELDS => json_encode([\n      'words' => ['example']\n    ]),",
    );
  });

  it('the SDK tabs of the first endpoint use the origin as base URL', () => {
    expect(render('sdk-node', 'get-meta')).toContain("new VocabBloomClient({ baseUrl: 'https://x.example' })");
    expect(render('sdk-python', 'get-meta')).toContain('VocabBloomClient("https://x.example")');
  });
});

describe('the SDK snippets of the reads of every dataset (issue #528)', () => {
  it('Node.js: the methods of the client with the sample values of the path', () => {
    expect(render('sdk-node', 'get-words-word-datasets')).toBe(
      [
        "import { VocabBloomClient } from '@vocab-bloom-hub/client';",
        '',
        "const client = new VocabBloomClient({ baseUrl: 'https://x.example' });",
        "const { data, meta } = await client.wordDatasets('run');",
        'console.log(`${meta.found} of ${meta.datasets} datasets hold the word`);',
        'for (const group of data) {',
        '  // the entries of a group are used under the terms of that group',
        '  console.log(group.dataset, group.license, group.attribution, group.entries.length);',
        '}',
      ].join('\n'),
    );
    expect(render('sdk-node', 'get-words-word-datasets-dataset-history')).toContain(
      "await client.datasetHistory('run', 'default');",
    );
  });

  it('Python: the same reads', () => {
    expect(render('sdk-python', 'get-words-word-datasets')).toBe(
      [
        'from vocab_bloom_hub import VocabBloomClient',
        '',
        'client = VocabBloomClient("https://x.example")',
        'answer = client.word_datasets("run")',
        'print(f"{answer.meta.found} of {answer.meta.datasets} datasets hold the word")',
        'for group in answer.data:',
        '    # the entries of a group are used under the terms of that group',
        '    print(group.dataset, group.license, group.attribution, len(group.entries))',
      ].join('\n'),
    );
    expect(render('sdk-python', 'get-words-word-datasets-dataset-history')).toContain(
      'client.dataset_history("run", "default")',
    );
  });

  it('name only methods the clients have', () => {
    const node = fs.readFileSync(
      path.join(__dirname, '../../../../../..', 'packages/npm-sdk/src/client.ts'),
      'utf8',
    );
    const python = fs.readFileSync(
      path.join(__dirname, '../../../../../..', 'packages/python-sdk/src/vocab_bloom_hub/client.py'),
      'utf8',
    );
    for (const method of ['wordDatasets', 'datasetHistory']) expect(node).toContain(`  ${method}(`);
    for (const method of ['word_datasets', 'dataset_history']) expect(python).toContain(`def ${method}(`);
  });
});

describe('the literals', () => {
  it('escape the backslash and the quote of a string, in that order', () => {
    const tricky = "it's a \\ path";
    expect(jsLiteral(tricky)).toBe("'it\\'s a \\\\ path'");
    expect(phpLiteral(tricky)).toBe("'it\\'s a \\\\ path'");
    expect(pythonLiteral('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
  });

  it('write a body the way each language does', () => {
    const body = { search: 'run', with_meanings: true, limit: 5, level: ['A1'], note: null };
    expect(jsLiteral(body)).toBe(
      "{\n  search: 'run',\n  with_meanings: true,\n  limit: 5,\n  level: ['A1'],\n  note: null\n}",
    );
    expect(pythonLiteral(body)).toBe(
      '{\n  "search": "run",\n  "with_meanings": True,\n  "limit": 5,\n  "level": ["A1"],\n  "note": None\n}',
    );
    expect(phpLiteral(body)).toBe(
      "[\n  'search' => 'run',\n  'with_meanings' => true,\n  'limit' => 5,\n  'level' => ['A1'],\n  'note' => null\n]",
    );
  });
});
