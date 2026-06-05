/**
 * Map env vars onto a `@emdzej/bimmerz-logger` `LoggerConfig`. The
 * logger library never reads `process.env` (it has to stay browser-
 * portable); the CLI is the host that knows about env vars and
 * forwards them here.
 *
 *   BIMMERZ_LOG_LEVEL        trace|debug|info|warn|error|fatal|silent
 *   BIMMERZ_LOG_CATEGORIES   cat=level,cat=level,…
 *   BIMMERZ_LOG_DESTINATION  file path; logs go to file instead of stdout
 *   BIMMERZ_LOG_FORMAT       pretty|json — sink format
 */

import { pinoSink } from '@emdzej/bimmerz-logger/sinks/pino';
import type { LoggerConfig, LogLevel } from '@emdzej/bimmerz-logger';

export interface ResolveLoggerInputs {
  env: NodeJS.ProcessEnv;
  isTty?: boolean;
}

const VALID_LEVELS = new Set<LogLevel>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

function parseLevel(raw: string | undefined, where: string): LogLevel | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!VALID_LEVELS.has(trimmed as LogLevel)) {
    throw new Error(
      `${where}: invalid log level "${raw}" — expected one of ${[...VALID_LEVELS].join(', ')}`,
    );
  }
  return trimmed as LogLevel;
}

function parseCategories(raw: string | undefined): Record<string, LogLevel> | undefined {
  if (!raw) return undefined;
  const out: Record<string, LogLevel> = {};
  for (const pair of raw.split(',')) {
    const trimmedPair = pair.trim();
    if (trimmedPair === '') continue;
    const eq = trimmedPair.indexOf('=');
    if (eq < 0) {
      throw new Error(
        `BIMMERZ_LOG_CATEGORIES: expected "category=level" pairs, got "${pair}"`,
      );
    }
    const cat = trimmedPair.slice(0, eq).trim();
    const lvl = parseLevel(
      trimmedPair.slice(eq + 1),
      `BIMMERZ_LOG_CATEGORIES (entry "${trimmedPair}")`,
    );
    if (cat && lvl) out[cat] = lvl;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function resolveLoggerConfig(inputs: ResolveLoggerInputs): Partial<LoggerConfig> {
  const { env, isTty } = inputs;

  const envLevel = parseLevel(env.BIMMERZ_LOG_LEVEL, 'BIMMERZ_LOG_LEVEL');
  const envCategories = parseCategories(env.BIMMERZ_LOG_CATEGORIES);
  const envDestination = env.BIMMERZ_LOG_DESTINATION;
  const envFormatRaw = env.BIMMERZ_LOG_FORMAT?.trim().toLowerCase();
  const envPretty =
    envFormatRaw === 'pretty' ? true : envFormatRaw === 'json' ? false : undefined;
  if (envFormatRaw && envFormatRaw !== 'pretty' && envFormatRaw !== 'json') {
    throw new Error(
      `BIMMERZ_LOG_FORMAT: expected "pretty" or "json", got "${env.BIMMERZ_LOG_FORMAT}"`,
    );
  }

  return {
    level: envLevel ?? 'info',
    categories: envCategories,
    sink: pinoSink({
      pretty: envPretty ?? (envDestination ? false : isTty ?? false),
      destination: envDestination,
    }),
  };
}
