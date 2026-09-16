/**
 * `bimmerz data manifest <dir>` — describe a tree so csfs can serve it over
 * static HTTP.
 *
 * The replacement for `bimmerz data index`. Both exist for the same reason —
 * **HTTP cannot list a directory**, so a tree served over HTTP has to carry a
 * description of itself — and they differ only in the shape of that
 * description:
 *
 * - `data index` writes one `index.json` per directory, which is what
 *   `@emdzej/bimmerz-vfs`'s `HttpDirectory` walks. A lookup then costs a
 *   request per path level, and a directory that is not on disk cannot be
 *   described at all.
 * - `data manifest` writes one flat `csfs-manifest.json` at the root, which is
 *   what `@emdzej/csfs-http` reads. A lookup is one map hit after a single
 *   fetch, and directories are *derived* from the file paths — which is what
 *   lets a zip stand in for a directory that was never extracted.
 *
 * Measured on a real 13,048-file INPA install: the flat manifest is 0.49 MB,
 * 0.10 MB gzipped, in one request. The per-directory equivalent is 0.39 MB
 * across 165 files — no smaller in total, because a directory's paths no
 * longer share a compression window with the rest of the tree, and it costs
 * four or five serialised round trips to reach a file in `EDIABAS/Ecu`.
 *
 * Ignore semantics come from `@emdzej/bimmerz-ignore`, the same matcher
 * `bundle` uses, so a `.bimmerzignore` means the same thing to both. One
 * deliberate difference from `bundle`: the default patterns are **opt-in**
 * here (`--default-ignore`). `bundle` produces a trimmed artifact, where
 * dropping `*.exe` is the point; this describes a tree that already exists, and
 * silently omitting files a caller can see on the host is the wrong default.
 * `data index` did not apply them either.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { relative, resolve } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { createMatcher, DEFAULT_IGNORE, type IgnoreMatcher } from "@emdzej/bimmerz-ignore";
import {
  buildManifest,
  formatManifest,
  ManifestIndex,
  MANIFEST_FILE,
  type ManifestArchive,
} from "@emdzej/csfs-manifest";
import { nodeFileSystem } from "@emdzej/csfs-node";

interface ManifestCliOptions {
  out?: string;
  label?: string;
  ignore?: string;
  defaultIgnore?: boolean;
  archive?: string[];
  pretty?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export const manifestCommand = new Command("manifest")
  .description("Write a flat csfs-manifest.json describing the tree, for serving over HTTP.")
  .argument("<dir>", "Directory to describe")
  .option("-o, --out <file>", `Output path (default: <dir>/${MANIFEST_FILE})`)
  .option("-l, --label <text>", "Free-form name recorded in the manifest")
  .option(
    "-i, --ignore <file>",
    "gitignore-style file (default: <dir>/.bimmerzignore if present)",
  )
  .option(
    "--default-ignore",
    "Also apply the bundle default patterns (*.exe, OS junk, runtime dirs)",
  )
  .option(
    "--archive <spec...>",
    "Read an archive in place instead of expecting it unpacked: " +
      "<archive>:<serves>[:basename]. Repeatable.",
  )
  .option("--pretty", "Indent the JSON — larger, but readable in a diff")
  .option("--dry-run", "Walk and summarise, but write nothing")
  .option("--verbose", "Log every file as it is described")
  .action(async (dir: string, opts: ManifestCliOptions) => {
    try {
      const root = resolve(dir);
      if (!existsSync(root)) {
        throw new Error(`Directory does not exist: ${root}`);
      }
      const fs = nodeFileSystem(root);
      if (!(await fs.directory("/"))) {
        throw new Error(`Not a directory: ${root}`);
      }

      const { matcher, ignoreFile } = await buildMatcher(root, opts);
      const archives = parseArchives(opts.archive ?? []);

      const start = Date.now();
      let lastTick = start;
      const manifest = await buildManifest(fs, {
        ...(opts.label !== undefined ? { label: opts.label } : {}),
        builtAt: new Date().toISOString(),
        ...(archives.length > 0 ? { archives } : {}),
        // `shouldKeep` and `shouldDescend` map exactly onto csfs's two hooks.
        // `prune` is the one that matters on a real install: an ignored subtree
        // that is still walked costs the walk, and NCSEXPER/DATEN alone is
        // 5,000 files.
        filter: (path) => matcher.shouldKeep(rel(path)),
        prune: (path) => !matcher.shouldDescend(`${rel(path)}/`),
        onProgress: (found, path) => {
          if (opts.verbose) {
            process.stdout.write(`${chalk.dim(`+ ${path}`)}\n`);
            return;
          }
          // Throttled, and on stderr, so `--out -`-style piping stays clean.
          if (Date.now() - lastTick < 250) return;
          lastTick = Date.now();
          process.stderr.write(`\r${chalk.dim(`${found.toLocaleString()} files…`)}    `);
        },
      });
      if (!opts.verbose) process.stderr.write("\r".padEnd(40) + "\r");
      const elapsedMs = Date.now() - start;

      const text = formatManifest(manifest, { pretty: opts.pretty ?? false });
      const count = Object.keys(manifest.files).length;
      let bytes = 0;
      for (const size of Object.values(manifest.files)) bytes += size;
      // The gzipped figure is the one that matters — every static host serves
      // it compressed, and it is what a consumer actually waits for on boot.
      const gzipped = gzipSync(Buffer.from(text)).byteLength;

      const out: string[] = [];
      out.push(chalk.bold("Done."));
      out.push(`  files    : ${chalk.green(count.toLocaleString())}`);
      out.push(`  bytes    : ${chalk.cyan((bytes / 1e9).toFixed(2))} GB described`);
      out.push(
        `  manifest : ${chalk.cyan((text.length / 1e6).toFixed(2))} MB ` +
          chalk.dim(`(${(gzipped / 1e6).toFixed(2)} MB gzipped, one request)`),
      );
      if (ignoreFile) out.push(`  ignoring : ${chalk.dim(ignoreFile)}`);
      if (opts.defaultIgnore) out.push(`  ignoring : ${chalk.dim("bundle default patterns")}`);
      for (const a of archives) {
        out.push(
          `  archive  : ${chalk.dim(`${a.archive} serves ${a.serves} (${a.entry ?? "relative"})`)}`,
        );
      }
      out.push(`  elapsed  : ${(elapsedMs / 1000).toFixed(2)}s`);
      process.stdout.write(out.join("\n") + "\n");

      warnAboutCaseCollisions(manifest);

      if (opts.dryRun) {
        process.stdout.write(chalk.gray("\n--dry-run: nothing written.\n"));
        return;
      }
      const target = opts.out ? resolve(opts.out) : resolve(root, MANIFEST_FILE);
      await writeFile(target, text, "utf-8");
      process.stdout.write(`\nwritten to ${chalk.bold(target)}\n`);
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exitCode = 1;
    }
  });

/** csfs paths are rooted; the matcher wants them relative and slash-free. */
function rel(path: string): string {
  return path.replace(/^\/+/, "");
}

