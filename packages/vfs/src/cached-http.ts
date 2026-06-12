/**
 * `CachedHttpDirectory` — drop-in replacement for `HttpDirectory`
 * that persists fetched bytes (index + files) in OPFS (preferred)
 * or IndexedDB.
 *
 * Why a wrapper, not changes to `HttpDirectory`: the base class is
 * the right minimum surface for read-only HTTP. Caching is an
 * orthogonal concern that some consumers don't want (development,
 * one-shot CLI tools). Keeping the two separate also means a bug in
 * the cache layer can't poison the simple path.
 *
 * What gets cached:
 *
 *   • The `index.json` per directory.
 *   • The body of every `file(name).arrayBuffer()` call.
 *
 * Staleness policy: **stale-while-revalidate.**
 *
 *   • First read of any URL: do a normal fetch, store body + ETag +
 *     Last-Modified + the `Content-Type`, return.
 *   • Subsequent reads inside `maxAgeMs` (default 5 min): serve
 *     cached bytes immediately, no network at all.
 *   • Subsequent reads OUTSIDE `maxAgeMs`: serve cached bytes
 *     immediately AND kick off a background conditional GET (`If-
 *     None-Match` / `If-Modified-Since`). When the server replies:
 *       - `304 Not Modified` → bump `validatedAt`. Body untouched.
 *       - `200 OK` → write the new body to cache. The next call
 *         then sees the fresh bytes.
 *   • Explicit `revalidate(file)` forces an immediate conditional
 *     fetch and returns once the network response settles.
 *
 * The first-after-update read returns the OLD bytes. That's the
 * standard SWR tradeoff — favours latency over freshness, lets
 * the dashboard render instantly on every load.
 */

import type { VirtualFile, VirtualDirectory, VirtualEntry } from './types.js';
import type { HttpDirectoryOptions } from './http.js';
import {
  openCacheBackend,
  type CacheBackend,
  type CacheEntry,
  type CacheMetadata,
} from './cache.js';

/** Shape of one entry in an `index.json`. Mirrors the (private)
 *  `IndexEntry` in `http.ts`. */
interface IndexEntry {
  type: 'file' | 'dir' | 'link';
  name: string;
  fullName: string;
  originalName: string;
  originalFullName: string;
  size: number;
}

/** Construction options for a `CachedHttpDirectory`. */
export interface CachedHttpDirectoryOptions extends HttpDirectoryOptions {
  /** Cache backend. If omitted, one is auto-selected from OPFS / IDB
   *  / memory at first use. Sharing one backend across multiple
   *  directories is fine — namespaces keep entries separate. */
  backend?: CacheBackend;
  /** Override the auto-selected backend kind. */
  preferBackend?: 'opfs' | 'idb' | 'memory';
  /**
   * Namespace string for this directory's cached entries. Default:
   * the baseUrl with its scheme stripped. Two `CachedHttpDirectory`
   * instances sharing a namespace share their cache — usually fine
   * (same baseUrl = same content) but expose the knob for testing
   * and for the case where two CDN URLs serve the same content and
   * you want one cache hit covering both.
   */
  namespace?: string;
  /**
   * Optional canonicaliser for cache keys. Useful when URLs carry
   * signed-token query strings that change per request — strip the
   * token so equivalent URLs hit the same cache entry.
   */
  cacheKey?: (url: string) => string;
  /**
   * Cache entries are served without revalidation when their age is
   * below this threshold. Default 5 min (300 000 ms). Set to 0 for
   * always-revalidate, or `Infinity` for never-revalidate.
   */
  maxAgeMs?: number;
}

/** Public API exposed by every `CachedHttpDirectory` for cache
 *  management — same surface across nested subdirs. */
export interface CacheControl {
  /** Bytes + entry count for this directory's namespace. */
  stats(): Promise<{
    backend: 'opfs' | 'idb' | 'memory';
    entries: number;
    totalBytes: number;
  }>;
  /** Drop every cached entry in this namespace. */
  clear(): Promise<void>;
  /** Force a fresh conditional GET on the given path. Resolves once
   *  the cache is consistent with the server. */
  revalidate(path: string): Promise<void>;
  /** Force-refresh the index for this directory (subset of
   *  `revalidate(<indexFile>)` exposed for clarity). */
  revalidateIndex(): Promise<void>;
}

/* ── Module-level cached backends ──────────────────────────────── */

