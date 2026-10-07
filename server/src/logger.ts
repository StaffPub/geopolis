/**
 * GEOPOLIS — Logs structurés avec niveaux. Format lisible + contexte module.
 */
import { config } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level: LogLevel, module: string, message: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const line = `[${ts()}] [${level.toUpperCase()}] [${module}] ${message}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  if (data !== undefined) {
    try {
      out(line, typeof data === 'string' ? data : JSON.stringify(data));
    } catch {
      out(line, '[unserializable data]');
    }
  } else {
    out(line);
  }
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  child(module: string): Logger;
}

export function createLogger(module: string): Logger {
  return {
    debug: (m, d) => emit('debug', module, m, d),
    info: (m, d) => emit('info', module, m, d),
    warn: (m, d) => emit('warn', module, m, d),
    error: (m, d) => emit('error', module, m, d),
    child: (sub) => createLogger(`${module}:${sub}`),
  };
}

export const log = createLogger('GEOPOLIS');
