/**
 * Public types for `@emdzej/bimmerz-logger`. Apps and packages
 * consume these — concrete implementations stay private to this
 * package so we can swap them out without breaking call sites.
 */

/**
 * Severity ordering. `silent` blocks every line; `trace` lets
 * everything through. Same names + ordering as pino so call-site
 * idioms transfer 1:1.
 */
export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'silent';

/**
 * Free-form key/value context that rides alongside the message.
 * Each call passes its own bag; `Logger.child(bindings)` adds
 * permanent bindings that merge with every subsequent call.
 *
 * Values are intentionally `unknown` — callers can pass primitives,
 * objects, arrays, errors. Sinks decide how to render.
 */
export type LogBindings = Record<string, unknown>;

/**
 * One decoded log call, before any sink-side formatting.
 *
 * Sinks receive these and turn them into whatever the destination
 * needs — JSON lines for pino/file, formatted strings for the
 * browser console, structured objects for an in-memory ring.
 */
export interface LogRecord {
  /** Severity of this line (always above the effective threshold). */
  level: LogLevel;
  /**
   * Dot-separated category the logger was created with, or `null`
   * if the call came from the root logger (`getLogger()`).
   */
  category: string | null;
  /**
   * Merged bindings — `child()` permanent bindings plus any
   * per-call bindings. May be `{}` but is never null.
   */
  bindings: LogBindings;
  /** Human-readable message. */
  msg: string;
  /** `Date.now()` at the moment of the log call. */
  time: number;
}

/**
 * Destination for log records. Implementations are pluggable —
 * console sink for browsers, pino sink for Node, ring-buffer sink
 * for "Download log" UI features, etc. Compose multiple via
 * `multiSink(a, b, …)`.
 *
 * `write` is sync because every consumer we have today writes
 * synchronously (console.*, process.stdout, in-memory). If we
 * ever need async sinks (network shipping, IndexedDB) we'll
 * widen this.
 */
export interface Sink {
  write(record: LogRecord): void;
}

/**
 * Logger handle handed out by `getLogger()`. Pino-shape API so
 * existing call sites need no rewrites — but with `level` as a
 * read-only getter (it reflects the live category-resolved
 * threshold, not a per-instance mutable field). Use
 * `configureLogger()` to change levels at runtime.
 */
export interface Logger {
  /** Currently-effective level for this logger's category. Read-only. */
  readonly level: LogLevel;

  trace(msg: string): void;
  trace(bindings: LogBindings, msg: string): void;

  debug(msg: string): void;
  debug(bindings: LogBindings, msg: string): void;

  info(msg: string): void;
  info(bindings: LogBindings, msg: string): void;

  warn(msg: string): void;
  warn(bindings: LogBindings, msg: string): void;

  error(msg: string): void;
  error(bindings: LogBindings, msg: string): void;

  fatal(msg: string): void;
  fatal(bindings: LogBindings, msg: string): void;

  /**
   * Spawn a child logger that carries `bindings` on every call.
   * Inherits the parent's category — the child's effective level
   * still tracks the central config for that category.
   */
  child(bindings: LogBindings): Logger;
}

/**
 * Metadata describing one logger category. Libraries export an array
 * of these so consuming apps (web Settings dialogs, CLI help text)
 * can iterate the categories without hardcoding names:
 *
 * ```ts
 * // In a library
 * import type { LogCategory } from '@emdzej/bimmerz-logger';
 *
 * export const LOG_CATEGORIES = [
 *   { name: 'EDIABASX', hint: 'Catch-all — covers every subtree.' },
 *   { name: 'EDIABASX.ediabas', hint: 'SGBD load / job dispatch.' },
 * ] as const satisfies readonly LogCategory[];
 *
 * // In a consuming app
 * import { LOG_CATEGORIES as ediabasxCats } from '@emdzej/ediabasx-ediabas';
 * import { LOG_CATEGORIES as inpaxCats } from '@emdzej/inpax-interpreter';
 * const all = [...ediabasxCats, ...inpaxCats];
 * ```
 *
 * No runtime registry — composition is explicit at import time. Apps
 * that don't import a library don't see its categories (which is
 * correct — there's no point offering controls for code that isn't
 * loaded).
 */
export interface LogCategory {
  /** Dot-separated category path. Same format `getLogger()` accepts. */
  name: string;
  /**
   * One-line human-readable description of what this category covers.
   * Surfaced as a tooltip / sublabel in Settings UIs.
   */
  hint?: string;
}

/**
 * Central logger configuration. Apply via `configureLogger()`; the
 * call is sticky and merges with the existing config. All loggers
 * — including those handed out before the call — pick up the
 * new settings immediately.
 */
export interface LoggerConfig {
  /**
   * Default threshold when no `categories` entry matches. Applied
   * to the root logger and to any category that has no rule.
   */
  level: LogLevel;

  /**
   * Per-category thresholds. Keys are dot-separated category
   * paths; lookup walks up the path so a rule for `EDIABASX`
   * applies to `EDIABASX.parser` and `EDIABASX.parser.lexer`
   * unless a more specific rule wins.
   *
   * Example:
   * ```
   * { EDIABASX: 'debug', 'EDIABASX.parser': 'trace', INPAX: 'info' }
   * ```
   * — every `INPAX*` category at info; every `EDIABASX*` at debug
   * except `EDIABASX.parser*` which is at trace.
   */
  categories?: Record<string, LogLevel>;

  /**
   * Where formatted records are written. Defaults to `consoleSink()`
   * when omitted — works in both Node and browser, no dependencies.
   */
  sink?: Sink;
}
