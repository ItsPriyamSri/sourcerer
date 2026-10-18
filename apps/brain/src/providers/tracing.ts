import * as Sentry from "@sentry/node";
import { config } from "../env.ts";

/**
 * Tracing.
 *
 * @sentry/node 11 auto-instruments Mastra (agent runs, tool calls, model calls)
 * and emits gen_ai.* spans with token usage and cost. That means we get a real
 * waterfall of "identify took 4.2s on Gemma, comps took 900ms, TabPFN took 300ms"
 * without hand-instrumenting the framework.
 *
 * With no DSN this is a no-op: the app runs identically, it just is not observed.
 */

let enabled = false;

export function initTracing(): boolean {
  if (!config.sentry.dsn) {
    enabled = false;
    return false;
  }
  try {
    const opts = {
      dsn: config.sentry.dsn,
      tracesSampleRate: config.sentry.tracesSampleRate,
      environment: process.env.NODE_ENV ?? "local",
      release: "sourcerer@0.1.0",
      // Photos and bids are personal. Keep them out of traces unless asked.
      recordInputs: config.sentry.recordInputs,
      recordOutputs: config.sentry.recordInputs,
      sendDefaultPii: false,
    } as unknown as Sentry.NodeOptions;
    Sentry.init(opts);
    enabled = true;
  } catch (err) {
    console.warn("[sentry] init failed:", err instanceof Error ? err.message : err);
    enabled = false;
  }
  return enabled;
}

export function tracingEnabled(): boolean {
  return enabled;
}

/** Wrap a unit of work in a span. No-ops (but still times) without a DSN. */
export async function withSpan<T>(
  name: string,
  op: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  return Sentry.startSpan({ name, op, attributes: attrs as never }, fn);
}

/** Record a metric-ish breadcrumb without a full span. */
export function note(message: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({ category: "sourcerer", message, level: "info", data });
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext("sourcerer", context);
    Sentry.captureException(err);
  });
}