/* When the user doesn't pass `backend`, we share one across all
   `CachedHttpDirectory` instances per namespace. Saves opening
   multiple OPFS handles to the same directory. */
const backendCache = new Map<string, Promise<CacheBackend>>();

function getBackend(
  namespace: string,
  prefer?: 'opfs' | 'idb' | 'memory',
): Promise<CacheBackend> {
  const key = `${prefer ?? 'auto'}:${namespace}`;
  let p = backendCache.get(key);
  if (!p) {
    p = openCacheBackend({ namespace, prefer });
    backendCache.set(key, p);
  }
  return p;
}

/* ── CachedHttpFile ────────────────────────────────────────────── */

/** `VirtualFile` backed by a cache lookup + conditional fetch. */
export class CachedHttpFile implements VirtualFile {
  readonly name: string;
  readonly size: number;
  readonly #url: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #backend: Promise<CacheBackend>;
  readonly #cacheKey: string;
  readonly #maxAgeMs: number;

  constructor(args: {
    name: string;
    size: number;
    url: string;
    fetch: typeof globalThis.fetch;
    backend: Promise<CacheBackend>;
    cacheKey: string;
    maxAgeMs: number;
  }) {
    this.name = args.name;
    this.size = args.size;
    this.#url = args.url;
    this.#fetch = args.fetch;
    this.#backend = args.backend;
    this.#cacheKey = args.cacheKey;
    this.#maxAgeMs = args.maxAgeMs;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const backend = await this.#backend;
    const cached = await backend.get(this.#cacheKey);
    const now = Date.now();

    if (cached) {
      /* Fresh enough — serve directly. */
      if (now - cached.meta.validatedAt < this.#maxAgeMs) {
        return cached.bytes;
      }
      /* Stale — kick off a conditional fetch in the background and
         return the cached bytes immediately. The next call will see
         the result. */
      void this.#revalidateInBackground(cached);
      return cached.bytes;
    }

    /* Cold miss. Network fetch and store. */
    const fresh = await this.#fetchAndStore();
    return fresh.bytes;
  }

  async #fetchAndStore(prev?: CacheEntry): Promise<CacheEntry> {
    const headers: Record<string, string> = {};
    if (prev?.meta.etag) headers['If-None-Match'] = prev.meta.etag;
    if (prev?.meta.lastModified) headers['If-Modified-Since'] = prev.meta.lastModified;

    const res = await this.#fetch(this.#url, { headers });
    const now = Date.now();

    if (res.status === 304 && prev) {
      /* Server says cached body is still fresh. Update timestamp,
         leave the bytes alone. */
      const updatedMeta: CacheMetadata = { ...prev.meta, validatedAt: now };
      const entry: CacheEntry = { bytes: prev.bytes, meta: updatedMeta };
      const backend = await this.#backend;
      await backend.put(this.#cacheKey, entry);
      return entry;
    }

    if (!res.ok) {
      /* Treat any non-success as "keep the cached entry, surface the
         error". When we have no cached entry, throw. */
      if (prev) return prev;
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${this.#url}`);
    }

    const bytes = await res.arrayBuffer();
    const meta: CacheMetadata = {
      url: this.#url,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
      contentType: res.headers.get('content-type') ?? undefined,
      size: bytes.byteLength,
      storedAt: now,
      validatedAt: now,
    };
    const entry: CacheEntry = { bytes, meta };
    const backend = await this.#backend;
    await backend.put(this.#cacheKey, entry);
    return entry;
  }

  async #revalidateInBackground(prev: CacheEntry): Promise<void> {
    try {
      await this.#fetchAndStore(prev);
    } catch {
      /* Background failures don't bubble — the cached entry stays
         valid until the next attempt. */
    }
  }

  /** Force a fresh conditional fetch and resolve once the cache is
   *  consistent with the server. */
  async revalidate(): Promise<void> {
    const backend = await this.#backend;
    const cached = await backend.get(this.#cacheKey);
    await this.#fetchAndStore(cached ?? undefined);
  }
}

/* ── CachedHttpDirectory ───────────────────────────────────────── */

export class CachedHttpDirectory implements VirtualDirectory, CacheControl {
  readonly name: string;
  readonly #baseUrl: string;
  readonly #indexFile: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #backend: Promise<CacheBackend>;
  readonly #namespace: string;
  readonly #cacheKey: (url: string) => string;
  readonly #maxAgeMs: number;

  /** Lazily populated on first access. Unlike `HttpDirectory`,
   *  we DON'T memo the parsed index — we re-read from the cache so
   *  background-revalidation updates take effect immediately. */
  #indexUrl: string;

  constructor(baseUrl: string, options: CachedHttpDirectoryOptions = {}) {
    this.#baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.#indexFile = options.indexFile ?? 'index.json';
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.name = this.#baseUrl.split('/').filter(Boolean).at(-1) ?? '';
    this.#namespace = options.namespace ?? defaultNamespace(this.#baseUrl);
    this.#cacheKey = options.cacheKey ?? ((url) => url);
    this.#maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
    this.#backend = options.backend
      ? Promise.resolve(options.backend)
      : getBackend(this.#namespace, options.preferBackend);
    this.#indexUrl = `${this.#baseUrl}/${this.#indexFile}`;
  }

  async #loadIndex(): Promise<IndexEntry[]> {
    const indexFile = new CachedHttpFile({
      name: this.#indexFile,
      size: 0,
      url: this.#indexUrl,
      fetch: this.#fetch,
      backend: this.#backend,
      cacheKey: this.#cacheKey(this.#indexUrl),
      maxAgeMs: this.#maxAgeMs,
    });
    const bytes = await indexFile.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(text) as IndexEntry[];
  }

  async file(name: string): Promise<VirtualFile | null> {
    const index = await this.#loadIndex();
    const target = name.toLowerCase();
    const entry = index.find(
      (e) => (e.type === 'file' || e.type === 'link') && e.fullName === target,
    );
    if (!entry) return null;
    const url = `${this.#baseUrl}/${entry.originalFullName}`;
    return new CachedHttpFile({
      name: entry.originalFullName,
      size: entry.size,
      url,
      fetch: this.#fetch,
      backend: this.#backend,
      cacheKey: this.#cacheKey(url),
      maxAgeMs: this.#maxAgeMs,
    });
  }

  async dir(name: string): Promise<VirtualDirectory | null> {
    const index = await this.#loadIndex();
    const target = name.toLowerCase();
    const entry = index.find((e) => e.type === 'dir' && e.fullName === target);
    if (!entry) return null;
    /* Pass the SAME backend down — nested directories share one
       namespace. Their cache keys still distinguish entries via the
       full URL. */
    return new CachedHttpDirectory(`${this.#baseUrl}/${entry.originalFullName}`, {
      indexFile: this.#indexFile,
      fetch: this.#fetch,
      backend: await this.#backend,
      namespace: this.#namespace,
      cacheKey: this.#cacheKey,
      maxAgeMs: this.#maxAgeMs,
    });
  }

  async entries(): Promise<VirtualEntry[]> {
    const index = await this.#loadIndex();
    const result: VirtualEntry[] = [];
    for (const entry of index) {
      if (entry.type === 'file' || entry.type === 'link') {
        result.push({ kind: 'file', name: entry.originalFullName, size: entry.size });
      } else if (entry.type === 'dir') {
        result.push({ kind: 'dir', name: entry.originalFullName });
      }
    }
    return result;
  }

  /* ── CacheControl ───────────────────────────────────────── */

  async stats(): Promise<{ backend: 'opfs' | 'idb' | 'memory'; entries: number; totalBytes: number }> {
    const backend = await this.#backend;
    const sz = await backend.size();
    return { backend: backend.kind, entries: sz.entries, totalBytes: sz.totalBytes };
  }

  async clear(): Promise<void> {
    const backend = await this.#backend;
    await backend.clear();
  }

  async revalidate(path: string): Promise<void> {
    /* `path` is interpreted relative to baseUrl. Normalises leading
       slashes so callers can pass `"foo.bin"` or `"/foo.bin"`. */
    const trimmed = path.replace(/^\/+/, '');
    const url = `${this.#baseUrl}/${trimmed}`;
    const file = new CachedHttpFile({
      name: trimmed,
      size: 0,
      url,
      fetch: this.#fetch,
      backend: this.#backend,
      cacheKey: this.#cacheKey(url),
      maxAgeMs: this.#maxAgeMs,
    });
    await file.revalidate();
  }

  async revalidateIndex(): Promise<void> {
    return this.revalidate(this.#indexFile);
  }
}

function defaultNamespace(baseUrl: string): string {
  /* Strip scheme + double slashes so two URLs that differ only in
     `http://` vs `https://` still share a namespace — same content
     under two ingress paths is the common case for embedded
     dongles served over both ports. */
  return baseUrl.replace(/^https?:\/\//, '');
}
