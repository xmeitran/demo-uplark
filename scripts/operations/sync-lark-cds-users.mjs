import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  createLarkContactClient,
  fetchCdsDirectory,
  sanitizeRunSummary,
  syncCdsUsers
} from "./lark-cds-sync.mjs";

function valueArg(argv, name) {
  const prefix = `${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function failureDescriptor(error) {
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  const providerCode = Number.isInteger(error?.larkCode) ? error.larkCode : undefined;
  const safeCode = providerCode !== undefined
    ? `LARK_API_${providerCode}`
    : typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "DIRECTORY_SYNC_FAILED";
  return {
    code: safeCode,
    ...(status !== undefined ? { status } : {}),
    operation: typeof error?.operation === "string" && /^[a-z0-9._-]+$/.test(error.operation)
      ? error.operation
      : "directory_sync"
  };
}

export async function run(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const apply = argv.includes("--apply");
  if (argv.includes("--deactivate-missing")) {
    throw new Error("--deactivate-missing is disabled: this sync is additive-only.");
  }

  const appId = env.LARK_APP_ID;
  const appSecret = env.LARK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Missing LARK_APP_ID or LARK_APP_SECRET.");
  }

  const prisma = dependencies.prisma ?? new PrismaClient();
  const ownsPrisma = !dependencies.prisma;
  const tenantKey = env.FOUNDATION_TENANT_KEY ?? env.PRODUCTION_TENANT_KEY ?? "prod";
  const workspaceId = env.FOUNDATION_WORKSPACE_ID ?? "twk-foundation";
  const config = {
    tenantKey,
    workspaceId,
    workspaceKey: env.FOUNDATION_WORKSPACE_KEY ?? "default",
    workspaceName: env.FOUNDATION_WORKSPACE_NAME ?? "Default Workspace",
    departmentId: env.LARK_CDS_DEPARTMENT_ID ?? "CDS",
    departmentIdType: env.LARK_CDS_DEPARTMENT_ID_TYPE ?? "department_id"
  };
  const trigger = valueArg(argv, "--trigger") ?? "manual";
  const runId = valueArg(argv, "--run-id") ?? `lark-directory-sync:${new Date().toISOString()}:${randomUUID()}`;
  const client = createLarkContactClient({
    baseUrl: env.LARK_OPEN_API_BASE_URL ?? "https://open.larksuite.com/open-apis",
    appId,
    appSecret,
    timeoutMs: positiveInteger(env.LARK_DIRECTORY_HTTP_TIMEOUT_MS, 15_000, "LARK_DIRECTORY_HTTP_TIMEOUT_MS"),
    maxAttempts: positiveInteger(env.LARK_DIRECTORY_RETRY_ATTEMPTS, 3, "LARK_DIRECTORY_RETRY_ATTEMPTS"),
    fetchImpl: dependencies.fetchImpl,
    sleep: dependencies.sleep
  });

  let ledgerCreated = false;
  let ledgerCompletion;
  try {
    if (apply) {
      await prisma.integrationEventLog.create({
        data: {
          provider: "lark",
          eventType: "lark_directory_sync",
          externalEventId: runId,
          idempotencyKey: runId,
          status: "RECEIVED",
          payload: {
            trigger,
            apply: true,
            sourceDepartment: config.departmentId,
            state: "running"
          }
        }
      });
      ledgerCreated = true;
    }

    const directory = await fetchCdsDirectory(client, config);
    const summary = await syncCdsUsers(prisma, directory, { ...config, apply, trigger });

    if (apply) {
      ledgerCompletion = {
        status: summary.outcome === "SKIPPED_LOCKED" ? "IGNORED" : "PROCESSED",
        payload: sanitizeRunSummary(summary)
      };
    }
    return { ...summary, runId: apply ? runId : undefined };
  } catch (error) {
    if (apply && ledgerCreated) {
      const failure = failureDescriptor(error);
      ledgerCompletion = {
        status: "FAILED",
        errorMessage: JSON.stringify(failure),
        payload: {
          trigger,
          apply: true,
          sourceDepartment: config.departmentId,
          outcome: "FAILED",
          failure
        }
      };
    }
    throw error;
  } finally {
    if (apply && ledgerCreated && ledgerCompletion) {
      try {
        await prisma.integrationEventLog.update({
          where: { idempotencyKey: runId },
          data: {
            workspaceId: ledgerCompletion.status === "PROCESSED" ? workspaceId : undefined,
            status: ledgerCompletion.status,
            processedAt: new Date(),
            errorMessage: ledgerCompletion.errorMessage,
            payload: ledgerCompletion.payload
          }
        });
      } catch {
        console.error("Lark directory sync ledger completion update failed.");
      }
    }
    if (ownsPrisma) {
      await prisma.$disconnect();
    }
  }
}

async function main() {
  const summary = await run();
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(JSON.stringify(failureDescriptor(error)));
    process.exitCode = 1;
  });
}
