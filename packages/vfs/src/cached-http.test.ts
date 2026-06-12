/**
 * Tests for `CachedHttpDirectory` + `CachedHttpFile` against the
 * in-memory cache backend. OPFS and IDB live behind their own
 * abstraction (`CacheBackend`) — once those persist, the
 * directory's behaviour is the same.
 *
 * Each test wires a mock `fetch` that records calls + responds with
 * controllable status / headers / body, so we can simulate 200, 304,
 * 404, and stale-while-revalidate cycles deterministically.
 */

import { describe, expect, it } from 'vitest';
import { CachedHttpDirectory, CachedHttpFile } from './cached-http.js';
import { MemoryCacheBackend, type CacheBackend } from './cache.js';

/* ── Mock fetch ─────────────────────────────────────────────────── */

interface MockRoute {
  body?: string | ArrayBuffer;
  status?: number;
  etag?: string;
  lastModified?: string;
  /** Override the response to a conditional GET. When set and the
   *  request includes a matching `If-None-Match`, returns 304. */
  conditional?: boolean;
}

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

type Routes = Map<string, MockRoute>;
interface FetchSpy {
  calls: Array<{ url: string; headers?: Record<string, string> }>;
}

function makeFetch(routes: Routes, spy?: FetchSpy): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    spy?.calls.push({ url, headers: { ...headers } });
    const route = routes.get(url);
    if (!route || route.status === 404) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }
    /* If the caller set conditional + an If-None-Match that matches
       our etag, return 304. */
    if (route.conditional && route.etag && headers['if-none-match'] === route.etag) {
      return new Response(null, { status: 304, statusText: 'Not Modified' });
    }
    const responseHeaders: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (route.etag) responseHeaders['ETag'] = route.etag;
    if (route.lastModified) responseHeaders['Last-Modified'] = route.lastModified;
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: responseHeaders,
    });
  };
}

/* Index fixture used across tests. */
const BASE = 'http://test.local/install';
function buildIndex(): string {
  return JSON.stringify([
    { type: 'file', name: 'ms43', fullName: 'ms43.ipo', originalName: 'MS43', originalFullName: 'MS43.IPO', size: 512 },
    { type: 'file', name: 'readme', fullName: 'readme.txt', originalName: 'README', originalFullName: 'README.TXT', size: 64 },
    { type: 'dir',  name: 'sub',   fullName: 'sub',       originalName: 'SUB',    originalFullName: 'SUB',       size: 0 },
  ]);
}

function makeBackend(): CacheBackend {
  return new MemoryCacheBackend('test-ns');
}

/* ── CachedHttpFile ─────────────────────────────────────────────── */

