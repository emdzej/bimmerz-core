import { describe, expect, it, vi } from 'vitest';
import { HttpDirectory, HttpFile } from './http.js';

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

type RouteMap = Record<string, string | Uint8Array>;

function makeFetch(
  routes: RouteMap,
  spy?: { calls: string[] },
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (spy) spy.calls.push(url);
    const value = routes[url];
    if (value === undefined) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }
    return new Response(value as BodyInit, { status: 200 });
  };
}

// Minimal index.json fixture used by most HttpDirectory tests.
const BASE = 'http://test.local/install';

const INDEX: RouteMap = {
  [`${BASE}/index.json`]: JSON.stringify([
    {
      type: 'file',
      name: 'ms43',
      fullName: 'ms43.ipo',
      originalName: 'MS43',
      originalFullName: 'MS43.IPO',
      size: 512,
    },
    {
      type: 'link',
      name: 'readme',
      fullName: 'readme.txt',
      originalName: 'README',
      originalFullName: 'README.TXT',
      size: 64,
    },
    {
      type: 'dir',
      name: 'ediabas',
      fullName: 'ediabas',
      originalName: 'EDIABAS',
      originalFullName: 'EDIABAS',
      size: 0,
    },
    {
      type: 'dir',
      name: 'ec-apps',
      fullName: 'ec-apps',
      originalName: 'EC-APPS',
      originalFullName: 'EC-APPS',
      size: 0,
    },
  ]),
  [`${BASE}/MS43.IPO`]: new Uint8Array([0x49, 0x50, 0x4f]),
  [`${BASE}/README.TXT`]: 'hello',
};

// ---------------------------------------------------------------------------
// HttpFile
// ---------------------------------------------------------------------------

describe('HttpFile', () => {
  it('exposes name and size', () => {
    const f = new HttpFile('MS43.IPO', 512, `${BASE}/MS43.IPO`, makeFetch(INDEX));
    expect(f.name).toBe('MS43.IPO');
    expect(f.size).toBe(512);
  });

  it('arrayBuffer() fetches the URL and returns the body', async () => {
    const f = new HttpFile(
      'MS43.IPO',
      512,
      `${BASE}/MS43.IPO`,
      makeFetch(INDEX),
    );
    const buf = await f.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([0x49, 0x50, 0x4f]));
  });

  it('arrayBuffer() throws on a non-200 response', async () => {
    const f = new HttpFile('ghost.ipo', 0, `${BASE}/ghost.ipo`, makeFetch(INDEX));
    await expect(f.arrayBuffer()).rejects.toThrow('404');
  });
});

// ---------------------------------------------------------------------------
// HttpDirectory — entries()
// ---------------------------------------------------------------------------

