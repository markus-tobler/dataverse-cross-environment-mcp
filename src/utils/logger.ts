/**
 * Logger utility that handles output correctly based on execution mode
 * - STDIO mode: All output goes to stderr (stdout is reserved for JSON-RPC)
 * - HTTP mode: Uses console.log for info, console.error for errors
 *
 * In HTTP mode with Application Insights configured, console output is automatically
 * captured and sent to Azure Monitor via the setAutoCollectConsole feature.
 */

import {
  appInsightsService,
  TelemetryProperties,
} from "../services/telemetry/ApplicationInsightsService.js";

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

export interface LogProperties {
  [key: string]: string | number | boolean | undefined;
}

class Logger {
  private mode: LogMode = LogMode.HTTP;
  private logLevel: LogLevel = this.getLogLevelFromEnv();

  /**
   * Get log level from environment variable
   */
  private getLogLevelFromEnv(): LogLevel {
    const level = process.env.LOG_LEVEL?.toUpperCase();
    switch (level) {
      case "DEBUG":
        return LogLevel.DEBUG;
      case "INFO":
        return LogLevel.INFO;
      case "WARN":
        return LogLevel.WARN;
      case "ERROR":
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Format message with optional properties for structured logging
   */
  private formatMessage(message: string, properties?: LogProperties): string {
    if (!properties || Object.keys(properties).length === 0) {
      return message;
    }
    // Include properties in the message for Application Insights to parse
    return `${message} | ${JSON.stringify(properties)}`;
  }

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
      // Application Insights auto-collects this as a trace
      console.log(message, ...args);
    }
  }

  /**
   * Log an informational message with structured properties
   */
  infoWithProperties(message: string, properties: LogProperties): void {
    this.info(this.formatMessage(message, properties));
  }

  /**
   * Log an error message
   */
  error(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.ERROR) {
      return;
    }
    // Application Insights auto-collects console.error as error-level trace
    console.error(message, ...args);
  }

  /**
   * Log an error message with structured properties
   */
  errorWithProperties(message: string, properties: LogProperties): void {
    this.error(this.formatMessage(message, properties));
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
      // Application Insights auto-collects console.warn as warning-level trace
      console.warn(message, ...args);
    }
  }

  /**
   * Log a warning message with structured properties
   */
  warnWithProperties(message: string, properties: LogProperties): void {
    this.warn(this.formatMessage(message, properties));
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
      // Application Insights auto-collects console.debug as verbose-level trace
      console.debug(message, ...args);
    }
  }

  /**
   * Log a debug message with structured properties
   */
  debugWithProperties(message: string, properties: LogProperties): void {
    this.debug(this.formatMessage(message, properties));
  }

  /**
   * Log an error and track it in Application Insights as an exception.
   * Use this method for all errors that should be tracked in App Insights.
   * @param message - A descriptive message about the error context
   * @param error - The error object to log and track
   * @param properties - Optional structured properties for telemetry
   */
  exception(
    message: string,
    error: Error | unknown,
    properties?: LogProperties,
  ): void {
    // Convert unknown errors to Error objects
    const errorObj = error instanceof Error ? error : new Error(String(error));

    // Log to console (for local debugging and OpenTelemetry auto-collection)
    this.error(`${message}: ${errorObj.message}`, errorObj);

    // Convert LogProperties to TelemetryProperties (string values only)
    const telemetryProps: TelemetryProperties = {};
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (value !== undefined) {
          telemetryProps[key] = String(value);
        }
      }
    }
    telemetryProps["errorContext"] = message;

    // Track in Application Insights
    appInsightsService.trackException(errorObj, telemetryProps);
  }
}

// Export singleton instance
export const logger = new Logger();
