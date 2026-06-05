import { describe, expect, it } from 'vitest';
import { HttpDirectory } from './http.js';
import { drillPath, listFiles } from './utils.js';

// ---------------------------------------------------------------------------
// Fixture — a two-level in-memory tree served via HttpDirectory
// ---------------------------------------------------------------------------

const BASE = 'http://test.local/root';

const ROUTES: Record<string, string> = {
  [`${BASE}/index.json`]: JSON.stringify([
    { type: 'file', name: 'inpa', fullName: 'inpa.ini', originalName: 'INPA', originalFullName: 'INPA.INI', size: 10 },
    { type: 'file', name: 'ms43', fullName: 'ms43.ipo', originalName: 'MS43', originalFullName: 'MS43.IPO', size: 512 },
    { type: 'file', name: 'radio', fullName: 'radio.ipo', originalName: 'RADIO', originalFullName: 'RADIO.IPO', size: 256 },
    { type: 'dir', name: 'ec-apps', fullName: 'ec-apps', originalName: 'EC-APPS', originalFullName: 'EC-APPS', size: 0 },
  ]),
  [`${BASE}/EC-APPS/index.json`]: JSON.stringify([
    { type: 'dir', name: 'inpa', fullName: 'inpa', originalName: 'INPA', originalFullName: 'INPA', size: 0 },
  ]),
  [`${BASE}/EC-APPS/INPA/index.json`]: JSON.stringify([
    { type: 'file', name: 'ms43', fullName: 'ms43.ipo', originalName: 'MS43', originalFullName: 'MS43.IPO', size: 128 },
  ]),
};

function makeRoot() {
  return new HttpDirectory(BASE, {
    fetch: async (input: RequestInfo | URL) => {
      const url = input.toString();
      const body = ROUTES[url];
      if (!body) return new Response(null, { status: 404 });
      return new Response(body, { status: 200 });
    },
  });
}

// ---------------------------------------------------------------------------
// drillPath
// ---------------------------------------------------------------------------

describe('drillPath', () => {
  it('returns the root itself when no segments are given', async () => {
    const root = makeRoot();
    const result = await drillPath(root);
    expect(result).toBe(root);
  });

  it('navigates one level', async () => {
    const result = await drillPath(makeRoot(), 'EC-APPS');
    expect(result?.name).toBe('EC-APPS');
  });

  it('navigates multiple levels', async () => {
    const result = await drillPath(makeRoot(), 'EC-APPS', 'INPA');
    expect(result?.name).toBe('INPA');
  });

  it('is case-insensitive at each segment', async () => {
    const result = await drillPath(makeRoot(), 'ec-apps', 'inpa');
    expect(result?.name).toBe('INPA');
  });

  it('returns null when a segment is not found', async () => {
    expect(await drillPath(makeRoot(), 'missing')).toBeNull();
  });

  it('returns null at a missing intermediate segment', async () => {
    expect(await drillPath(makeRoot(), 'EC-APPS', 'missing', 'INPA')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listFiles
// ---------------------------------------------------------------------------

describe('listFiles', () => {
  it('returns all file entries when no extension filter is given', async () => {
    const files = await listFiles(makeRoot());
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['INPA.INI', 'MS43.IPO', 'RADIO.IPO'].sort());
  });

  it('filters by extension case-insensitively', async () => {
    const ipo = await listFiles(makeRoot(), '.IPO');
    expect(ipo.map((f) => f.name).sort()).toEqual(['MS43.IPO', 'RADIO.IPO'].sort());
  });

  it('filter works regardless of entry casing', async () => {
    // Pass lowercase extension against uppercase filenames
    const ipo = await listFiles(makeRoot(), '.ipo');
    expect(ipo).toHaveLength(2);
  });

  it('excludes directories', async () => {
    const files = await listFiles(makeRoot());
    expect(files.every((f) => f.kind === 'file')).toBe(true);
  });

  it('returns empty array when nothing matches the extension', async () => {
    const result = await listFiles(makeRoot(), '.exe');
    expect(result).toHaveLength(0);
  });

  it('returns empty array for an empty directory', async () => {
    const emptyBase = 'http://test.local/empty';
    const emptyDir = new HttpDirectory(emptyBase, {
      fetch: async () => new Response(JSON.stringify([]), { status: 200 }),
    });
    expect(await listFiles(emptyDir)).toHaveLength(0);
  });
});
