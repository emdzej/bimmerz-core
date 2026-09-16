/**
 * `bimmerz data` — umbrella for INPA data-management routines.
 *
 * Two ways to describe a tree for serving over HTTP, because HTTP cannot list
 * a directory and something has to write the listing:
 *
 * - `bimmerz data manifest` — one flat `csfs-manifest.json`, read by
 *   `@emdzej/csfs-http`. **Prefer this.**
 * - `bimmerz data index` — one `index.json` per directory, read by
 *   `@emdzej/bimmerz-vfs`'s `HttpDirectory`. Superseded, and kept only until
 *   inpax, ncsx, nfsx and dashx have moved off vfs.
 */
import { Command } from "commander";
import { indexCommand } from "./data/index-cmd.js";
import { manifestCommand } from "./data/manifest-cmd.js";

export const dataCommand = new Command("data").description(
  "Manage INPA data routines (indexing, etc.)",
);

dataCommand.addCommand(manifestCommand);
dataCommand.addCommand(indexCommand);
