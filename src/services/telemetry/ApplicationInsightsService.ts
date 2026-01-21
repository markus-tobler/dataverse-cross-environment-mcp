/**
 * Azure Monitor OpenTelemetry Service for Azure-deployed MCP server
 * Provides telemetry, logging, and monitoring integration with Azure Monitor
 * using the modern OpenTelemetry-based approach (recommended over classic SDK)
 */

import {
  useAzureMonitor,
  AzureMonitorOpenTelemetryOptions,
} from "@azure/monitor-opentelemetry";
import { trace, metrics, Span, SpanStatusCode } from "@opentelemetry/api";

export interface TelemetryProperties {
  [key: string]: string;
}

export interface TelemetryMetrics {
  [key: string]: number;
}

/**
 * Service that wraps Azure Monitor OpenTelemetry for the MCP server.
 * Automatically collects HTTP requests, dependencies (Dataverse API calls),
 * exceptions, and performance metrics when running in Azure.
 */
class ApplicationInsightsService {
  private isInitialized = false;
  private tracer: ReturnType<typeof trace.getTracer> | null = null;
  private meter: ReturnType<typeof metrics.getMeter> | null = null;

  // Custom metrics
  private toolInvocationCounter: ReturnType<
    ReturnType<typeof metrics.getMeter>["createCounter"]
  > | null = null;
  private toolDurationHistogram: ReturnType<
    ReturnType<typeof metrics.getMeter>["createHistogram"]
  > | null = null;

  /**
   * Initialize Azure Monitor OpenTelemetry with the connection string from environment.
   * Should be called as early as possible in the application startup.
   * Safe to call in environments without Application Insights configured.
   */
  initialize(): void {
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

    if (!connectionString) {
      console.log(
        "Application Insights connection string not found. Telemetry disabled.",
      );
      return;
    }

    try {
      const options: AzureMonitorOpenTelemetryOptions = {
        azureMonitorExporterOptions: {
          connectionString,
        },
        // Enable live metrics for real-time monitoring
        enableLiveMetrics: true,
        // Enable standard metrics collection
        enableStandardMetrics: true,
        // Instrumentation options
        instrumentationOptions: {
          // Track HTTP requests and dependencies
          http: { enabled: true },
          // Track Azure SDK calls
          azureSdk: { enabled: true },
        },
      };

      // Initialize Azure Monitor OpenTelemetry
      useAzureMonitor(options);

      // Create tracer and meter for custom telemetry
      this.tracer = trace.getTracer("dataverse-mcp-server", "1.0.0");
      this.meter = metrics.getMeter("dataverse-mcp-server", "1.0.0");

      // Initialize custom metrics
      this.toolInvocationCounter = this.meter.createCounter(
        "mcp_tool_invocations",
        {
          description: "Count of MCP tool invocations",
        },
      );

      this.toolDurationHistogram = this.meter.createHistogram(
        "mcp_tool_duration_ms",
        {
          description: "Duration of MCP tool invocations in milliseconds",
          unit: "ms",
        },
      );

      this.isInitialized = true;
      console.log("Azure Monitor OpenTelemetry initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Azure Monitor OpenTelemetry:", error);
    }
  }

  /**
   * Track a custom event using a span
   */
  trackEvent(
    name: string,
    properties?: TelemetryProperties,
    _metrics?: TelemetryMetrics,
  ): void {
    if (!this.tracer) return;

    const span = this.tracer.startSpan(name);
    if (properties) {
      Object.entries(properties).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }
    span.end();
  }

  /**
   * Track a custom metric
   */
  trackMetric(
    name: string,
    value: number,
    properties?: TelemetryProperties,
  ): void {
    if (!this.meter) return;

    // Create a gauge for the metric
    const gauge = this.meter.createObservableGauge(name, {
      description: `Custom metric: ${name}`,
    });

    const attributes = properties ? { ...properties } : {};
    gauge.addCallback((observableResult) => {
      observableResult.observe(value, attributes);
    });
  }

  /**
   * Track an exception
   */
  trackException(error: Error, properties?: TelemetryProperties): void {
    if (!this.tracer) return;

    const span = this.tracer.startSpan("exception");
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    if (properties) {
      Object.entries(properties).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }
    span.end();
  }

