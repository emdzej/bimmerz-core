import { describe, expect, it } from 'vitest';
import { FsaDirectory, FsaFile } from './fsa.js';

// ---------------------------------------------------------------------------
// Mock helpers — minimal FSA-shaped objects without a real browser
// ---------------------------------------------------------------------------

function mockFile(name: string, content: Uint8Array): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () =>
      ({ arrayBuffer: async () => content.buffer.slice(0), size: content.length }) as unknown as File,
  } as unknown as FileSystemFileHandle;
}

function mockDir(
  name: string,
  children: Array<FileSystemFileHandle | FileSystemDirectoryHandle>,
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    entries: async function* () {
      for (const child of children) {
        yield [child.name, child] as [string, FileSystemHandle];
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

// ---------------------------------------------------------------------------
// FsaFile
// ---------------------------------------------------------------------------

describe('FsaFile', () => {
  const content = new Uint8Array([0x49, 0x50, 0x4f]);
  const handle = mockFile('MS43.IPO', content);

  it('exposes name and size from constructor args', async () => {
    const file = await handle.getFile();
    const fsaFile = new FsaFile(handle, file as unknown as File);
    expect(fsaFile.name).toBe('MS43.IPO');
    expect(fsaFile.size).toBe(3);
  });

  it('arrayBuffer() returns the file contents', async () => {
    const file = await handle.getFile();
    const fsaFile = new FsaFile(handle, file as unknown as File);
    const buf = await fsaFile.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(content);
  });
});

// ---------------------------------------------------------------------------
// FsaDirectory
// ---------------------------------------------------------------------------

const IPO = new Uint8Array([0x01, 0x02, 0x03]);
const INI = new Uint8Array([0x5b, 0x49, 0x4e, 0x50, 0x41, 0x5d]); // [INPA]

const ecuHandle = mockDir('Ecu', [
  mockFile('MS43.prg', new Uint8Array([0x50, 0x52, 0x47])),
]);

const rootHandle = mockDir('root', [
  mockFile('MS43.IPO', IPO),
  mockFile('INPA.INI', INI),
  ecuHandle as unknown as FileSystemDirectoryHandle,
]);

const root = new FsaDirectory(rootHandle);

describe('FsaDirectory.file()', () => {
  it('returns null when the file does not exist', async () => {
    expect(await root.file('missing.ipo')).toBeNull();
  });

  it('finds a file by exact name', async () => {
    const f = await root.file('MS43.IPO');
    expect(f).not.toBeNull();
    expect(f!.name).toBe('MS43.IPO');
  });

  it('finds a file case-insensitively', async () => {
    const f = await root.file('ms43.ipo');
    expect(f).not.toBeNull();
    expect(f!.name).toBe('MS43.IPO');
  });

  it('does not return a directory when looking for a file', async () => {
    expect(await root.file('Ecu')).toBeNull();
  });

  it('returns file with correct size and contents', async () => {
    const f = await root.file('MS43.IPO');
    expect(f!.size).toBe(IPO.length);
    const buf = await f!.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(IPO);
  });
});

describe('FsaDirectory.dir()', () => {
  it('returns null when the directory does not exist', async () => {
    expect(await root.dir('missing')).toBeNull();
  });

  it('finds a directory by exact name', async () => {
    const d = await root.dir('Ecu');
    expect(d).not.toBeNull();
    expect(d!.name).toBe('Ecu');
  });

  it('finds a directory case-insensitively', async () => {
    const d = await root.dir('ecu');
    expect(d).not.toBeNull();
    expect(d!.name).toBe('Ecu');
  });

  it('does not return a file when looking for a directory', async () => {
    expect(await root.dir('MS43.IPO')).toBeNull();
  });
});

describe('FsaDirectory.entries()', () => {
  it('lists files with kind "file" and size 0', async () => {
    const entries = await root.entries();
    const files = entries.filter((e) => e.kind === 'file');
    expect(files.length).toBe(2);
    expect(files.every((f) => f.kind === 'file' && f.size === 0)).toBe(true);
  });

  it('lists directories with kind "dir"', async () => {
    const entries = await root.entries();
    const dirs = entries.filter((e) => e.kind === 'dir');
    expect(dirs.length).toBe(1);
    expect(dirs[0]!.name).toBe('Ecu');
  });

  it('preserves original casing in entry names', async () => {
    const entries = await root.entries();
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['Ecu', 'INPA.INI', 'MS43.IPO'].sort());
  });
});
