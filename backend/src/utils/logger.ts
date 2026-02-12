/**
 * Simple structured logger for the application
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

class Logger {
  private level: LogLevel;
  private instanceId: string;

  constructor(level: LogLevel = LogLevel.INFO, instanceId: string = 'main') {
    this.level = level;
    this.instanceId = instanceId;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const meta = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${this.instanceId}] [${level}] ${message}${meta}`;
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, data));
    }
  }

  error(message: string, error?: Error | unknown): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      if (error instanceof Error) {
        console.error(this.formatMessage(LogLevel.ERROR, message, {
          message: error.message,
          stack: error.stack
        }));
      } else {
        console.error(this.formatMessage(LogLevel.ERROR, message, error));
      }
    }
  }
}

export default Logger;
