import { EndpointT, jsonSchemaOf, OpenApiSpecT, refName, sampleBody, sampleValue } from '../openapi';
import type { SnippetRequestT } from './types';

/** The request of an endpoint as the snippets see it: sample path params filled in, a body of the required fields */
export const buildSnippetRequest = (
  endpoint: EndpointT,
  baseUrl: string,
  spec: OpenApiSpecT,
): SnippetRequestT => {
  const { operation } = endpoint;
  let path = endpoint.path;
  for (const param of operation.parameters ?? []) {
    if (param.in === 'path') {
      path = path.replace(
        `{${param.name}}`,
        encodeURIComponent(String(sampleValue(param.schema, param.name, spec))),
      );
    }
  }
  const origin = baseUrl.replace(/\/api\/?$/, '');

  const bodySchema = jsonSchemaOf(operation.requestBody?.content);
  const resolved = bodySchema?.$ref ? spec.components.schemas[refName(bodySchema.$ref)] : bodySchema;

  return {
    method: endpoint.method,
    url: `${origin}${path}`,
    path,
    origin,
    body: resolved ? sampleBody(resolved, spec) : null,
    slug: endpoint.slug,
  };
};

/**
 * The sample values of the path of a request, in the order of the path:
 * `/api/v1/words/run/datasets/default/history` names `run` and `default`.
 * For the snippets written by hand, which pass them as arguments
 */
export const pathArguments = (request: SnippetRequestT, template: string): string[] => {
  const values = request.path.split('/');

  return template
    .split('/')
    .map((segment, index) => (segment.startsWith('{') ? decodeURIComponent(values[index] ?? '') : null))
    .filter((value): value is string => value !== null);
};
