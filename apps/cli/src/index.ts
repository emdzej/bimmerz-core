#!/usr/bin/env node
/**
 * bimmerz CLI — bundle and index BMW INPA/EDIABAS/NCS installs.
 *
 * Subcommands:
 *   bimmerz bundle    — curate a BMW install into a small zip
 *   bimmerz data      — data-management routines (indexing, etc.)
 */
import { Command } from 'commander';
import { configureLogger } from '@emdzej/bimmerz-logger';
import { resolveLoggerConfig } from './utils/logger-config.js';
import { bundleCommand } from './commands/bundle.js';
import { dataCommand } from './commands/data.js';

configureLogger(
  resolveLoggerConfig({
    env: process.env,
    isTty: process.stdout.isTTY ?? false,
  }),
);

const program = new Command();

program
  .name('bimmerz')
  .description('bimmerz — bundle and index BMW INPA/EDIABAS/NCS installs for web tools')
  .version('0.1.0');

program.addCommand(bundleCommand);
program.addCommand(dataCommand);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(2);
});
