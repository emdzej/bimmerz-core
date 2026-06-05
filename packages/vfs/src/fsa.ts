import type { VirtualFile, VirtualDirectory, VirtualEntry } from './types.js';

export class FsaFile implements VirtualFile {
  readonly name: string;
  readonly size: number;
  // Cache the File object obtained during construction so arrayBuffer()
  // doesn't need a second getFile() round-trip.
  readonly #file: File;

  constructor(handle: FileSystemFileHandle, file: File) {
    this.name = handle.name;
    this.size = file.size;
    this.#file = file;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#file.arrayBuffer();
  }
}

export class FsaDirectory implements VirtualDirectory {
  readonly name: string;
  readonly #handle: FileSystemDirectoryHandle;

  constructor(handle: FileSystemDirectoryHandle) {
    this.name = handle.name;
    this.#handle = handle;
  }

  async file(name: string): Promise<VirtualFile | null> {
    const target = name.toLowerCase();
    for await (const [entryName, handle] of this.#handle.entries()) {
      if (handle.kind === 'file' && entryName.toLowerCase() === target) {
        const fileHandle = handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        return new FsaFile(fileHandle, file);
      }
    }
    return null;
  }

  async dir(name: string): Promise<VirtualDirectory | null> {
    const target = name.toLowerCase();
    for await (const [entryName, handle] of this.#handle.entries()) {
      if (handle.kind === 'directory' && entryName.toLowerCase() === target) {
        return new FsaDirectory(handle as FileSystemDirectoryHandle);
      }
    }
    return null;
  }

  async entries(): Promise<VirtualEntry[]> {
    const result: VirtualEntry[] = [];
    for await (const [name, handle] of this.#handle.entries()) {
      if (handle.kind === 'file') {
        // Avoid calling getFile() for every entry — size is 0 here.
        // Call dir.file(name) when you need the actual file and its size.
        result.push({ kind: 'file', name, size: 0 });
      } else if (handle.kind === 'directory') {
        result.push({ kind: 'dir', name });
      }
    }
    return result;
  }
}
