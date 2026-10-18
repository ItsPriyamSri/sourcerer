import { LibSQLStore } from "@mastra/libsql";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../env.ts";

/**
 * Mastra storage. Everything about the reseller — their queue, their threads with
 * the advisor — lives in a local SQLite file next to the app. Not a hosted vector
 * DB, not a SaaS. If you delete the folder, it is gone, which is the point.
 */

mkdirSync(config.dataDir, { recursive: true });

export const storage = new LibSQLStore({
  id: "sourcerer-storage",
  url: `file:${join(config.dataDir, "mastra.db")}`,
});
