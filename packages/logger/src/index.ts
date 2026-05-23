/**
 * `@emdzej/bimmerz-logger` — shared structured logger for the bimmerz
 * family. See `README.md` for the design rationale and migration
 * notes; the in-source doc on each export carries the API details.
 *
 * Pino-shape `Logger` interface, hierarchical category resolution,
 * runtime-mutable central config, pluggable sink. Tree-shake-friendly
 * — the default entry doesn't pull pino in, so web bundles stay light.
 * Apps that want pino's JSON/pretty/file transports import the sink
 * from `@emdzej/bimmerz-logger/sinks/pino`.
 */

import { setDefaultSink } from './logger.js';
import { consoleSink } from './sinks/console.js';

// Install the default sink at module load. Apps can override via
// `configureLogger({ sink: … })` any time; this just ensures
// imports that never call `configureLogger` still emit somewhere.
setDefaultSink(consoleSink());

export { configureLogger, getLogger, getLoggerConfig } from './logger.js';
export { resolveLevel } from './categories.js';
export { LEVEL_VALUES, levelPasses } from './levels.js';

export { bufferSink, type BufferSink, type BufferSinkOptions } from './sinks/buffer.js';
export { consoleSink, type ConsoleSinkOptions } from './sinks/console.js';
export { multiSink } from './sinks/multi.js';
export { nullSink } from './sinks/null.js';

export type {
  LogBindings,
  LogCategory,
  LogLevel,
  LogRecord,
  Logger,
  LoggerConfig,
  Sink,
} from './types.js';
