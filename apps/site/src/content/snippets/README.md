# Code snippets of the API reference

Every endpoint on the reference page of the website (`/en/api`) shows its request in several
languages — the tabs under **Example**. The snippets are not written per endpoint: a language is a
small function that turns a request into code, and the site runs it over every endpoint of
`apps/server/openapi/public-v1.json`. Adding a language takes one file and no knowledge of the
site.

## Adding a language

1. Copy `languages/python.ts` to `languages/<name>.ts` and fill in:
   - `id` — a stable key, lowercase (`ruby`);
   - `label` — the tab's title, as the language calls itself (`Ruby`);
   - `highlight` — the [highlight.js language](https://github.com/highlightjs/highlight.js/blob/main/SUPPORTED_LANGUAGES.md)
     for colouring; register it in `src/content/highlight.ts` if it is not there yet;
   - `render(request)` — the code, as one string. `request` has the method, the whole URL with
     sample values filled in (`https://your-instance.example/api/v1/words/run`), the origin, and
     the JSON body of a write as an object (null for a read); `types.ts` lists every field.
     Return `null` for a request the language cannot show — that endpoint simply has no tab.
2. Add it to `SNIPPET_LANGUAGES` in `index.ts`, at the position its tab should take.
3. Run `yarn jest --selectProjects site src/content/snippets`: the test renders every language
   over every endpoint and checks the URL is in the code. Add a case with the exact text of one
   read and one write, as the other languages have.

The body helpers in `literals.ts` write a sample body as a literal of the language (`{ search:
'run' }` in JavaScript, `{"search": "run"}` in Python, `['search' => 'run']` in PHP) — add one for
a language that reads better with its own syntax than with a JSON string.

## Snippets written by hand

The two SDK tabs (`languages/sdk-node.ts`, `languages/sdk-python.ts`) cannot be generated: the
method names are not in the OpenAPI document. They hold a map from the endpoint's slug — its
anchor on the reference page and its `?endpoint=` in the playground, `get-words-word`,
`post-words-batch` — to the snippet. An endpoint without an entry shows no SDK tab; adding one is
adding an entry. The sample values of the path come from `pathArguments(request, template)` of
`request.ts`, so the snippet passes what the generated ones put into the URL. The method names are in `packages/npm-sdk/README.md` and
`packages/python-sdk/README.md`.

## Where the rest lives

- `request.ts` — the request digest from the OpenAPI document (sample values, the body of the
  required fields); `../openapi.ts` has the sample rules.
- `../highlight.ts` — the languages highlight.js knows on this site.
- `src/app/[locale]/api/_components/Snippets.tsx` — the tabs; the choice is remembered in the
  browser and applied to every endpoint on the page.
