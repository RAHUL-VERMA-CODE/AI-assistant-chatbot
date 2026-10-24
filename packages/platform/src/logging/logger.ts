import { TenantContext } from '../../../core/src/index.ts';
import { PiiScrubber } from './pii-scrubber.ts';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export class Logger {
  private level: LogLevel;
  private minWeight: number;

  constructor(level: LogLevel = 'info') {
    this.level = level;
    this.minWeight = LEVEL_WEIGHT[level];
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
    this.minWeight = LEVEL_WEIGHT[level];
  }

  public trace(message: string, context?: Record<string, unknown>): void {
    this.write('trace', message, context);
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.write('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }

  public fatal(message: string, context?: Record<string, unknown>): void {
    this.write('fatal', message, context);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < this.minWeight) {
      return;
    }

    const tenantContext = TenantContext.get();
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message: PiiScrubber.scrub(message),
      tenantId: tenantContext?.tenantId,
      requestId: tenantContext?.requestId,
      userRef: tenantContext?.userRef,
      sessionId: tenantContext?.sessionId,
      ...(context ? PiiScrubber.scrubObject(context) : {}),
    };

    const serialized = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(serialized + '\n');
    } else {
      process.stdout.write(serialized + '\n');
    }
  }
}

export const logger = new Logger('info');
