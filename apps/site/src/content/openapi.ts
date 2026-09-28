// Pure helpers over the public OpenAPI document: shared by the build-time
// pages and the browser (the playground), so nothing here touches the file
// system — loadPublicSpec lives in openapi.load.ts

/** The subset of OpenAPI 3.0 the public document uses (apps/server/openapi/public-v1.json) */
export type SchemaT = {
  type?: string;
  format?: string;
  enum?: string[];
  items?: SchemaT;
  $ref?: string;
  allOf?: SchemaT[];
  nullable?: boolean;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, SchemaT>;
  required?: string[];
};

export type ParameterT = {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema: SchemaT;
};

export type MediaT = Record<string, { schema: SchemaT }>;

export type ResponseT = { description: string; content?: MediaT };

export type OperationT = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterT[];
  requestBody?: { required?: boolean; content: MediaT };
  responses: Record<string, ResponseT>;
};

export type HttpMethodT = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type OpenApiSpecT = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Partial<Record<Lowercase<HttpMethodT>, OperationT>>>;
  components: { schemas: Record<string, SchemaT> };
};

export type EndpointT = {
  method: HttpMethodT;
  path: string;
  /** Anchor / route segment: `get-words-word-meanings` */
  slug: string;
  operation: OperationT;
};

export const PUBLIC_SPEC_FILE = 'apps/server/openapi/public-v1.json';

export const endpointSlug = (method: string, path: string): string => {
  const rest = path
    .replace(/^\/api\/v1\/?/, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '');

  return `${method}-${rest || 'root'}`.toLowerCase();
};

// the reference and the playground list the service endpoints first, then the
// reads, then the writes; inside a group, this order — the rest as the document has them
const SERVICE_PATHS = ['/api/v1/meta', '/api/v1/openapi.json'];
const READ_ORDER = [
  '/api/v1/search',
  '/api/v1/search/detailed',
  '/api/v1/words/{word}',
  '/api/v1/words/{word}/meanings',
  '/api/v1/words/{word}/translations',
  '/api/v1/words/{word}/forms',
  '/api/v1/words/{word}/synonyms',
  '/api/v1/words/{word}/antonyms',
  '/api/v1/words/{word}/history',
  '/api/v1/words/{word}/datasets',
  '/api/v1/words/{word}/datasets/{dataset}/history',
  '/api/v1/words/id/{id}',
  '/api/v1/words',
  '/api/v1/random',
];
const WRITE_ORDER = ['/api/v1/words/batch', '/api/v1/suggestions'];

const endpointRank = ({ method, path }: EndpointT): [number, number] => {
  if (SERVICE_PATHS.includes(path)) return [0, SERVICE_PATHS.indexOf(path)];
  const group = method === 'GET' ? 1 : 2;
  const order = method === 'GET' ? READ_ORDER : WRITE_ORDER;
  const index = order.indexOf(path);

  return [group, index === -1 ? order.length : index];
};

/** Every operation of the document: the service endpoints, then the reads, then the writes */
export const listEndpoints = (spec: OpenApiSpecT): EndpointT[] =>
  Object.entries(spec.paths)
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({
        method: method.toUpperCase() as HttpMethodT,
        path,
        slug: endpointSlug(method, path),
        operation: operation as OperationT,
      })),
    )
    .map((endpoint, index) => ({ endpoint, index, rank: endpointRank(endpoint) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index)
    .map(({ endpoint }) => endpoint);

export const refName = ($ref: string): string => $ref.split('/').pop() ?? $ref;

export const schemaAnchor = (name: string): string => `schema-${name}`;

/** How a schema reads in a type column: `string`, `EnWordT[]`, `WordLevelE | null` — with the referenced schema, when there is one */
export type TypeLabelT = {
  text: string;
  /** The schema the label points at (its own or the array item's) */
  ref?: string;
  enumValues?: string[];
};

export const describeType = (schema: SchemaT | undefined): TypeLabelT => {
  if (!schema) return { text: 'unknown' };

  const nullable = schema.nullable ? ' | null' : '';

  if (schema.$ref) return { text: refName(schema.$ref) + nullable, ref: refName(schema.$ref) };
  if (schema.allOf?.length === 1 && schema.allOf[0].$ref) {
    const name = refName(schema.allOf[0].$ref);

    return { text: name + nullable, ref: name };
  }
  if (schema.type === 'array') {
    const item = describeType(schema.items);

    return { text: `${item.text}[]${nullable}`, ref: item.ref, enumValues: item.enumValues };
  }
  if (schema.enum) return { text: `${schema.type ?? 'string'}${nullable}`, enumValues: schema.enum };

  return { text: `${schema.type ?? 'object'}${nullable}` };
};

export const jsonSchemaOf = (media: MediaT | undefined): SchemaT | undefined =>
  media?.['application/json']?.schema;

const SAMPLE_BY_NAME: Record<string, unknown> = {
  search: 'run',
  word: 'run',
  // every instance holds the default dataset
  dataset: 'default',
  id: 1,
  cursor: 'eyJ3IjoicnVuIn0',
};

/** A plausible value of one schema, for the request examples */
export const sampleValue = (schema: SchemaT | undefined, name: string, spec: OpenApiSpecT): unknown => {
  if (name in SAMPLE_BY_NAME) return SAMPLE_BY_NAME[name];
  if (!schema) return null;
  if (schema.$ref) return sampleValue(spec.components.schemas[refName(schema.$ref)], name, spec);
  if (schema.allOf?.[0]?.$ref)
    return sampleValue(spec.components.schemas[refName(schema.allOf[0].$ref)], name, spec);
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'array') return [sampleValue(schema.items, name, spec)];
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 1;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'object' && schema.properties) return sampleBody(schema, spec);

  return 'example';
};

/** The required fields of a request body with sample values */
export const sampleBody = (schema: SchemaT, spec: OpenApiSpecT): Record<string, unknown> =>
  Object.fromEntries(
    (schema.required ?? []).map((name) => [name, sampleValue(schema.properties?.[name], name, spec)]),
  );
