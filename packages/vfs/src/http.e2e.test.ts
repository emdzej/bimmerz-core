/**
 * End-to-end tests — HttpDirectory against a real in-process HTTP server.
 * The fixture is defined as a nested JS object; index.json files are
 * generated automatically for every level, matching the format written
 * by `bimmerz data index`.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpDirectory } from './http.js';
import { drillPath, listFiles } from './utils.js';

// ---------------------------------------------------------------------------
// Fixture tree — mirrors a minimal BMW INPA install
// ---------------------------------------------------------------------------

type FixtureTree = Record<string, FixtureTree | Uint8Array | string>;

const MS43_IPO = new Uint8Array([0x49, 0x50, 0x4f, 0x01, 0x02]);
const RADIO_IPO = new Uint8Array([0x52, 0x41, 0x44, 0x03]);
const MS43_PRG = new Uint8Array([0x50, 0x52, 0x47, 0x04]);
const INPA_INI = '[INPA]\nPath=C:\\EC-APPS\\INPA\n';
const EDIABAS_INI = '[EDIABAS]\nInterface=STD:OBD\n';

const FIXTURE: FixtureTree = {
  'INPA.INI': INPA_INI,
  'EC-APPS': {
    INPA: {
      CFGDAT: {
        'MS43.IPO': MS43_IPO,
        'INPA.INI': INPA_INI,
        'E46.ENG': 'E46\nMOTOR\n',
      },
      SGDAT: {
        'RADIO.IPO': RADIO_IPO,
      },
    },
  },
  EDIABAS: {
    Ecu: {
      'MS43.prg': MS43_PRG,
    },
    Bin: {
      'EDIABAS.INI': EDIABAS_INI,
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture → flat URL map (generates index.json for every directory level)
// ---------------------------------------------------------------------------

interface IndexEntry {
  type: 'file' | 'dir';
  name: string;
  fullName: string;
  originalName: string;
  originalFullName: string;
  size: number;
}

function buildRoutes(
  tree: FixtureTree,
  prefix: string = '',
): Map<string, Buffer> {
  const routes = new Map<string, Buffer>();
  const indexEntries: IndexEntry[] = [];

  for (const [name, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${name}` : name;

    if (value instanceof Uint8Array || typeof value === 'string') {
      const buf =
        typeof value === 'string' ? Buffer.from(value, 'utf-8') : Buffer.from(value);
      routes.set(path, buf);

      const dotIdx = name.lastIndexOf('.');
      const baseName = dotIdx > 0 ? name.slice(0, dotIdx) : name;
      indexEntries.push({
        type: 'file',
        name: baseName.toLowerCase(),
        fullName: name.toLowerCase(),
        originalName: baseName,
        originalFullName: name,
        size: buf.length,
      });
    } else {
      for (const [sub, subBuf] of buildRoutes(value as FixtureTree, path)) {
        routes.set(sub, subBuf);
      }
      indexEntries.push({
        type: 'dir',
        name: name.toLowerCase(),
        fullName: name.toLowerCase(),
        originalName: name,
        originalFullName: name,
        size: 0,
      });
    }
  }

  const indexPath = prefix ? `${prefix}/index.json` : 'index.json';
  routes.set(indexPath, Buffer.from(JSON.stringify(indexEntries, null, 2), 'utf-8'));

  return routes;
}

// ---------------------------------------------------------------------------
// HTTP server lifecycle
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const routes = buildRoutes(FIXTURE);

  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      const rawPath = decodeURIComponent((req.url ?? '/').replace(/^\//, ''));
      const buf = routes.get(rawPath);
      if (!buf) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': rawPath.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'Content-Length': buf.length,
      });
      res.end(buf);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function root() {
  return new HttpDirectory(baseUrl);
}

describe('HttpDirectory E2E', () => {
  it('reads root-level entries from index.json', async () => {
    const entries = await root().entries();
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['EDIABAS', 'EC-APPS', 'INPA.INI'].sort());
  });

  it('navigates a multi-level path', async () => {
    const cfgdat = await drillPath(root(), 'EC-APPS', 'INPA', 'CFGDAT');
    expect(cfgdat?.name).toBe('CFGDAT');
  });

  it('is case-insensitive at every path segment', async () => {
    const cfgdat = await drillPath(root(), 'ec-apps', 'inpa', 'cfgdat');
    expect(cfgdat?.name).toBe('CFGDAT');
  });

  it('reads a text file', async () => {
    const f = await root().file('INPA.INI');
    expect(f).not.toBeNull();
    const buf = await f!.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    expect(text).toBe(INPA_INI);
  });

  it('reads a binary file', async () => {
    const ecu = await drillPath(root(), 'EDIABAS', 'Ecu');
    const f = await ecu!.file('MS43.prg');
    expect(f).not.toBeNull();
    const buf = await f!.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(MS43_PRG);
  });

  it('resolves a file case-insensitively', async () => {
    const cfgdat = await drillPath(root(), 'EC-APPS', 'INPA', 'CFGDAT');
    const f = await cfgdat!.file('ms43.ipo');
    expect(f?.name).toBe('MS43.IPO');
    const buf = await f!.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(MS43_IPO);
  });

  it('returns null for a missing file', async () => {
    expect(await root().file('ghost.ipo')).toBeNull();
  });

  it('returns null for a missing directory', async () => {
    expect(await root().dir('missing')).toBeNull();
  });

  it('lists only IPO files in CFGDAT', async () => {
    const cfgdat = await drillPath(root(), 'EC-APPS', 'INPA', 'CFGDAT');
    const ipos = await listFiles(cfgdat!, '.ipo');
    expect(ipos.map((f) => f.name)).toEqual(['MS43.IPO']);
  });

  it('reports correct file sizes', async () => {
    const cfgdat = await drillPath(root(), 'EC-APPS', 'INPA', 'CFGDAT');
    const f = await cfgdat!.file('MS43.IPO');
    expect(f?.size).toBe(MS43_IPO.length);
  });

  it('index.json is not listed as an entry', async () => {
    const entries = await root().entries();
    expect(entries.find((e) => e.name === 'index.json')).toBeUndefined();
  });
});
