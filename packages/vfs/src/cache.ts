/**
 * Storage backend for `CachedHttpDirectory`. Two implementations:
 *
 *   • **OPFS** (Origin Private File System) — preferred. Real
 *     filesystem semantics inside the browser sandbox, no quota
 *     prompts on writes ≤ 1 GB, and survives across tabs / refreshes.
 *     Requires Chrome 86+ / Safari 16+ / Firefox 111+ (gated on
 *     `navigator.storage.getDirectory`).
 *   • **IndexedDB** — fallback. Same durability story but with the
 *     awkward request/cursor API. Works everywhere.
 *
 * Each cached entry has TWO pieces:
 *
 *   1. The raw response bytes (one blob per key).
 *   2. A small metadata record (`etag`, `last-modified`, `storedAt`,
 *      `validatedAt`, `url`). Used by `CachedHttpDirectory` to make
 *      conditional-GET requests and to surface staleness in `stats()`.
 *
 * The OPFS layout stores them as sibling files: `<key>` and
 * `<key>.meta`. The IDB layout merges them into one object-store
 * row keyed by `<key>`.
 *
 * Keys are origin-scoped: every backend instance is namespaced by a
 * caller-supplied string (typically a hash of the `baseUrl`). The
 * namespace is the OPFS subdirectory or the IDB key prefix. Clearing
 * a namespace wipes one consumer's cache without touching anything
 * else.
 */

/** Per-entry metadata persisted alongside the bytes. */
export interface CacheMetadata {
  /** Original request URL. Useful for telemetry / debugging. */
  url: string;
  /** Strong / weak ETag header value, if the server returned one. */
  etag?: string;
  /** `Last-Modified` header value (RFC 7231 IMF-fixdate). */
  lastModified?: string;
  /** Content-Type header, captured so callers can serve via Response. */
  contentType?: string;
  /** Bytes (length of the data blob; redundant with the blob but
   *  cheap to keep — lets `stats()` answer without reading every file). */
  size: number;
  /** Wall-clock ms when the body was first stored. */
  storedAt: number;
  /** Wall-clock ms when the body was last confirmed fresh (200 or
   *  304). Drives the `maxAgeMs` staleness check. */
  validatedAt: number;
}

/** Combined entry returned from `get()`. */
export interface CacheEntry {
  bytes: ArrayBuffer;
  meta: CacheMetadata;
}

/** What every backend must implement. Async by necessity — both
 *  OPFS and IDB are Promise-only. */
export interface CacheBackend {
  /** Backend name, surfaced in `stats()` so consumers can show the
   *  user which path the cache landed on. */
  readonly kind: 'opfs' | 'idb' | 'memory';

  get(key: string): Promise<CacheEntry | null>;
  put(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;

  /** List keys with optional prefix filter. Order is unspecified. */
  keys(prefix?: string): Promise<string[]>;
  /** Remove every entry whose key starts with `prefix` (or all if
   *  no prefix is given). */
  clear(prefix?: string): Promise<void>;
  /** Aggregate counts for `stats()`. */
  size(prefix?: string): Promise<{ entries: number; totalBytes: number }>;
}

/* ── OPFS backend ──────────────────────────────────────────────── */

/** OPFS file naming:
 *
 *   <root>/<namespace>/<encoded-key>        ← raw bytes
 *   <root>/<namespace>/<encoded-key>.meta   ← JSON metadata
 *
 *  `root` defaults to `bimmerz-vfs-cache`. Keys are URL-encoded so
 *  any character is safe — OPFS rejects `/` in names which we'd
 *  otherwise hit constantly. */
const OPFS_ROOT = 'bimmerz-vfs-cache';
const META_SUFFIX = '.meta';

function encodeKey(key: string): string {
  /* Replace forbidden OPFS characters. encodeURIComponent handles
     most, but `:` (in URLs) is rejected on some platforms — strip
     it explicitly. */
  return encodeURIComponent(key).replace(/:/g, '%3A');
}

function decodeKey(encoded: string): string {
  return decodeURIComponent(encoded);
}

/** Implementation of `CacheBackend` over OPFS. Construct via
 *  `OpfsCacheBackend.open()` which resolves the root directory; the
 *  promise rejects when OPFS isn't available so callers can fall
 *  back to IDB. */
export class OpfsCacheBackend implements CacheBackend {
  readonly kind = 'opfs' as const;
  readonly #root: FileSystemDirectoryHandle;

  private constructor(root: FileSystemDirectoryHandle) {
    this.#root = root;
  }

  static async open(namespace: string): Promise<OpfsCacheBackend> {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      throw new Error('OPFS not available');
    }
    const opfs = await navigator.storage.getDirectory();
    const cacheRoot = await opfs.getDirectoryHandle(OPFS_ROOT, { create: true });
    const nsDir = await cacheRoot.getDirectoryHandle(encodeKey(namespace), { create: true });
    return new OpfsCacheBackend(nsDir);
  }

