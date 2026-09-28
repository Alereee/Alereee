import { jsLiteral } from '../literals';
import { pathArguments } from '../request';
import type { SnippetLanguageT, SnippetRequestT } from '../types';

/**
 * The typed Node.js / browser client, `@vocab-bloom-hub/client`: one method
 * per endpoint, written by hand here because the method names are not in the
 * OpenAPI document. An endpoint without an entry shows no tab for this
 * language — add its snippet below, keyed by the endpoint's slug (the anchor
 * on the reference page: `get-words-word`, `post-words-batch`, …)
 */
const client = (origin: string): string[] => [
  `import { VocabBloomClient } from '@vocab-bloom-hub/client';`,
  '',
  `const client = new VocabBloomClient({ baseUrl: '${origin}' });`,
];

const BY_SLUG: Record<string, (request: SnippetRequestT) => string> = {
  'get-meta': ({ origin }) =>
    [
      ...client(origin),
      'const { data } = await client.meta();',
      'console.log(data.available_languages, data.counts.entries);',
    ].join('\n'),
  // a group per dataset of the instance, each under its own terms (issue #528)
  'get-words-word-datasets': (request) => {
    const [word] = pathArguments(request, '/api/v1/words/{word}/datasets');

    return [
      ...client(request.origin),
      `const { data, meta } = await client.wordDatasets(${jsLiteral(word)});`,
      'console.log(`${meta.found} of ${meta.datasets} datasets hold the word`);',
      'for (const group of data) {',
      '  // the entries of a group are used under the terms of that group',
      '  console.log(group.dataset, group.license, group.attribution, group.entries.length);',
      '}',
    ].join('\n');
  },
  'get-words-word-datasets-dataset-history': (request) => {
    const [word, dataset] = pathArguments(request, '/api/v1/words/{word}/datasets/{dataset}/history');

    return [
      ...client(request.origin),
      `const { data } = await client.datasetHistory(${jsLiteral(word)}, ${jsLiteral(dataset)});`,
      'for (const change of data) {',
      '  console.log(change.created_at, change.entity, change.action, change.diff);',
      '}',
    ].join('\n');
  },
};

export const sdkNode: SnippetLanguageT = {
  id: 'sdk-node',
  label: 'Node.js SDK',
  highlight: 'typescript',
  render: (request) => BY_SLUG[request.slug]?.(request) ?? null,
};
