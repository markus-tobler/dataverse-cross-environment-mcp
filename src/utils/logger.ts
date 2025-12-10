/**
 * Logger utility that handles output correctly based on execution mode
 * - STDIO mode: All output goes to stderr (stdout is reserved for JSON-RPC)
 * - HTTP mode: Uses console.log for info, console.error for errors
 */

export enum LogMode {
  STDIO = "stdio",
  HTTP = "http",
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private mode: LogMode = LogMode.HTTP;
  private logLevel: LogLevel = LogLevel.INFO;

  /**
   * Set the logging mode
   */
  setMode(mode: LogMode): void {
    this.mode = mode;
  }

  /**
   * Set the minimum log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Log an informational message
   */
  info(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.INFO) {
      return;
    }

    if (this.mode === LogMode.STDIO) {
      // In STDIO mode, use stderr to avoid polluting stdout
      console.error(message, ...args);
    } else {
      // In HTTP mode, use normal console.log
      console.log(message, ...args);
    }
  }

  /**
   * Log an error message
   */
  error(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.ERROR) {
      return;
    }
    console.error(message, ...args);
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.WARN) {
      return;
    }

    if (this.mode === LogMode.STDIO) {
      console.error(message, ...args);
    } else {
      console.warn(message, ...args);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.DEBUG) {
      return;
    }

    if (this.mode === LogMode.STDIO) {
      console.error(`[DEBUG] ${message}`, ...args);
    } else {
      console.debug(message, ...args);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