describe('CachedHttpFile', () => {
  it('fetches once and serves the cached bytes thereafter', async () => {
    const routes: Routes = new Map([
      [`${BASE}/MS43.IPO`, { body: bytes([1, 2, 3, 4]), etag: '"a1"' }],
    ]);
    const spy: FetchSpy = { calls: [] };
    const backend = makeBackend();
    const f = new CachedHttpFile({
      name: 'MS43.IPO', size: 4,
      url: `${BASE}/MS43.IPO`,
      fetch: makeFetch(routes, spy),
      backend: Promise.resolve(backend),
      cacheKey: `${BASE}/MS43.IPO`,
      maxAgeMs: 60_000,
    });

    const first = new Uint8Array(await f.arrayBuffer());
    expect(Array.from(first)).toEqual([1, 2, 3, 4]);
    expect(spy.calls.length).toBe(1);

    const second = new Uint8Array(await f.arrayBuffer());
    expect(Array.from(second)).toEqual([1, 2, 3, 4]);
    /* Still one fetch — second read came from the cache. */
    expect(spy.calls.length).toBe(1);
  });

  it('revalidates against the server with If-None-Match and accepts 304', async () => {
    const routes: Routes = new Map([
      [`${BASE}/MS43.IPO`, { body: bytes([1, 2, 3, 4]), etag: '"a1"', conditional: true }],
    ]);
    const spy: FetchSpy = { calls: [] };
    const backend = makeBackend();
    const f = new CachedHttpFile({
      name: 'MS43.IPO', size: 4,
      url: `${BASE}/MS43.IPO`,
      fetch: makeFetch(routes, spy),
      backend: Promise.resolve(backend),
      cacheKey: `${BASE}/MS43.IPO`,
      maxAgeMs: 60_000,
    });

    await f.arrayBuffer();
    await f.revalidate();

    /* Second call should be a conditional GET that the mock returns
       304 to — body unchanged. */
    expect(spy.calls.length).toBe(2);
    expect(spy.calls[1]!.headers!['if-none-match']).toBe('"a1"');

    /* The cache entry still holds the original bytes. */
    const cached = await backend.get(`${BASE}/MS43.IPO`);
    expect(cached?.bytes.byteLength).toBe(4);
  });

  it('replaces cached bytes when the server returns 200 with new content', async () => {
    const routes: Routes = new Map([
      [`${BASE}/MS43.IPO`, { body: bytes([1, 2]), etag: '"a1"' }],
    ]);
    const spy: FetchSpy = { calls: [] };
    const backend = makeBackend();
    const f = new CachedHttpFile({
      name: 'MS43.IPO', size: 2,
      url: `${BASE}/MS43.IPO`,
      fetch: makeFetch(routes, spy),
      backend: Promise.resolve(backend),
      cacheKey: `${BASE}/MS43.IPO`,
      maxAgeMs: 60_000,
    });
    await f.arrayBuffer();

    /* Mutate the route — new content + new etag, NOT conditional. */
    routes.set(`${BASE}/MS43.IPO`, { body: bytes([9, 9, 9]), etag: '"a2"' });
    await f.revalidate();

    const cached = await backend.get(`${BASE}/MS43.IPO`);
    expect(Array.from(new Uint8Array(cached!.bytes))).toEqual([9, 9, 9]);
    expect(cached!.meta.etag).toBe('"a2"');
  });

  it('serves cached bytes immediately when over maxAgeMs and revalidates in background', async () => {
    const routes: Routes = new Map([
      [`${BASE}/MS43.IPO`, { body: bytes([1, 2, 3]), etag: '"a1"', conditional: true }],
    ]);
    const spy: FetchSpy = { calls: [] };
    const backend = makeBackend();
    const f = new CachedHttpFile({
      name: 'MS43.IPO', size: 3,
      url: `${BASE}/MS43.IPO`,
      fetch: makeFetch(routes, spy),
      backend: Promise.resolve(backend),
      cacheKey: `${BASE}/MS43.IPO`,
      maxAgeMs: 0,  // always stale
    });

    /* Cold miss → 1 fetch. */
    await f.arrayBuffer();
    expect(spy.calls.length).toBe(1);

    /* Next call: cached bytes are returned synchronously, but the
       maxAge=0 policy schedules a background revalidate. */
    const buf = new Uint8Array(await f.arrayBuffer());
    expect(Array.from(buf)).toEqual([1, 2, 3]);

    /* Flush microtasks. */
    await new Promise((r) => setTimeout(r, 0));

    /* Background fetch went out — total 2 calls. */
    expect(spy.calls.length).toBe(2);
    expect(spy.calls[1]!.headers!['if-none-match']).toBe('"a1"');
  });

  it('throws on cold-miss 404 with no cache entry', async () => {
    const routes: Routes = new Map();
    const backend = makeBackend();
    const f = new CachedHttpFile({
      name: 'X', size: 0,
      url: `${BASE}/missing`,
      fetch: makeFetch(routes),
      backend: Promise.resolve(backend),
      cacheKey: `${BASE}/missing`,
      maxAgeMs: 60_000,
    });
    await expect(f.arrayBuffer()).rejects.toThrow(/404/);
  });

  it('keeps cached bytes when revalidation returns an error', async () => {
    const routes: Routes = new Map([
      [`${BASE}/MS43.IPO`, { body: bytes([1, 2, 3, 4]), etag: '"a1"' }],
    ]);
    const backend = makeBackend();
    const f = new CachedHttpFile({
      name: 'MS43.IPO', size: 4,
      url: `${BASE}/MS43.IPO`,
      fetch: makeFetch(routes),
      backend: Promise.resolve(backend),
      cacheKey: `${BASE}/MS43.IPO`,
      maxAgeMs: 60_000,
    });
    await f.arrayBuffer();

    /* Mutate the route to return 500. revalidate() should NOT throw
       (we have a cached entry) and the cache should be intact. */
    routes.set(`${BASE}/MS43.IPO`, { status: 500 });
    await f.revalidate();
    const cached = await backend.get(`${BASE}/MS43.IPO`);
    expect(cached).not.toBeNull();
    expect(Array.from(new Uint8Array(cached!.bytes))).toEqual([1, 2, 3, 4]);
  });
});

