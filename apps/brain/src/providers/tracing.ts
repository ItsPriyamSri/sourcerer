import * as Sentry from "@sentry/node";
import { config } from "../env.ts";

/**
 * Tracing.
 *
 * The pipeline is hand-instrumented: `withSpan` wraps identify, comps and price, so a
 * run produces a real waterfall ("identify 4.2s on Gemma, comps 900ms, price 300ms")
 * and `captureError` attaches the route that produced a failure.
 *
 * What we do *not* claim: @sentry/node's Mastra integration, which emits the
 * framework's own gen_ai.* spans with token counts. That integration needs
 * `@mastra/observability` installed and Sentry preloaded before Mastra loads
 * (https://docs.sentry.io/platforms/javascript/guides/mastra/). Until it is wired up,
 * the spans here are ours — and every number in them is measured, not inferred.
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
    Sentry.init({
      dsn: config.sentry.dsn,
      tracesSampleRate: config.sentry.tracesSampleRate,
      environment: process.env.NODE_ENV ?? "local",
      release: process.env.SENTRY_RELEASE,
      /**
       * Photos and bids are personal, and v11 flipped the default the wrong way:
       * `sendDefaultPii` was removed, and an unset `dataCollection` now collects
       * genAI inputs/outputs and user info by default. The v10 `recordInputs`/
       * `recordOutputs` options used to sit here cast to `unknown`, so v11 ignored
       * them silently — meaning the first identify call would have shipped prompt
       * and image content to Sentry while the comment promised the opposite.
       */
      dataCollection: {
        genAI: { inputs: config.sentry.recordInputs, outputs: config.sentry.recordInputs },
        userInfo: false,
      },
    });
    // `init` does not throw on a malformed DSN, so "did not throw" is not the same
    // as "enabled". Ask the SDK.
    enabled = Sentry.isEnabled();
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

/**
 * Record a note about work that does not warrant a span.
 *
 * Deliberately not a breadcrumb: streamed spans carry no breadcrumbs, and a
 * breadcrumb only leaves the SDK attached to an error. A log arrives on its own.
 */
export function note(message: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.logger.info(message, data ?? {});
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext("sourcerer", context);
    Sentry.captureException(err);
  });
}

/**
 * Flush anything still buffered and disable the SDK.
 *
 * v11 sends spans on a ~5s timer, so a hard exit drops whatever finished inside the
 * last window. Returns immediately when tracing is off, which is the zero-key case.
 */
export async function shutdownTracing(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  await Sentry.close(timeoutMs).catch(() => {});
  enabled = false;
}
