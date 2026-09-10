import { z } from "zod";

const optionalUrl = z.string().url().or(z.literal(""));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  DATABASE_URL: z.string().default("postgres://agent_team:agent_team@127.0.0.1:54329/agent_team"),
  REDIS_URL: z.string().default("redis://127.0.0.1:56379"),
  JWT_SECRET: z.string().min(32).default("development-jwt-secret-change-me-000000"),
  KEY_PROVIDER: z.enum(["local", "vault-transit"]).default("local"),
  ENCRYPTION_MASTER_KEY: z.string().default(""),
  VAULT_ADDR: optionalUrl.default(""),
  VAULT_TOKEN: z.string().default(""),
  VAULT_TRANSIT_KEY: z.string().default("agent-team"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  PUBLIC_API_URL: optionalUrl.default("http://127.0.0.1:8790"),
  OPENIM_API_URL: optionalUrl.default(""),
  OPENIM_PUBLIC_API_URL: optionalUrl.default(""),
  OPENIM_WS_URL: optionalUrl.default(""),
  OPENIM_ADMIN_TOKEN: z.string().default(""),
  OPENIM_CALLBACK_TOKEN: z.string().min(16).default("development-callback-token"),
  OPENIM_PLATFORM_ID: z.coerce.number().int().positive().default(4),
  HOST_LEASE_SECONDS: z.coerce.number().int().min(15).max(300).default(30),
  HOST_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(60).default(10),
});

export type AppConfig = z.infer<typeof envSchema>;

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): AppConfig => {
  const config = envSchema.parse(environment);
  if (config.NODE_ENV === "production") {
    if (config.JWT_SECRET.startsWith("development-")) {
      throw new Error("Production requires a non-default JWT_SECRET.");
    }
    if (config.KEY_PROVIDER !== "vault-transit") {
      throw new Error("Production requires KEY_PROVIDER=vault-transit.");
    }
    if (!config.VAULT_ADDR || !config.VAULT_TOKEN) {
      throw new Error("Production Vault Transit requires VAULT_ADDR and VAULT_TOKEN.");
    }
    if (config.OPENIM_CALLBACK_TOKEN.startsWith("development-")) {
      throw new Error("Production requires a non-default OPENIM_CALLBACK_TOKEN.");
    }
  }
  return config;
};