describe('HttpDirectory.entries()', () => {
  it('returns file and dir entries from index.json', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const entries = await dir.entries();
    expect(entries).toHaveLength(4);
  });

  it('maps file entries with kind "file" and original-cased name + size', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const entries = await dir.entries();
    const file = entries.find((e) => e.name === 'MS43.IPO');
    expect(file).toEqual({ kind: 'file', name: 'MS43.IPO', size: 512 });
  });

  it('maps dir entries with kind "dir" and original-cased name', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const entries = await dir.entries();
    const d = entries.find((e) => e.name === 'EDIABAS');
    expect(d).toEqual({ kind: 'dir', name: 'EDIABAS' });
  });

  it('treats "link" type entries as "file" kind', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const entries = await dir.entries();
    const link = entries.find((e) => e.name === 'README.TXT');
    expect(link?.kind).toBe('file');
  });

  it('fetches index.json only once across multiple accesses', async () => {
    const spy = { calls: [] as string[] };
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX, spy) });
    await dir.entries();
    await dir.entries();
    await dir.file('MS43.IPO');
    const indexFetches = spy.calls.filter((u) => u.endsWith('index.json'));
    expect(indexFetches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// HttpDirectory — file()
// ---------------------------------------------------------------------------

describe('HttpDirectory.file()', () => {
  it('returns null when name is not in the index', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    expect(await dir.file('ghost.ipo')).toBeNull();
  });

  it('finds a file by exact lowercased name', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const f = await dir.file('ms43.ipo');
    expect(f?.name).toBe('MS43.IPO');
  });

  it('finds a file case-insensitively', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const f = await dir.file('MS43.IPO');
    expect(f?.name).toBe('MS43.IPO');
  });

  it('finds a link entry as a file', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const f = await dir.file('readme.txt');
    expect(f?.name).toBe('README.TXT');
  });

  it('returned file fetches from original-cased URL', async () => {
    const spy = { calls: [] as string[] };
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX, spy) });
    const f = await dir.file('ms43.ipo');
    await f!.arrayBuffer();
    expect(spy.calls).toContain(`${BASE}/MS43.IPO`);
  });

  it('returned file has the correct size', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const f = await dir.file('MS43.IPO');
    expect(f?.size).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// HttpDirectory — dir()
// ---------------------------------------------------------------------------

describe('HttpDirectory.dir()', () => {
  it('returns null when name is not in the index', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    expect(await dir.dir('missing')).toBeNull();
  });

  it('finds a directory case-insensitively', async () => {
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(INDEX) });
    const child = await dir.dir('ediabas');
    expect(child?.name).toBe('EDIABAS');
  });

  it('child directory base URL uses original-cased name', async () => {
    const spy = { calls: [] as string[] };
    const routes: RouteMap = {
      ...INDEX,
      [`${BASE}/EDIABAS/index.json`]: JSON.stringify([]),
    };
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(routes, spy) });
    const child = await dir.dir('ediabas');
    await child!.entries();
    expect(spy.calls).toContain(`${BASE}/EDIABAS/index.json`);
  });

  it('child inherits the custom indexFile option', async () => {
    const spy = { calls: [] as string[] };
    const custom = 'dir.json';
    const routes: RouteMap = {
      [`${BASE}/${custom}`]: JSON.stringify([
        {
          type: 'dir',
          name: 'ediabas',
          fullName: 'ediabas',
          originalName: 'EDIABAS',
          originalFullName: 'EDIABAS',
          size: 0,
        },
      ]),
      [`${BASE}/EDIABAS/${custom}`]: JSON.stringify([]),
    };
    const dir = new HttpDirectory(BASE, { indexFile: custom, fetch: makeFetch(routes, spy) });
    const child = await dir.dir('EDIABAS');
    await child!.entries();
    expect(spy.calls).toContain(`${BASE}/EDIABAS/${custom}`);
  });

  it('child inherits the custom fetch function', async () => {
    const spy = { calls: [] as string[] };
    const routes: RouteMap = {
      ...INDEX,
      [`${BASE}/EDIABAS/index.json`]: JSON.stringify([]),
    };
    const dir = new HttpDirectory(BASE, { fetch: makeFetch(routes, spy) });
    const child = await dir.dir('EDIABAS');
    await child!.entries();
    // Both the parent index and child index went through the same fetch spy
    expect(spy.calls.filter((u) => u.includes('EDIABAS'))).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HttpDirectory — constructor
// ---------------------------------------------------------------------------

describe('HttpDirectory constructor', () => {
  it('name is the last URL segment', () => {
    expect(new HttpDirectory('http://x.com/a/b/c').name).toBe('c');
  });

  it('strips a trailing slash from the base URL', async () => {
    const spy = { calls: [] as string[] };
    const routes: RouteMap = { [`${BASE}/index.json`]: JSON.stringify([]) };
    const dir = new HttpDirectory(BASE + '/', { fetch: makeFetch(routes, spy) });
    await dir.entries();
    expect(spy.calls[0]).toBe(`${BASE}/index.json`);
  });
});
