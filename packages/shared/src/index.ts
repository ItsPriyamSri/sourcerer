/**
 * `@sourcerer/shared` — the domain core.
 *
 * Pure TypeScript, no I/O, no framework. The brain and the web app both import
 * this so a verdict computed on the server and a verdict recomputed in the browser
 * (when you type a price, with no network) are guaranteed to agree.
 */
export * from "./types.ts";
export * from "./money.ts";
export * from "./costs.ts";
export * from "./comps.ts";
export * from "./economics.ts";
export * from "./schemas.ts";
export * from "./prompts.ts";