/* ── CachedHttpDirectory ──────────────────────────────────────── */

describe('CachedHttpDirectory', () => {
  it('caches the index and reuses it across file/dir lookups', async () => {
    const routes: Routes = new Map([
      [`${BASE}/index.json`, { body: buildIndex(), etag: '"i1"' }],
      [`${BASE}/MS43.IPO`,   { body: bytes([0xAA]) }],
    ]);
    const spy: FetchSpy = { calls: [] };
    const dir = new CachedHttpDirectory(BASE, {
      fetch: makeFetch(routes, spy),
      backend: makeBackend(),
    });

    await dir.entries();
    await dir.file('MS43.IPO');
    await dir.entries();

    /* Index fetched once; MS43.IPO not yet fetched (file() only
       returns a CachedHttpFile, doesn't read bytes). */
    const indexCalls = spy.calls.filter((c) => c.url.endsWith('/index.json')).length;
    expect(indexCalls).toBe(1);
  });

  it('clear() wipes the namespace', async () => {
    const routes: Routes = new Map([
      [`${BASE}/index.json`, { body: buildIndex() }],
      [`${BASE}/MS43.IPO`,   { body: bytes([0xAA, 0xBB]) }],
    ]);
    const backend = makeBackend();
    const dir = new CachedHttpDirectory(BASE, {
      fetch: makeFetch(routes),
      backend,
    });
    const f = await dir.file('MS43.IPO');
    await f!.arrayBuffer();

    let stats = await dir.stats();
    expect(stats.entries).toBeGreaterThan(0);

    await dir.clear();
    stats = await dir.stats();
    expect(stats.entries).toBe(0);
  });

  it('stats() reports backend kind + total bytes', async () => {
    const routes: Routes = new Map([
      [`${BASE}/index.json`, { body: buildIndex() }],
      [`${BASE}/MS43.IPO`,   { body: new ArrayBuffer(1000) }],
    ]);
    const dir = new CachedHttpDirectory(BASE, {
      fetch: makeFetch(routes),
      backend: makeBackend(),
    });
    const f = await dir.file('MS43.IPO');
    await f!.arrayBuffer();

    const stats = await dir.stats();
    expect(stats.backend).toBe('memory');
    expect(stats.entries).toBe(2); // index + MS43.IPO
    expect(stats.totalBytes).toBeGreaterThanOrEqual(1000);
  });

  it('cacheKey hook canonicalises URLs with query strings', async () => {
    /* Same content under two URLs that differ only by a signed-token
       query string. With the cacheKey hook stripping the query,
       both should hit the same cache entry. */
    const body = bytes([1, 2, 3]);
    const routes: Routes = new Map([
      [`${BASE}/MS43.IPO?t=abc`, { body }],
      [`${BASE}/MS43.IPO?t=def`, { body }],
    ]);
    const spy: FetchSpy = { calls: [] };
    const backend = makeBackend();
    const fetchFn = makeFetch(routes, spy);
    const cacheKey = (url: string) => url.replace(/\?.*$/, '');

    const a = new CachedHttpFile({
      name: 'a', size: 3,
      url: `${BASE}/MS43.IPO?t=abc`,
      fetch: fetchFn,
      backend: Promise.resolve(backend),
      cacheKey: cacheKey(`${BASE}/MS43.IPO?t=abc`),
      maxAgeMs: 60_000,
    });
    const b = new CachedHttpFile({
      name: 'b', size: 3,
      url: `${BASE}/MS43.IPO?t=def`,
      fetch: fetchFn,
      backend: Promise.resolve(backend),
      cacheKey: cacheKey(`${BASE}/MS43.IPO?t=def`),
      maxAgeMs: 60_000,
    });
    await a.arrayBuffer();
    await b.arrayBuffer();
    /* Only one fetch — the second resolved from cache because the
       cache keys are equal after the hook normalised away the token. */
    expect(spy.calls.length).toBe(1);
  });

  it('revalidate(path) updates a cached entry on demand', async () => {
    const routes: Routes = new Map([
      [`${BASE}/index.json`, { body: buildIndex() }],
      [`${BASE}/MS43.IPO`,   { body: bytes([1]), etag: '"a1"' }],
    ]);
    const backend = makeBackend();
    const dir = new CachedHttpDirectory(BASE, {
      fetch: makeFetch(routes),
      backend,
    });
    const f = await dir.file('MS43.IPO');
    await f!.arrayBuffer();

    /* Server-side update. */
    routes.set(`${BASE}/MS43.IPO`, { body: bytes([2, 2]), etag: '"a2"' });
    await dir.revalidate('MS43.IPO');

    const cached = await backend.get(`${BASE}/MS43.IPO`);
    expect(Array.from(new Uint8Array(cached!.bytes))).toEqual([2, 2]);
    expect(cached!.meta.etag).toBe('"a2"');
  });

  it('revalidateIndex() refetches the index', async () => {
    const routes: Routes = new Map([
      [`${BASE}/index.json`, { body: buildIndex(), etag: '"i1"' }],
    ]);
    const spy: FetchSpy = { calls: [] };
    const dir = new CachedHttpDirectory(BASE, {
      fetch: makeFetch(routes, spy),
      backend: makeBackend(),
    });

    await dir.entries();
    await dir.revalidateIndex();

    const indexCalls = spy.calls.filter((c) => c.url.endsWith('/index.json')).length;
    expect(indexCalls).toBe(2);
  });
});