  /**
   * Track a trace message (logs are automatically collected via console)
   */
  trackTrace(
    message: string,
    severity: "verbose" | "info" | "warning" | "error" | "critical",
    properties?: TelemetryProperties,
  ): void {
    // With OpenTelemetry, console logs are automatically collected
    // We use console methods which are then captured by the SDK
    const propsString = properties ? ` | ${JSON.stringify(properties)}` : "";

    switch (severity) {
      case "verbose":
      case "info":
        console.log(`[${severity.toUpperCase()}] ${message}${propsString}`);
        break;
      case "warning":
        console.warn(`[WARNING] ${message}${propsString}`);
        break;
      case "error":
      case "critical":
        console.error(`[${severity.toUpperCase()}] ${message}${propsString}`);
        break;
    }
  }

  /**
   * Start a span for tracking an operation (returns a span that must be ended)
   */
  startSpan(name: string, attributes?: Record<string, string>): Span | null {
    if (!this.tracer) return null;

    const span = this.tracer.startSpan(name);
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }
    return span;
  }

  /**
   * Track MCP tool invocation with timing and result
   */
  trackToolInvocation(
    toolName: string,
    durationMs: number,
    success: boolean,
    user?: string,
    properties?: TelemetryProperties,
  ): void {
    if (!this.tracer) return;

    // Create a span for the tool invocation
    const span = this.tracer.startSpan(`MCP_ToolInvocation_${toolName}`);
    span.setAttribute("mcp.tool.name", toolName);
    span.setAttribute("mcp.tool.success", success);
    span.setAttribute("mcp.tool.duration_ms", durationMs);
    span.setAttribute("mcp.user", user || "unknown");

    if (properties) {
      Object.entries(properties).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }

    if (!success) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }

    span.end();

    // Record metrics
    if (this.toolInvocationCounter) {
      this.toolInvocationCounter.add(1, {
        "mcp.tool.name": toolName,
        "mcp.tool.success": success.toString(),
      });
    }

    if (this.toolDurationHistogram) {
      this.toolDurationHistogram.record(durationMs, {
        "mcp.tool.name": toolName,
        "mcp.tool.success": success.toString(),
      });
    }
  }

  /**
   * Track Dataverse API operation with optional exception tracking
   */
  trackDataverseOperation(
    operation: string,
    tableName: string,
    durationMs: number,
    success: boolean,
    properties?: TelemetryProperties,
    error?: Error,
  ): void {
    if (!this.tracer) return;

    const span = this.tracer.startSpan(`Dataverse_${operation}`);
    span.setAttribute("dataverse.operation", operation);
    span.setAttribute("dataverse.table", tableName);
    span.setAttribute("dataverse.duration_ms", durationMs);
    span.setAttribute("dataverse.success", success);

    if (properties) {
      Object.entries(properties).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }

    if (!success) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
      if (error) {
        span.recordException(error);
      }
    }

    span.end();
  }

  /**
   * Flush pending telemetry (useful before shutdown)
   * Note: OpenTelemetry SDK handles flushing automatically on shutdown
   */
  async flush(): Promise<void> {
    // OpenTelemetry SDK handles flushing automatically
    // Give a small delay to ensure telemetry is sent
    return new Promise<void>((resolve) => {
      setTimeout(resolve, 1000);
    });
  }

  /**
   * Check if Azure Monitor OpenTelemetry is initialized and ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get the tracer for advanced scenarios
   */
  getTracer(): ReturnType<typeof trace.getTracer> | null {
    return this.tracer;
  }

  /**
   * Get the meter for advanced scenarios
   */
  getMeter(): ReturnType<typeof metrics.getMeter> | null {
    return this.meter;
  }
}

/**
 * Setup global exception handlers for uncaught exceptions and unhandled promise rejections.
 * These handlers ensure that unexpected errors are logged to Application Insights before the process exits.
 */
function setupGlobalExceptionHandlers(
  service: ApplicationInsightsService,
): void {
  process.on("uncaughtException", (error: Error) => {
    console.error("[CRITICAL] Uncaught Exception:", error);
    service.trackException(error, {
      exceptionType: "uncaughtException",
      severity: "critical",
    });
    // Give time for telemetry to flush before exiting
    service.flush().finally(() => {
      process.exit(1);
    });
  });

  process.on(
    "unhandledRejection",
    (reason: unknown, promise: Promise<unknown>) => {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      console.error("[CRITICAL] Unhandled Promise Rejection:", error);
      service.trackException(error, {
        exceptionType: "unhandledRejection",
        severity: "critical",
      });
    },
  );

  // Graceful shutdown handling
  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}. Flushing telemetry and shutting down...`);
    await service.flush();
    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

// Export singleton instance
export const appInsightsService = new ApplicationInsightsService();

// Setup global exception handlers when the module is loaded
setupGlobalExceptionHandlers(appInsightsService);
