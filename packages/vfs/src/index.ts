/**
 * @deprecated This whole package is superseded by
 * [csfs](https://github.com/emdzej/csfs) — `@emdzej/csfs-core`, `-http`,
 * `-fsa`, `-opfs`, `-zip`, `-node`.
 *
 * csfs is MIT where this is PolyForm Noncommercial, which has already cost
 * real work in GPL consumers, and it does more: byte-range reads, zip archives
 * read in place, a writable OPFS backend, `node:fs` for tooling. csfs 0.2.0
 * closed the four gaps that were blocking the move — case-insensitive HTTP
 * lookups, lookups answering with the name as *stored* rather than as asked
 * for, a readable tree on a host that ignores `Range`, and symlinks surviving
 * a listing.
 *
 * Describe a tree with `bimmerz data manifest`, not `bimmerz data index`.
 * See `notes/vfs-to-csfs-migration-eval.md` for the per-symbol translation
 * table. This package stays until inpax, ncsx, nfsx and dashx have moved.
 */
export type { VirtualFile, VirtualDirectory, VirtualEntry } from './types.js';
export { FsaFile, FsaDirectory } from './fsa.js';
export { HttpFile, HttpDirectory, type HttpDirectoryOptions } from './http.js';
export { drillPath, listFiles } from './utils.js';
export {
  CachedHttpFile,
  CachedHttpDirectory,
  type CachedHttpDirectoryOptions,
  type CacheControl,
} from './cached-http.js';
export {
  openCacheBackend,
  OpfsCacheBackend,
  IdbCacheBackend,
  MemoryCacheBackend,
  type CacheBackend,
  type CacheEntry,
  type CacheMetadata,
  type OpenCacheOptions,
} from './cache.js';