/* ── MemoryCacheBackend (used to back the tests; sanity-check it
 *  separately so failures here don't masquerade as CachedHttpFile
 *  bugs). ─────────────────────────────────────────────────────── */

describe('MemoryCacheBackend', () => {
  it('round-trips put + get', async () => {
    const b = makeBackend();
    await b.put('k', {
      bytes: bytes([1, 2, 3]),
      meta: { url: 'http://x', size: 3, storedAt: 1, validatedAt: 1 },
    });
    const e = await b.get('k');
    expect(e).not.toBeNull();
    expect(Array.from(new Uint8Array(e!.bytes))).toEqual([1, 2, 3]);
  });

  it('isolates namespaces', async () => {
    const a = new MemoryCacheBackend('a');
    const b = new MemoryCacheBackend('b');
    await a.put('k', {
      bytes: new ArrayBuffer(0),
      meta: { url: 'u', size: 0, storedAt: 0, validatedAt: 0 },
    });
    expect((await b.get('k'))).toBeNull();
  });

  it('clear(prefix) only removes matching keys', async () => {
    const b = makeBackend();
    await b.put('foo/a', { bytes: new ArrayBuffer(0), meta: { url: 'u', size: 0, storedAt: 0, validatedAt: 0 } });
    await b.put('foo/b', { bytes: new ArrayBuffer(0), meta: { url: 'u', size: 0, storedAt: 0, validatedAt: 0 } });
    await b.put('bar/c', { bytes: new ArrayBuffer(0), meta: { url: 'u', size: 0, storedAt: 0, validatedAt: 0 } });
    await b.clear('foo/');
    const keys = await b.keys();
    expect(keys).toEqual(['bar/c']);
  });
});
