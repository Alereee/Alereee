import { pythonLiteral } from '../literals';
import { pathArguments } from '../request';
import type { SnippetLanguageT, SnippetRequestT } from '../types';

/**
 * The typed Python client, `vocab-bloom-hub` on PyPI: one method per
 * endpoint, written by hand here because the method names are not in the
 * OpenAPI document. An endpoint without an entry shows no tab for this
 * language — add its snippet below, keyed by the endpoint's slug (the anchor
 * on the reference page: `get-words-word`, `post-words-batch`, …)
 */
const client = (origin: string): string[] => [
  'from vocab_bloom_hub import VocabBloomClient',
  '',
  `client = VocabBloomClient("${origin}")`,
];

const BY_SLUG: Record<string, (request: SnippetRequestT) => string> = {
  'get-meta': ({ origin }) =>
    [
      ...client(origin),
      'meta = client.meta()',
      'print(meta.data.available_languages, meta.data.counts.entries)',
    ].join('\n'),
  // a group per dataset of the instance, each under its own terms (issue #528)
  'get-words-word-datasets': (request) => {
    const [word] = pathArguments(request, '/api/v1/words/{word}/datasets');

    return [
      ...client(request.origin),
      `answer = client.word_datasets(${pythonLiteral(word)})`,
      'print(f"{answer.meta.found} of {answer.meta.datasets} datasets hold the word")',
      'for group in answer.data:',
      '    # the entries of a group are used under the terms of that group',
      '    print(group.dataset, group.license, group.attribution, len(group.entries))',
    ].join('\n');
  },
  'get-words-word-datasets-dataset-history': (request) => {
    const [word, dataset] = pathArguments(request, '/api/v1/words/{word}/datasets/{dataset}/history');

    return [
      ...client(request.origin),
      `history = client.dataset_history(${pythonLiteral(word)}, ${pythonLiteral(dataset)})`,
      'for change in history.data:',
      '    print(change.created_at, change.entity.value, change.action.value, change.diff)',
    ].join('\n');
  },
};

export const sdkPython: SnippetLanguageT = {
  id: 'sdk-python',
  label: 'Python SDK',
  highlight: 'python',
  render: (request) => BY_SLUG[request.slug]?.(request) ?? null,
};