  async get(key: string): Promise<CacheEntry | null> {
    const encoded = encodeKey(key);
    try {
      const [bodyFile, metaFile] = await Promise.all([
        this.#root.getFileHandle(encoded),
        this.#root.getFileHandle(encoded + META_SUFFIX),
      ]);
      const [bodyBlob, metaBlob] = await Promise.all([
        bodyFile.getFile(),
        metaFile.getFile(),
      ]);
      const [bytes, metaText] = await Promise.all([
        bodyBlob.arrayBuffer(),
        metaBlob.text(),
      ]);
      const meta = JSON.parse(metaText) as CacheMetadata;
      return { bytes, meta };
    } catch {
      /* `getFileHandle` throws when the entry doesn't exist; any
         other failure (corrupted JSON, partial write from a prior
         crash) is also treated as a cache miss so the caller falls
         back to a real fetch rather than serving garbage. */
      return null;
    }
  }

  async put(key: string, entry: CacheEntry): Promise<void> {
    const encoded = encodeKey(key);
    /* Write metadata FIRST so a crash mid-put leaves stale meta +
       missing body rather than fresh body + stale meta. The reader
       handles missing files defensively, so either failure mode
       reads as a cache miss. */
    const [bodyHandle, metaHandle] = await Promise.all([
      this.#root.getFileHandle(encoded, { create: true }),
      this.#root.getFileHandle(encoded + META_SUFFIX, { create: true }),
    ]);
    const metaWriter = await metaHandle.createWritable();
    await metaWriter.write(JSON.stringify(entry.meta));
    await metaWriter.close();
    const bodyWriter = await bodyHandle.createWritable();
    await bodyWriter.write(entry.bytes);
    await bodyWriter.close();
  }

  async delete(key: string): Promise<void> {
    const encoded = encodeKey(key);
    await Promise.allSettled([
      this.#root.removeEntry(encoded),
      this.#root.removeEntry(encoded + META_SUFFIX),
    ]);
  }

  async keys(prefix?: string): Promise<string[]> {
    const out: string[] = [];
    /* The iterator API isn't typed yet on FileSystemDirectoryHandle
       in some lib targets; cast through `unknown`. */
    const dir = this.#root as unknown as {
      values(): AsyncIterable<FileSystemHandle>;
    };
    for await (const handle of dir.values()) {
      if (handle.kind !== 'file') continue;
      if (handle.name.endsWith(META_SUFFIX)) continue;
      const key = decodeKey(handle.name);
      if (prefix && !key.startsWith(prefix)) continue;
      out.push(key);
    }
    return out;
  }

  async clear(prefix?: string): Promise<void> {
    const keys = await this.keys(prefix);
    await Promise.all(keys.map((k) => this.delete(k)));
  }

  async size(prefix?: string): Promise<{ entries: number; totalBytes: number }> {
    const keys = await this.keys(prefix);
    let totalBytes = 0;
    /* We pull byte sizes from metadata (no full body read needed). */
    await Promise.all(
      keys.map(async (key) => {
        const meta = await this.#readMeta(key);
        if (meta) totalBytes += meta.size;
      }),
    );
    return { entries: keys.length, totalBytes };
  }

  async #readMeta(key: string): Promise<CacheMetadata | null> {
    try {
      const handle = await this.#root.getFileHandle(encodeKey(key) + META_SUFFIX);
      const blob = await handle.getFile();
      return JSON.parse(await blob.text()) as CacheMetadata;
    } catch {
      return null;
    }
  }
}

/* ── IDB backend ───────────────────────────────────────────────── */

/** Stable DB name. One DB per origin, one object store keyed by
 *  `${namespace}:${key}` so all consumers share a single connection. */
const IDB_NAME = 'bimmerz-vfs-cache';
const IDB_STORE = 'entries';
const IDB_VERSION = 1;

interface IdbRow {
  /** `${namespace}:${key}` — primary key. */
  k: string;
  /** Namespace alone — indexed for prefix queries. */
  ns: string;
  bytes: ArrayBuffer;
  meta: CacheMetadata;
}

/** Implementation of `CacheBackend` over IndexedDB. Construct via
 *  `IdbCacheBackend.open()`; one shared connection per origin is
 *  cached at the module level. */
export class IdbCacheBackend implements CacheBackend {
  readonly kind = 'idb' as const;
  readonly #namespace: string;
  readonly #dbPromise: Promise<IDBDatabase>;

  constructor(namespace: string) {
    this.#namespace = namespace;
    this.#dbPromise = openDb();
  }

