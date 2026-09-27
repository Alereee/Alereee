import type { NextRequest } from 'next/server';

/**
 * `/api/*` on the frontend origin forwarded to the API server (issue #316).
 *
 * The browser bundle calls the API under the page origin by default
 * (`NEXT_PUBLIC_BASE_API_URL=/api`). Behind the documented reverse proxy
 * `/api/*` never reaches Next.js — the proxy routes it to the server. Without
 * a proxy (`docker compose up` on a workstation, a LAN) these requests land
 * in `app/api/[...path]/route.ts` and are relayed to `API_INTERNAL_URL`, so
 * the same frontend image works in both setups. Bodies and responses are
 * streamed (the import and export progress is an NDJSON stream), cookies
 * pass through untouched.
 */

// end-to-end headers only; the rest describes this hop, not the message
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'host',
  'content-length',
  // fetch decompresses the upstream body; the browser must not see the original encoding
  'content-encoding',
  'accept-encoding',
  // `Expect: 100-continue` is a handshake of the client with this hop (curl sends it with a
  // large upload); fetch refuses to pass it on and the request would fail
  'expect',
]);

/** Where the API is from the frontend process: API_INTERNAL_URL, else the server on this host */
export const apiTarget = (env: Record<string, string | undefined> = process.env): string =>
  (env.API_INTERNAL_URL || `http://127.0.0.1:${env.SERVER_PORT || 3010}/api`).replace(/\/+$/, '');

export const forwardToApi = async (req: NextRequest, path: string[]): Promise<Response> => {
  const url = `${apiTarget()}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
  });
  // The client's forwarding claims are untrusted: with TRUST_PROXY set on the
  // server a spoofed X-Forwarded-For would become the client address — the
  // rate-limit key and the log attribution (issue #346). This handler cannot
  // learn the real peer either (Next fills the header from the socket only
  // when the client sent none, so the values are indistinguishable), so the
  // claims are dropped and the server attributes the traffic to this process,
  // exactly as it does without TRUST_PROXY.
  for (const name of ['x-forwarded-for', 'x-forwarded-port', 'x-real-ip', 'forwarded']) {
    headers.delete(name);
  }
  // what this hop actually knows: the host the client asked and the scheme
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // a streamed request body needs this in undici
    ...(hasBody && { duplex: 'half' }),
    redirect: 'manual',
    cache: 'no-store',
  } as RequestInit);

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (!HOP_BY_HOP.has(key) && key !== 'set-cookie') responseHeaders.append(name, value);
  });
  // several cookies must stay several headers
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  // progress streams are marked by the server; keep Next's compression from buffering them
  if (upstream.headers.get('x-accel-buffering') === 'no') {
    responseHeaders.set('cache-control', `${responseHeaders.get('cache-control') ?? 'no-store'}, no-transform`);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
