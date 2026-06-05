/**
 * `bimmerz data index <dir>` — walk a directory tree and drop an
 * `index.json` in every directory listing the entries directly inside
 * it (no recursion in the listing itself; one index.json per level).
 *
 * Designed as a static directory listing for environments that can't
 * `readdir` (e.g. a static HTTP host, OPFS bundle, browser fetch of
 * extracted INPA data). Consumers traverse by reading `index.json` at
 * each level and following `type: "dir"` entries.
 *
 * Ignore semantics: gitignore-style via the `ignore` package, same as
 * `bundle`. Auto-discovers `<dir>/.bimmerzignore` or honours `-i <file>`.
 * `index.json` and `.bimmerzignore` themselves are never listed.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, stat, lstat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { createMatcher, type IgnoreMatcher } from '@emdzej/bimmerz-ignore';

type EntryType = 'file' | 'dir' | 'link';

interface IndexEntry {
  type: EntryType;
  /** Lowercased basename without extension (files); lowercased basename for dirs/links. */
  name: string;
  /** Lowercased full basename. */
  fullName: string;
  /** Original-cased basename without extension (files); original-cased basename otherwise. */
  originalName: string;
  /** Original-cased full basename. */
  originalFullName: string;
  /** Bytes. 0 for directories. */
  size: number;
}

interface IndexCliOptions {
  ignore?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

interface IndexSummary {
  dirsIndexed: number;
  entriesWritten: number;
}

export const indexCommand = new Command('index')
  .description(
    'Recursively write an index.json in each directory listing its entries.',
  )
  .argument('<dir>', 'Directory to index')
  .option(
    '-i, --ignore <file>',
    'gitignore-style file (default: <dir>/.bimmerzignore if present)',
  )
  .option(
    '--dry-run',
    "Walk + match but don't write any index.json files (logs would-write paths in --verbose).",
  )
  .option('--verbose', 'Log every index.json written (or that would be written)')
  .action(async (dir: string, opts: IndexCliOptions) => {
    try {
      const root = resolve(dir);
      if (!existsSync(root)) {
        throw new Error(`Directory does not exist: ${root}`);
      }
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        throw new Error(`Not a directory: ${root}`);
      }

      const matcher = await buildMatcher(root, opts.ignore);

      const start = Date.now();
      const summary: IndexSummary = { dirsIndexed: 0, entriesWritten: 0 };
      await indexDir(root, '', matcher, opts.dryRun ?? false, opts.verbose ?? false, summary);
      const elapsedMs = Date.now() - start;

      const out: string[] = [];
      out.push(chalk.bold('Done.'));
      out.push(
        `  dirs    : ${chalk.green(summary.dirsIndexed.toString())} index.json files ${
          opts.dryRun ? chalk.gray('(dry-run, nothing written)') : 'written'
        }`,
      );
      out.push(`  entries : ${chalk.cyan(summary.entriesWritten.toString())} total`);
      out.push(`  elapsed : ${(elapsedMs / 1000).toFixed(2)}s`);
      process.stdout.write(out.join('\n') + '\n');
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exitCode = 1;
    }
  });

async function indexDir(
  absDir: string,
  relDir: string,
  matcher: IgnoreMatcher,
  dryRun: boolean,
  verbose: boolean,
  summary: IndexSummary,
): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const indexEntries: IndexEntry[] = [];

  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isSymbolicLink()) {
      if (!matcher.shouldKeep(rel)) continue;
      let size = 0;
      try {
        size = (await lstat(abs)).size;
      } catch {
        // broken link, etc. — still record with size 0
      }
      indexEntries.push(makeEntry(entry.name, 'link', size));
      continue;
    }

    if (entry.isDirectory()) {
      if (!matcher.shouldDescend(rel + '/')) continue;
      await indexDir(abs, rel, matcher, dryRun, verbose, summary);
      indexEntries.push(makeEntry(entry.name, 'dir', 0));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!matcher.shouldKeep(rel)) continue;

    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch {
      // unreadable file — record with size 0
    }
    indexEntries.push(makeEntry(entry.name, 'file', size));
  }

  indexEntries.sort((a, b) =>
    a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0,
  );

  const indexPath = join(absDir, 'index.json');
  if (!dryRun) {
    await writeFile(
      indexPath,
      JSON.stringify(indexEntries, null, 2) + '\n',
      'utf-8',
    );
  }
  summary.dirsIndexed++;
  summary.entriesWritten += indexEntries.length;
  if (verbose) {
    process.stdout.write(
      `${chalk.green(dryRun ? '~' : '+')} ${indexPath} ${chalk.gray(`(${indexEntries.length} entries)`)}\n`,
    );
  }
}

function makeEntry(
  originalFullName: string,
  type: EntryType,
  size: number,
): IndexEntry {
  if (type === 'file') {
    const ext = extname(originalFullName);
    const originalName = ext
      ? originalFullName.slice(0, -ext.length)
      : originalFullName;
    return {
      type,
      name: originalName.toLowerCase(),
      fullName: originalFullName.toLowerCase(),
      originalName,
      originalFullName,
      size,
    };
  }
  return {
    type,
    name: originalFullName.toLowerCase(),
    fullName: originalFullName.toLowerCase(),
    originalName: originalFullName,
    originalFullName,
    size,
  };
}

async function buildMatcher(
  root: string,
  ignoreFile: string | undefined,
): Promise<IgnoreMatcher> {
  const sources: string[] = ['index.json\n.bimmerzignore\n'];

  let userIgnorePath = ignoreFile;
  if (!userIgnorePath) {
    const candidate = resolve(root, '.bimmerzignore');
    if (existsSync(candidate)) userIgnorePath = candidate;
  }

  if (userIgnorePath) {
    if (!existsSync(userIgnorePath)) {
      throw new Error(`Ignore file not found: ${userIgnorePath}`);
    }
    sources.push(await readFile(userIgnorePath, 'utf-8'));
  }

  return createMatcher(sources);
}
