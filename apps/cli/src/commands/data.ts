/**
 * `bimmerz data` — umbrella for INPA data-management routines.
 *
 * Today: `bimmerz data index` (write per-directory index.json files).
 */
import { Command } from 'commander';
import { indexCommand } from './data/index-cmd.js';

export const dataCommand = new Command('data').description(
  'Manage INPA data routines (indexing, etc.)',
);

dataCommand.addCommand(indexCommand);
