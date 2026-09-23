import type { ProjectTaskSummary } from "@b2b-crm/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTaskDrafts, persistTaskDrafts, taskDraftsEnabled } from "./task-draft-storage";

const serverTask: ProjectTaskSummary = {
  id: "task-server",
  accountId: "acc-alpha",
  accountName: "Alpha Manufacturing",
  sortOrder: 10,
  title: "Server task",
  taskType: "implementation",
  status: "todo",
  priority: "medium",
  estimateMinutes: 60,
  loggedMinutes: 0,
  approvedMinutes: 0,
  overdue: false,
  customerVisible: false,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z"
};

describe("task draft storage", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDraftFlag = process.env.NEXT_PUBLIC_CRM_OFFLINE_DRAFTS;
  let writes: Array<{ key: string; value: string }>;
  let storage: Map<string, string>;

  beforeEach(() => {
    writes = [];
    storage = new Map<string, string>();
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          writes.push({ key, value });
          storage.set(key, value);
        }
      }
    };
  });

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("NEXT_PUBLIC_CRM_OFFLINE_DRAFTS", originalDraftFlag);
    delete (globalThis as any).window;
  });

  it("does not write or load localStorage drafts in production by default", () => {
    setEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_CRM_OFFLINE_DRAFTS;
    storage.set("lark_crm_custom_tasks_list", JSON.stringify([{ ...serverTask, id: "stale-local" }]));

    expect(taskDraftsEnabled()).toBe(false);
    expect(loadTaskDrafts([serverTask])).toEqual([serverTask]);

    persistTaskDrafts([{ ...serverTask, id: "local-write" }]);
    expect(writes).toEqual([]);
  });

  it("allows explicit offline drafts outside production trust mode", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_CRM_OFFLINE_DRAFTS", "1");

    persistTaskDrafts([{ ...serverTask, id: "saved-local" }]);
    expect(writes).toHaveLength(1);
    expect(loadTaskDrafts([serverTask])).toEqual([{ ...serverTask, id: "saved-local" }]);
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  setEnv(key, value);
}

function setEnv(key: string, value: string) {
  (process.env as Record<string, string | undefined>)[key] = value;
}
