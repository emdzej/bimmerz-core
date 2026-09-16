# Changelog

Notable changes, newest first.

Packages here are versioned **independently** — see [AGENTS.md](AGENTS.md#versioning) —
so each entry says which package moved and to what. Apps consume via `^x.y.z`
and migrate on their own schedule.

## 2026-09-16

### `@emdzej/bimmerz-vfs` 0.2.0 → 0.3.0 — deprecated

**Superseded by [csfs](https://github.com/emdzej/csfs).** Marked deprecated in
`package.json`, on every exported symbol with `@deprecated` (so a consumer sees
it struck through in the editor, with the csfs replacement named), and at the
top of the README.

Two reasons, and the licence is the bigger one:

- **csfs is MIT; this is PolyForm Noncommercial.** That has already cost real
  work: `ddtx` is GPL-3.0 and could not depend on vfs, so it hand-rolled three
  backends — a `fetch` wrapper, an OPFS walk, and an FSA walk with its own
  permission handling — and has since replaced all of it with a 30-line
  adapter over csfs.
- **csfs does more.** Byte-range reads (vfs downloads a whole file per lookup),
  zip archives read in place, a writable OPFS backend, `node:fs` for tooling,
  `directUrl()` for an `<img>`/`<iframe>` source, and a `walk()` generator.

csfs 0.2.0 closed the four gaps that were blocking the move: case-insensitive
HTTP lookups, lookups answering with the name as *stored* rather than as asked
for, a readable tree on a host that ignores `Range`, and symlinks surviving a
listing.

**Nothing in this repo imported vfs** — the four consumers (inpax, ncsx, nfsx,
dashx) are sibling repos, so nothing here had to change to make this safe. The
package stays published and working until those four have moved;
`notes/vfs-to-csfs-migration-eval.md` has the plan and the per-symbol
translation table. Only the code is deprecated, not deleted.

Registry-level deprecation is separate — `package.json` cannot set it, so an
install does not warn until `npm deprecate` is run against the published
versions.

### `@emdzej/bimmerz-cli` 0.1.0 → 0.2.0

**Added `bimmerz data manifest <dir>`** — writes one flat `csfs-manifest.json`
describing a tree, for `@emdzej/csfs-http` to serve over static HTTP. This is
what lets the apps move off vfs: `data index` writes the per-directory
`index.json` that only vfs reads, so until something wrote a csfs manifest, no
app could migrate.

Both commands exist because **HTTP cannot list a directory**, and differ only in
the shape of the description. A flat manifest is one map hit after a single
fetch, and its directories are *derived* from the file paths — which is what
lets a zip stand in for a directory that was never extracted. Per-directory
indexes cost a request per path level and cannot describe a directory that is
not on disk.

Measured on a real 13,048-file INPA install rather than assumed: the flat
manifest is **0.47 MB, 0.09 MB gzipped, in one request**, built in 0.44 s. The
per-directory equivalent is 0.39 MB across 165 files — no smaller in total,
because a directory's paths no longer share a compression window with the rest
of the tree, and it takes four serialised round trips to reach a file in
`EDIABAS/Ecu`. That is why the manifest stayed flat.

Options: `-o/--out`, `-l/--label`, `-i/--ignore`, `--default-ignore`,
`--archive <archive>:<serves>[:basename]`, `--pretty`, `--dry-run`,
`--verbose`.

- **Ignore handling reuses `@emdzej/bimmerz-ignore`**, the same matcher
  `bundle` uses, so a `.bimmerzignore` means one thing across both commands.
  Its `shouldKeep`/`shouldDescend` map onto csfs's `filter`/`prune`, and `prune`
  is the one that earns its place: an ignored subtree that is still walked costs
  the walk.
- **The default patterns are opt-in** here (`--default-ignore`), unlike
  `bundle` where they are opt-out. `bundle` produces a trimmed artifact, where
  dropping `*.exe` is the point; this describes a tree that already exists, and
  silently omitting files a caller can see on the host is the wrong default.
  `data index` did not apply them either.
- **`index.json` is excluded** alongside csfs's own two files. A tree
  mid-migration carries both descriptions, and 165 stale vfs indexes are noise
  that would outlive the migration.
- **Case collisions are reported** whether or not anyone asks. Every bimmerz
  app reads its install case-insensitively, so two paths differing only in case
  mean one of them is unreachable — and a tree that quietly hides a file looks
  exactly like one that never had it.

Verified end to end by serving the result over `python -m http.server`, which
ignores `Range`, and reading it back through `csfs-http` with
`caseInsensitive`: all four `discoverInpaInstall` drills resolved from
lower-cased paths to their canonical spellings, `SGDAT` listed its 1,798 IPOs,
and `/ediabas/ecu/ms420ds1.prg` came back as `MS420DS1.PRG` with all 552,030
bytes.

**`bimmerz data index` is superseded but kept.** It says so in `--help` and
prints a note when run. It goes when the last consumer stops reading an
`index.json`.

New dependencies: `@emdzej/csfs-manifest` and `@emdzej/csfs-node` at `^0.2.0`.
A PolyForm project depending on MIT is fine; the reverse would not be.
