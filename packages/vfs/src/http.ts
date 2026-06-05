import type { VirtualFile, VirtualDirectory, VirtualEntry } from './types.js';

/** Shape of one entry in an `index.json` written by `bimmerz data index`. */
interface IndexEntry {
  type: 'file' | 'dir' | 'link';
  /** Lowercased basename without extension (files), or lowercased name (dirs). */
  name: string;
  /** Lowercased full basename (with extension for files). */
  fullName: string;
  /** Original-cased basename without extension (files), or original name (dirs). */
  originalName: string;
  /** Original-cased full basename — used to build the fetch URL. */
  originalFullName: string;
  /** Bytes. 0 for directories. */
  size: number;
}

export interface HttpDirectoryOptions {
  /** Name of the index file to fetch from each directory. Default: `"index.json"`. */
  indexFile?: string;
  /**
   * Custom fetch implementation. Defaults to `globalThis.fetch`.
   * Useful for injecting auth headers, mocking in tests, etc.
   */
  fetch?: typeof globalThis.fetch;
}

export class HttpFile implements VirtualFile {
  readonly name: string;
  readonly size: number;
  readonly #url: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(
    name: string,
    size: number,
    url: string,
    fetchFn: typeof globalThis.fetch,
  ) {
    this.name = name;
    this.size = size;
    this.#url = url;
    this.#fetch = fetchFn;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const res = await this.#fetch(this.#url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${this.#url}`);
    return res.arrayBuffer();
  }
}

export class HttpDirectory implements VirtualDirectory {
  readonly name: string;
  readonly #baseUrl: string;
  readonly #indexFile: string;
  readonly #fetch: typeof globalThis.fetch;
  // Lazily populated on first access; one fetch per directory instance.
  #index: IndexEntry[] | null = null;

  constructor(baseUrl: string, options: HttpDirectoryOptions = {}) {
    // Normalise: no trailing slash so URL joins are predictable.
    this.#baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.#indexFile = options.indexFile ?? 'index.json';
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    // Use the last non-empty URL segment as the directory name.
    this.name = this.#baseUrl.split('/').filter(Boolean).at(-1) ?? '';
  }

  async #loadIndex(): Promise<IndexEntry[]> {
    if (this.#index !== null) return this.#index;
    const url = `${this.#baseUrl}/${this.#indexFile}`;
    const res = await this.#fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
    this.#index = (await res.json()) as IndexEntry[];
    return this.#index;
  }

  async file(name: string): Promise<VirtualFile | null> {
    const index = await this.#loadIndex();
    const target = name.toLowerCase();
    // Both 'file' and 'link' entries are readable resources.
    const entry = index.find(
      (e) => (e.type === 'file' || e.type === 'link') && e.fullName === target,
    );
    if (!entry) return null;
    const url = `${this.#baseUrl}/${entry.originalFullName}`;
    return new HttpFile(entry.originalFullName, entry.size, url, this.#fetch);
  }

  async dir(name: string): Promise<VirtualDirectory | null> {
    const index = await this.#loadIndex();
    const target = name.toLowerCase();
    const entry = index.find((e) => e.type === 'dir' && e.fullName === target);
    if (!entry) return null;
    return new HttpDirectory(
      `${this.#baseUrl}/${entry.originalFullName}`,
      { indexFile: this.#indexFile, fetch: this.#fetch },
    );
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
}
