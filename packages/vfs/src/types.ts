/** A readable file in the virtual FS. */
export interface VirtualFile {
  /** Original-cased full basename, e.g. `"MS43.IPO"`. */
  readonly name: string;
  /** Size in bytes. */
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A read-only directory in the virtual FS. */
export interface VirtualDirectory {
  /** Original-cased directory name. */
  readonly name: string;

  /**
   * Case-insensitive file lookup.
   * Returns `null` when no file with that name exists.
   */
  file(name: string): Promise<VirtualFile | null>;

  /**
   * Case-insensitive subdirectory lookup.
   * Returns `null` when no directory with that name exists.
   */
  dir(name: string): Promise<VirtualDirectory | null>;

  /**
   * Flat listing of direct children. For FSA-backed directories, file
   * sizes are 0 — call `file(name)` when you need the actual size.
   */
  entries(): Promise<VirtualEntry[]>;
}

export type VirtualEntry =
  | { kind: 'file'; name: string; size: number }
  | { kind: 'dir'; name: string };
