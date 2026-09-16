import type { VirtualDirectory, VirtualEntry } from './types.js';

/**
 * Walk down path segments case-insensitively.
 * Returns `null` as soon as any segment is not found.
 *
 * @example
 * const cfgdat = await drillPath(root, 'EC-APPS', 'INPA', 'CFGDAT');
 *
 * @deprecated Use `resolveDirectory(root, 'EC-APPS/INPA/CFGDAT')` from
 * `@emdzej/csfs-core`. Superseded by [csfs](https://github.com/emdzej/csfs) — MIT, where this is
 * PolyForm Noncommercial.
 */
export async function drillPath(
  root: VirtualDirectory,
  ...segments: string[]
): Promise<VirtualDirectory | null> {
  let current: VirtualDirectory = root;
  for (const segment of segments) {
    const next = await current.dir(segment);
    if (!next) return null;
    current = next;
  }
  return current;
}

/**
 * List all files directly inside `dir`, optionally filtered by extension
 * (matched case-insensitively, leading dot required, e.g. `".ipo"`).
 *
 * Returns lightweight entry objects — call `dir.file(name)` to open one.
 *
 * @deprecated csfs has no equivalent by design; filter `entries()` yourself, or
 * use `walk()` from `@emdzej/csfs-core` for a whole subtree. Superseded by [csfs](https://github.com/emdzej/csfs) — MIT, where this is
 * PolyForm Noncommercial.
 */
export async function listFiles(
  dir: VirtualDirectory,
  ext?: string,
): Promise<Array<VirtualEntry & { kind: 'file' }>> {
  const all = await dir.entries();
  const files = all.filter((e): e is VirtualEntry & { kind: 'file' } => e.kind === 'file');
  if (!ext) return files;
  const extLower = ext.toLowerCase();
  return files.filter((e) => e.name.toLowerCase().endsWith(extLower));
}