/**
 * Every BMW app reads its install case-insensitively, so two paths differing
 * only in case are a real hazard rather than a curiosity: only one of them is
 * reachable, and a tree that quietly hides a file looks exactly like one that
 * never had it. Reported whether or not anyone asked.
 */
function warnAboutCaseCollisions(manifest: Parameters<typeof formatManifest>[0]): void {
  const collisions = new ManifestIndex(manifest, { caseInsensitive: true }).caseCollisions;
  if (collisions.length === 0) return;
  process.stderr.write(
    chalk.yellow(
      `\n${collisions.length} path${collisions.length === 1 ? "" : "s"} differ only in case. ` +
        "Read case-insensitively — which every bimmerz app does — only the first is reachable:\n",
    ),
  );
  for (const group of collisions.slice(0, 10)) {
    process.stderr.write(
      `  ${chalk.yellow(group[0])}${chalk.dim(` ← ${group.slice(1).join(", ")}`)}\n`,
    );
  }
  if (collisions.length > 10) {
    process.stderr.write(chalk.dim(`  … and ${collisions.length - 10} more\n`));
  }
}

function parseArchives(specs: string[]): ManifestArchive[] {
  return specs.map((spec) => {
    const [archive, serves, entry] = spec.split(":");
    if (!archive || !serves) {
      throw new Error(`--archive ${spec}: expected <archive>:<serves>[:basename]`);
    }
    if (entry !== undefined && entry !== "basename" && entry !== "relative") {
      throw new Error(`--archive ${spec}: entry must be "basename" or "relative"`);
    }
    return {
      archive,
      serves,
      ...(entry === "basename" ? { entry: "basename" as const } : {}),
    };
  });
}

async function buildMatcher(
  root: string,
  opts: ManifestCliOptions,
): Promise<{ matcher: IgnoreMatcher; ignoreFile?: string }> {
  /*
   * `index.json` is excluded alongside csfs's own two files because a tree
   * mid-migration has both descriptions in it, and describing 165 stale vfs
   * indexes in the new manifest is noise that outlives the migration.
   */
  const sources: string[] = [`${MANIFEST_FILE}\n.bimmerzignore\nindex.json\n`];
  if (opts.defaultIgnore) sources.push(DEFAULT_IGNORE);

  let ignoreFile = opts.ignore;
  if (!ignoreFile) {
    const candidate = resolve(root, ".bimmerzignore");
    if (existsSync(candidate)) ignoreFile = candidate;
  } else if (!existsSync(ignoreFile)) {
    throw new Error(`Ignore file not found: ${ignoreFile}`);
  }
  if (ignoreFile) sources.push(await readFile(ignoreFile, "utf-8"));

  return {
    matcher: createMatcher(sources),
    ...(ignoreFile ? { ignoreFile: relative(process.cwd(), ignoreFile) || ignoreFile } : {}),
  };
}
