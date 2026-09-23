import type { INestApplication } from "@nestjs/common";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

const DEFAULT_PRODUCTION_ORIGINS = [
  "https://b2b-crm.mindtheoperation.com",
  "https://lark-upbase.mindtheoperation.com"
];

function splitEnvList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function buildAllowedCorsOrigins(env: NodeJS.ProcessEnv = process.env) {
  const configuredOrigins = [
    ...splitEnvList(env.CRM_API_CORS_ORIGINS),
    env.APP_PUBLIC_ORIGIN,
    env.PUBLIC_APP_URL,
    env.PUBLIC_WEB_URL,
    env.NEXT_PUBLIC_API_URL
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(toOrigin)
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_PRODUCTION_ORIGINS, ...configuredOrigins]));
}

export function isCorsOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!origin) return true;

  const normalizedOrigin = toOrigin(origin);
  if (!normalizedOrigin) return false;

  if (buildAllowedCorsOrigins(env).includes(normalizedOrigin)) {
    return true;
  }

  if (env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin)) {
    return true;
  }

  return false;
}

export function buildCorsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  return {
    origin(origin, callback) {
      callback(null, isCorsOriginAllowed(origin, env) ? origin || true : false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "accept", "x-requested-with"]
  };
}

export function configureAppSecurity(app: INestApplication) {
  const expressInstance = app.getHttpAdapter().getInstance?.();
  expressInstance?.disable?.("x-powered-by");
  app.enableCors(buildCorsOptions());
}
