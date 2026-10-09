import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadEnv({ quiet: true });

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, received ${value}`);
  }
  return parsed;
}

export interface AppConfig {
  databaseUrl: string;
  host: string;
  port: number;
  webOrigin: string;
  sessionTtlDays: number;
  nodeEnv: string;
}

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const databaseUrl = overrides.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    databaseUrl,
    host: overrides.host ?? process.env.API_HOST ?? "127.0.0.1",
    port: overrides.port ?? integer(process.env.API_PORT, 3001),
    webOrigin: overrides.webOrigin ?? process.env.WEB_ORIGIN ?? "http://localhost:3000",
    sessionTtlDays: overrides.sessionTtlDays ?? integer(process.env.SESSION_TTL_DAYS, 30),
    nodeEnv: overrides.nodeEnv ?? process.env.NODE_ENV ?? "development",
  };
}