  static async open(namespace: string): Promise<IdbCacheBackend> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB not available');
    }
    const instance = new IdbCacheBackend(namespace);
    /* Eagerly resolve the DB connection so a failure surfaces
       at construction time rather than first-use. */
    await instance.#dbPromise;
    return instance;
  }

  #rowKey(key: string): string {
    return `${this.#namespace}:${key}`;
  }

  async get(key: string): Promise<CacheEntry | null> {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(this.#rowKey(key));
      req.onsuccess = () => {
        const row = req.result as IdbRow | undefined;
        resolve(row ? { bytes: row.bytes, meta: row.meta } : null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async put(key: string, entry: CacheEntry): Promise<void> {
    const db = await this.#dbPromise;
    const row: IdbRow = {
      k: this.#rowKey(key),
      ns: this.#namespace,
      bytes: entry.bytes,
      meta: entry.meta,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(row);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).delete(this.#rowKey(key));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async keys(prefix?: string): Promise<string[]> {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).index('ns').openKeyCursor(
        IDBKeyRange.only(this.#namespace),
      );
      const out: string[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        const rowKey = String(cursor.primaryKey);
        const key = rowKey.slice(this.#namespace.length + 1);
        if (!prefix || key.startsWith(prefix)) out.push(key);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clear(prefix?: string): Promise<void> {
    const keys = await this.keys(prefix);
    await Promise.all(keys.map((k) => this.delete(k)));
  }

  async size(prefix?: string): Promise<{ entries: number; totalBytes: number }> {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).index('ns').openCursor(
        IDBKeyRange.only(this.#namespace),
      );
      let entries = 0;
      let totalBytes = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve({ entries, totalBytes });
        const row = cursor.value as IdbRow;
        const key = row.k.slice(this.#namespace.length + 1);
        if (!prefix || key.startsWith(prefix)) {
          entries += 1;
          totalBytes += row.meta.size;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(IDB_STORE, { keyPath: 'k' });
      store.createIndex('ns', 'ns', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ── Memory backend (for tests + SSR) ─────────────────────────── */

/** In-memory backend. Doesn't persist anything — used by tests and
 *  as a graceful no-op when neither OPFS nor IDB is available. */
export class MemoryCacheBackend implements CacheBackend {
  readonly kind = 'memory' as const;
  readonly #store = new Map<string, CacheEntry>();
  readonly #namespace: string;

  constructor(namespace: string) {
    this.#namespace = namespace;
  }

  #ns(key: string): string {
    return `${this.#namespace}:${key}`;
  }

  async get(key: string): Promise<CacheEntry | null> {
    const e = this.#store.get(this.#ns(key));
    return e ? { bytes: e.bytes, meta: { ...e.meta } } : null;
  }
  async put(key: string, entry: CacheEntry): Promise<void> {
    this.#store.set(this.#ns(key), entry);
  }
  async delete(key: string): Promise<void> {
    this.#store.delete(this.#ns(key));
  }
  async keys(prefix?: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.#store.keys()) {
      if (!k.startsWith(`${this.#namespace}:`)) continue;
      const local = k.slice(this.#namespace.length + 1);
      if (!prefix || local.startsWith(prefix)) out.push(local);
    }
    return out;
  }
  async clear(prefix?: string): Promise<void> {
    for (const k of [...this.#store.keys()]) {
      if (!k.startsWith(`${this.#namespace}:`)) continue;
      const local = k.slice(this.#namespace.length + 1);
      if (!prefix || local.startsWith(prefix)) this.#store.delete(k);
    }
  }
  async size(prefix?: string): Promise<{ entries: number; totalBytes: number }> {
    let entries = 0;
    let totalBytes = 0;
    for (const [k, v] of this.#store) {
      if (!k.startsWith(`${this.#namespace}:`)) continue;
      const local = k.slice(this.#namespace.length + 1);
      if (prefix && !local.startsWith(prefix)) continue;
      entries += 1;
      totalBytes += v.meta.size;
    }
    return { entries, totalBytes };
  }
}

/* ── Auto-select ──────────────────────────────────────────────── */

export interface OpenCacheOptions {
  /** Namespace for this cache instance. Typically a stable hash of
   *  the consumer's baseUrl so different `CachedHttpDirectory`
   *  instances don't trample each other. */
  namespace: string;
  /** Force a specific backend. Default: try OPFS, fall back to IDB,
   *  fall back to memory. */
  prefer?: 'opfs' | 'idb' | 'memory';
}

/** Pick the best available backend at runtime. Returns the
 *  preferred one if it works, otherwise walks the fallback chain. */
export async function openCacheBackend(options: OpenCacheOptions): Promise<CacheBackend> {
  const order: Array<'opfs' | 'idb' | 'memory'> =
    options.prefer
      ? options.prefer === 'opfs'
        ? ['opfs', 'idb', 'memory']
        : options.prefer === 'idb'
          ? ['idb', 'memory']
          : ['memory']
      : ['opfs', 'idb', 'memory'];
  let lastError: unknown;
  for (const kind of order) {
    try {
      if (kind === 'opfs') return await OpfsCacheBackend.open(options.namespace);
      if (kind === 'idb')  return await IdbCacheBackend.open(options.namespace);
      return new MemoryCacheBackend(options.namespace);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `No usable cache backend (last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    })`,
  );
}
