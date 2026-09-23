import assert from "node:assert/strict";
import test from "node:test";
import {
  createLarkContactClient,
  departmentIdForType,
  ensureIdentityLinks,
  fetchCdsDirectory,
  syncCdsUsers
} from "./lark-cds-sync.mjs";
import { failureDescriptor, run } from "./sync-lark-cds-users.mjs";

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] },
    json: async () => payload
  };
}

test("includes CDS root users, traverses descendants, and dedupes canonically by user_id", async () => {
  const usersByDepartment = {
    CDS: [
      { user_id: "u-root", open_id: "ou-root", name: "Root Member" },
      { user_id: "u-shared", open_id: "ou-shared", name: "Shared Member" }
    ],
    dep_delivery: [
      { user_id: "u-shared", open_id: "ou-shared", name: "Shared Member" },
      { user_id: "u-child", open_id: "ou-child", name: "Child Member" }
    ]
  };
  const client = {
    tenantAccessToken: async () => "token",
    paged: async (path, { params }) => path.includes("/children")
      ? [{ department_id: "dep_delivery", name: "Delivery", member_count: 2 }]
      : usersByDepartment[params.department_id],
    json: async (path) => {
      const userId = path.split("/").at(-1);
      const user = Object.values(usersByDepartment).flat().find((item) => item.user_id === userId);
      return { user };
    }
  };

  const directory = await fetchCdsDirectory(client, {
    departmentId: "CDS",
    departmentIdType: "department_id"
  });

  assert.deepEqual(directory.teams.map((team) => team.department_id), ["CDS", "dep_delivery"]);
  assert.equal(directory.users.length, 3);
  const shared = directory.users.find((row) => row.user.user_id === "u-shared");
  assert.deepEqual(shared.teams, ["CDS", "CDS_DELIVERY"]);
  assert.equal(shared.teamCode, "CDS_DELIVERY");
  assert.equal(shared.roleCode, "DELIVERY_LEAD");
});

test("uses descendant IDs matching departmentIdType", async () => {
  const requested = [];
  const client = {
    tenantAccessToken: async () => "token",
    paged: async (path, { params }) => {
      if (path.includes("/children")) {
        return [{
          department_id: "dep_custom",
          open_department_id: "od_open",
          name: "Delivery"
        }];
      }
      requested.push(params.department_id);
      return [];
    },
    json: async () => ({})
  };

  await fetchCdsDirectory(client, {
    departmentId: "od_root",
    departmentIdType: "open_department_id"
  });

  assert.deepEqual(requested, ["od_root", "od_open"]);
  assert.equal(
    departmentIdForType({ department_id: "custom", open_department_id: "open" }, "department_id"),
    "custom"
  );
});

test("membership precedence is deterministic and SALES_OWNER child wins", async () => {
  async function fetchWith(descendants) {
    const client = {
      tenantAccessToken: async () => "token",
      paged: async (path, { params }) => {
        if (path.includes("/children")) return descendants;
        return [{ user_id: "u-shared", open_id: "ou-shared", name: "Shared" }];
      },
      json: async () => ({
        user: { user_id: "u-shared", open_id: "ou-shared", name: "Shared" }
      })
    };
    return fetchCdsDirectory(client, {
      departmentId: "CDS",
      departmentIdType: "department_id"
    });
  }
  const departments = [
    { department_id: "dep_delivery", name: "Delivery" },
    { department_id: "dep_sales", name: "Marketing B2B" }
  ];
  const forward = await fetchWith(departments);
  const reverse = await fetchWith([...departments].reverse());

  assert.equal(forward.users[0].teamCode, "CDS_MARKETING_B2B");
  assert.equal(forward.users[0].roleCode, "SALES_OWNER");
  assert.deepEqual(forward.users[0].teams, reverse.users[0].teams);
  assert.equal(reverse.users[0].teamCode, forward.users[0].teamCode);
});

test("requires canonical user_id before fetching user detail", async () => {
  const client = {
    tenantAccessToken: async () => "token",
    paged: async (path) => path.includes("/children") ? [] : [{ open_id: "ou-only" }],
    json: async () => {
      throw new Error("detail must not be called");
    }
  };

  await assert.rejects(
    fetchCdsDirectory(client, { departmentId: "CDS", departmentIdType: "department_id" }),
    /requires user_id/
  );
});

test("guards against a repeated Lark pagination token", async () => {
  const client = createLarkContactClient({
    baseUrl: "https://example.test/open-apis",
    appId: "app",
    appSecret: "secret",
    fetchImpl: async () => response(200, {
      code: 0,
      data: { items: [], has_more: true, page_token: "same-token" }
    })
  });

  await assert.rejects(
    client.paged("/contact/v3/users/find_by_department", { token: "token", params: {} }),
    /pagination token did not advance/
  );
});

test("retries bounded transient failures and then succeeds", async () => {
  let attempts = 0;
  const sleeps = [];
  const client = createLarkContactClient({
    baseUrl: "https://example.test/open-apis",
    appId: "app",
    appSecret: "secret",
    maxAttempts: 3,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3
        ? response(503, { code: 999, msg: "temporary" })
        : response(200, { code: 0, data: { ok: true } });
    }
  });

  assert.deepEqual(await client.json("/test"), { ok: true });
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [250, 500]);
});

test("retries Lark frequency-limit code 99991400 even on non-429 HTTP", async () => {
  let attempts = 0;
  const client = createLarkContactClient({
    baseUrl: "https://example.test/open-apis",
    appId: "app",
    appSecret: "secret",
    maxAttempts: 3,
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3
        ? response(400, { code: 99991400, msg: "frequency limited" })
        : response(200, { code: 0, data: { ok: true } });
    }
  });

  assert.deepEqual(await client.json("/test"), { ok: true });
  assert.equal(attempts, 3);
});

test("rate-limit retry honors reset headers with bounded clamping", async () => {
  const sleeps = [];
  let attempts = 0;
  const client = createLarkContactClient({
    baseUrl: "https://example.test/open-apis",
    appId: "app",
    appSecret: "secret",
    maxAttempts: 2,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? response(400, { code: 99991400, msg: "limited" }, {
            "x-ogw-ratelimit-reset": "999",
            "retry-after": "1"
          })
        : response(200, { code: 0, data: { ok: true } });
    }
  });

  assert.deepEqual(await client.json("/test"), { ok: true });
  assert.deepEqual(sleeps, [60_000]);
});

test("rate-limit retry honors Retry-After when Lark reset header is absent", async () => {
  const sleeps = [];
  let attempts = 0;
  const client = createLarkContactClient({
    baseUrl: "https://example.test/open-apis",
    appId: "app",
    appSecret: "secret",
    maxAttempts: 2,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? response(429, { code: 99991400, msg: "limited" }, { "retry-after": "3" })
        : response(200, { code: 0, data: { ok: true } });
    }
  });

  await client.json("/test");
  assert.deepEqual(sleeps, [3_000]);
});

test("records department member count mismatches as degraded warnings", async () => {
  const client = {
    tenantAccessToken: async () => "token",
    paged: async (path) => path.includes("/children")
      ? [{ department_id: "dep_sales", name: "Sales", member_count: 2 }]
      : [],
    json: async () => ({})
  };

  const directory = await fetchCdsDirectory(client, {
    departmentId: "CDS",
    departmentIdType: "department_id"
  });

  assert.equal(directory.warnings.length, 1);
  assert.deepEqual(directory.warnings[0], {
    code: "DEPARTMENT_MEMBER_COUNT_MISMATCH",
    departmentCode: "CDS_SALES",
    expectedCount: 2,
    actualCount: 0
  });
});

test("dry-run returns a preview without touching Prisma", async () => {
  const prisma = new Proxy({}, {
    get() {
      throw new Error("Prisma must not be used in dry-run.");
    }
  });
  const summary = await syncCdsUsers(prisma, {
    teams: [{ department_id: "CDS" }],
    users: [],
    warnings: []
  }, {
    apply: false,
    trigger: "manual",
    departmentId: "CDS"
  });

  assert.equal(summary.apply, false);
  assert.equal(summary.fetchedDepartments, 1);
  assert.equal(summary.fetchedUsers, 0);
});

test("one-shot dry-run keeps IntegrationEventLog and all database APIs untouched", async () => {
  const prisma = new Proxy({}, {
    get(_target, property) {
      throw new Error(`Prisma.${String(property)} must not be used in dry-run.`);
    }
  });
  const fetchImpl = async (url) => {
    const path = String(url);
    if (path.includes("tenant_access_token")) {
      return response(200, { code: 0, tenant_access_token: "token" });
    }
    return response(200, { code: 0, data: { items: [], has_more: false } });
  };

  const summary = await run([], {
    LARK_APP_ID: "app",
    LARK_APP_SECRET: "secret",
    LARK_CDS_DEPARTMENT_ID: "CDS"
  }, {
    prisma,
    fetchImpl,
    sleep: async () => undefined
  });

  assert.equal(summary.apply, false);
  assert.equal(summary.runId, undefined);
});

function createMemoryPrisma({ lock = true } = {}) {
  const state = {
    workspaces: new Map(),
    teams: new Map(),
    roles: new Map(),
    users: new Map(),
    identities: new Map(),
    memberships: new Set(),
    bindings: new Map(),
    lockScopes: [],
    emailFallbackQueries: 0,
    businessWrites: 0
  };
  const identityKey = ({ provider, providerUserId, tenantKey }) => `${provider}:${providerUserId}:${tenantKey}`;
  const tx = {
    $queryRawUnsafe: async (sql, scope) => {
      state.lockScopes.push({ sql, scope });
      return [{ locked: lock }];
    },
    tenantWorkspace: {
      findUnique: async ({ where }) => {
        if (where.id) return state.workspaces.get(where.id);
        return [...state.workspaces.values()].find((row) =>
          row.tenantKey === where.tenantKey_workspaceKey.tenantKey
          && row.workspaceKey === where.tenantKey_workspaceKey.workspaceKey
        );
      },
      create: async ({ data }) => {
        state.businessWrites += 1;
        state.workspaces.set(data.id, { ...data });
        return { ...data };
      }
    },
    team: {
      findUnique: async ({ where }) => state.teams.get(where.code),
      create: async ({ data }) => {
        state.businessWrites += 1;
        state.teams.set(data.code, { ...data });
        return { ...data };
      }
    },
    role: {
      findUnique: async ({ where }) => state.roles.get(where.code),
      create: async ({ data }) => {
        state.businessWrites += 1;
        const role = { id: `role-${data.code}`, ...data };
        state.roles.set(data.code, role);
        return role;
      }
    },
    user: {
      findMany: async ({ where }) => {
        state.emailFallbackQueries += 1;
        const emails = new Set(
          where.OR.map((condition) => condition.email.equals.toLowerCase())
        );
        return [...state.users.values()]
          .filter((user) => emails.has(user.email.toLowerCase()))
          .map((user) => ({
            ...user,
            identities: [...state.identities.values()]
              .filter((identity) => identity.userId === user.id && identity.provider === "lark_user_id")
              .map((identity) => ({ providerUserId: identity.providerUserId }))
          }));
      },
      create: async ({ data }) => {
        state.businessWrites += 1;
        state.users.set(data.id, { ...data });
        return { ...data };
      },
      update: async ({ where, data }) => {
        state.businessWrites += 1;
        const user = { ...state.users.get(where.id), ...data };
        state.users.set(where.id, user);
        return user;
      }
    },
    portalIdentity: {
      findUnique: async ({ where }) => {
        const row = state.identities.get(identityKey(where.provider_providerUserId_tenantKey));
        return row ? { ...row, user: state.users.get(row.userId) } : null;
      },
      create: async ({ data }) => {
        state.businessWrites += 1;
        const row = { id: `identity-${state.identities.size}`, ...data };
        state.identities.set(identityKey(data), row);
        return row;
      }
    },
    teamMember: {
      findUnique: async ({ where }) => state.memberships.has(
        `${where.teamId_userId.teamId}:${where.teamId_userId.userId}`
      ) ? { id: "membership" } : null,
      create: async ({ data }) => {
        state.businessWrites += 1;
        state.memberships.add(`${data.teamId}:${data.userId}`);
        return data;
      }
    },
    roleBinding: {
      findUnique: async ({ where }) => state.bindings.get(
        JSON.stringify(where.userId_roleId_tenantKey_workspaceId)
      ),
      create: async ({ data }) => {
        state.businessWrites += 1;
        const key = JSON.stringify({
          userId: data.userId,
          roleId: data.roleId,
          tenantKey: data.tenantKey,
          workspaceId: data.workspaceId
        });
        const binding = { ...data, endsAt: null };
        state.bindings.set(key, binding);
        return binding;
      },
      update: async ({ where, data }) => {
        state.businessWrites += 1;
        const key = JSON.stringify(where.userId_roleId_tenantKey_workspaceId);
        const binding = { ...state.bindings.get(key), ...data };
        state.bindings.set(key, binding);
        return binding;
      }
    }
  };
  return {
    state,
    $transaction: async (callback) => callback(tx)
  };
}

test("serialized repeat apply is idempotent with zero second-run business writes", async () => {
  const prisma = createMemoryPrisma();
  const directory = {
    teams: [
      { department_id: "CDS" },
      { department_id: "dep_sales", name: "Marketing B2B" }
    ],
    users: [{
      user: {
        user_id: "u-1",
        open_id: "ou-1",
        name: "Member",
        email: "member@example.test",
        status: {}
      },
      teamCode: "CDS_MARKETING_B2B",
      teamName: "Marketing B2B",
      teams: ["CDS", "CDS_MARKETING_B2B"],
      roleCode: "SALES_OWNER"
    }],
    warnings: []
  };
  const config = {
    apply: true,
    trigger: "manual",
    departmentId: "CDS",
    tenantKey: "prod",
    workspaceId: "twk-foundation",
    workspaceKey: "default",
    workspaceName: "Default Workspace"
  };

  const first = await syncCdsUsers(prisma, directory, config);
  const writesAfterFirst = prisma.state.businessWrites;
  const second = await syncCdsUsers(prisma, directory, { ...config, trigger: "scheduled" });

  assert.equal(first.outcome, "APPLIED");
  assert.ok(writesAfterFirst > 0);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.identitiesLinked, 0);
  assert.equal(second.rolesBound, 0);
  assert.equal(second.teamMemberships, 0);
  assert.equal(prisma.state.businessWrites, writesAfterFirst);
  assert.equal(prisma.state.lockScopes[0].scope, prisma.state.lockScopes[1].scope);
  assert.match(prisma.state.lockScopes[0].sql, /pg_try_advisory_xact_lock/);
});

function singleUserDirectory(overrides = {}) {
  return {
    teams: [
      { department_id: "CDS" },
      { department_id: "dep_sales", name: "Marketing B2B" }
    ],
    users: [{
      user: {
        user_id: "u-1",
        open_id: "ou-1",
        name: "Member",
        email: "member@example.test",
        status: {},
        ...overrides
      },
      teamCode: "CDS_MARKETING_B2B",
      teamName: "Marketing B2B",
      teams: ["CDS", "CDS_MARKETING_B2B"],
      roleCode: "SALES_OWNER"
    }],
    warnings: []
  };
}

const applyConfig = {
  apply: true,
  trigger: "manual",
  departmentId: "CDS",
  tenantKey: "prod",
  workspaceId: "twk-foundation",
  workspaceKey: "default",
  workspaceName: "Default Workspace"
};

test("normalized email safely backfills canonical and open identities onto one User", async () => {
  const prisma = createMemoryPrisma();
  prisma.state.users.set("existing-user", {
    id: "existing-user",
    email: "Member@Example.Test",
    displayName: "Member",
    departmentCode: "CDS_MARKETING_B2B",
    subjectType: "INTERNAL_USER",
    status: "ACTIVE"
  });

  const summary = await syncCdsUsers(
    prisma,
    singleUserDirectory({ email: "  MEMBER@EXAMPLE.TEST  " }),
    applyConfig
  );
  const identities = [...prisma.state.identities.values()];

  assert.equal(summary.created, 0);
  assert.equal(summary.updated, 1);
  assert.equal(summary.identitiesLinked, 2);
  assert.deepEqual(new Set(identities.map((identity) => identity.userId)), new Set(["existing-user"]));
  assert.equal(prisma.state.emailFallbackQueries, 1);
  assert.equal(prisma.state.users.get("existing-user").email, "member@example.test");
});

test("canonical and open identity matches take precedence over normalized email", async () => {
  const canonicalPrisma = createMemoryPrisma();
  canonicalPrisma.state.users.set("canonical-user", {
    id: "canonical-user",
    email: "canonical@example.test",
    displayName: "Canonical",
    departmentCode: "CDS_MARKETING_B2B",
    subjectType: "INTERNAL_USER",
    status: "ACTIVE"
  });
  canonicalPrisma.state.users.set("email-owner", {
    id: "email-owner",
    email: "member@example.test",
    displayName: "Email Owner",
    status: "ACTIVE"
  });
  canonicalPrisma.state.identities.set("lark_user_id:u-1:prod", {
    userId: "canonical-user",
    provider: "lark_user_id",
    providerUserId: "u-1",
    tenantKey: "prod"
  });
  await syncCdsUsers(canonicalPrisma, singleUserDirectory(), applyConfig);
  assert.equal(canonicalPrisma.state.emailFallbackQueries, 0);
  assert.equal(canonicalPrisma.state.identities.get("lark:ou-1:prod").userId, "canonical-user");

  const openPrisma = createMemoryPrisma();
  openPrisma.state.users.set("open-user", {
    id: "open-user",
    email: "open@example.test",
    displayName: "Open",
    departmentCode: "CDS_MARKETING_B2B",
    subjectType: "INTERNAL_USER",
    status: "ACTIVE"
  });
  openPrisma.state.users.set("email-owner", {
    id: "email-owner",
    email: "member@example.test",
    displayName: "Email Owner",
    status: "ACTIVE"
  });
  openPrisma.state.identities.set("lark:ou-1:prod", {
    userId: "open-user",
    provider: "lark",
    providerUserId: "ou-1",
    tenantKey: "prod"
  });
  await syncCdsUsers(openPrisma, singleUserDirectory(), applyConfig);
  assert.equal(openPrisma.state.emailFallbackQueries, 0);
  assert.equal(openPrisma.state.identities.get("lark_user_id:u-1:prod").userId, "open-user");
});

test("normalized email fallback rejects ambiguous and canonical-conflicting ownership", async () => {
  const ambiguous = createMemoryPrisma();
  ambiguous.state.users.set("enterprise-owner", {
    id: "enterprise-owner",
    email: "enterprise@example.test",
    displayName: "Enterprise",
    status: "ACTIVE"
  });
  ambiguous.state.users.set("personal-owner", {
    id: "personal-owner",
    email: "personal@example.test",
    displayName: "Personal",
    status: "ACTIVE"
  });
  await assert.rejects(
    syncCdsUsers(ambiguous, singleUserDirectory({
      enterprise_email: "ENTERPRISE@example.test",
      email: "PERSONAL@example.test"
    }), applyConfig),
    (error) => error.code === "LARK_EMAIL_AMBIGUOUS"
  );

  const conflicting = createMemoryPrisma();
  conflicting.state.users.set("email-owner", {
    id: "email-owner",
    email: "member@example.test",
    displayName: "Owner",
    status: "ACTIVE"
  });
  conflicting.state.identities.set("lark_user_id:other-user-id:prod", {
    userId: "email-owner",
    provider: "lark_user_id",
    providerUserId: "other-user-id",
    tenantKey: "prod"
  });
  await assert.rejects(
    syncCdsUsers(conflicting, singleUserDirectory(), applyConfig),
    (error) => error.code === "LARK_EMAIL_CANONICAL_CONFLICT"
  );
});

test("apply returns SKIPPED_LOCKED without business writes when advisory lock is busy", async () => {
  const prisma = createMemoryPrisma({ lock: false });
  const summary = await syncCdsUsers(prisma, {
    teams: [],
    users: [],
    warnings: []
  }, {
    apply: true,
    trigger: "manual",
    departmentId: "CDS",
    tenantKey: "prod",
    workspaceId: "twk-foundation",
    workspaceKey: "default",
    workspaceName: "Default Workspace"
  });

  assert.equal(summary.outcome, "SKIPPED_LOCKED");
  assert.equal(prisma.state.businessWrites, 0);
});

test("one-shot ledger records SKIPPED_LOCKED when the advisory apply lock is busy", async () => {
  const prisma = createMemoryPrisma({ lock: false });
  const ledgerUpdates = [];
  prisma.integrationEventLog = {
    create: async () => ({}),
    update: async ({ data }) => {
      ledgerUpdates.push(data);
      return data;
    }
  };
  const fetchImpl = async (url) => String(url).includes("tenant_access_token")
    ? response(200, { code: 0, tenant_access_token: "token" })
    : response(200, { code: 0, data: { items: [], has_more: false } });

  const summary = await run(["--apply", "--run-id=locked-run"], {
    LARK_APP_ID: "app",
    LARK_APP_SECRET: "secret",
    LARK_CDS_DEPARTMENT_ID: "CDS"
  }, {
    prisma,
    fetchImpl,
    sleep: async () => undefined
  });

  assert.equal(summary.outcome, "SKIPPED_LOCKED");
  assert.equal(ledgerUpdates.length, 1);
  assert.equal(ledgerUpdates[0].status, "IGNORED");
  assert.equal(ledgerUpdates[0].payload.outcome, "SKIPPED_LOCKED");
  assert.equal(prisma.state.businessWrites, 0);
});

test("existing workspace is validated without rename or reactivation", async () => {
  const prisma = createMemoryPrisma();
  prisma.state.workspaces.set("twk-foundation", {
    id: "twk-foundation",
    tenantKey: "prod",
    workspaceKey: "default",
    name: "Existing Production Name",
    status: "active"
  });
  await syncCdsUsers(prisma, {
    teams: [],
    users: [],
    warnings: []
  }, {
    apply: true,
    trigger: "manual",
    departmentId: "CDS",
    tenantKey: "prod",
    workspaceId: "twk-foundation",
    workspaceKey: "default",
    workspaceName: "Replacement Name"
  });

  assert.equal(prisma.state.workspaces.get("twk-foundation").name, "Existing Production Name");

  prisma.state.workspaces.get("twk-foundation").status = "suspended";
  await assert.rejects(
    syncCdsUsers(prisma, {
      teams: [],
      users: [],
      warnings: []
    }, {
      apply: true,
      trigger: "manual",
      departmentId: "CDS",
      tenantKey: "prod",
      workspaceId: "twk-foundation",
      workspaceKey: "default",
      workspaceName: "Replacement Name"
    }),
    (error) => error.code === "WORKSPACE_TARGET_INVALID"
  );
  assert.equal(prisma.state.workspaces.get("twk-foundation").status, "suspended");
});

test("guarded identity create detects a concurrent split after unique conflict", async () => {
  const identities = new Map();
  const key = (provider, id) => `${provider}:${id}`;
  const tx = {
    portalIdentity: {
      findUnique: async ({ where }) => {
        const lookup = where.provider_providerUserId_tenantKey;
        return identities.get(key(lookup.provider, lookup.providerUserId)) ?? null;
      },
      create: async ({ data }) => {
        if (data.provider === "lark_user_id") {
          identities.set(key(data.provider, data.providerUserId), { ...data, userId: "other-user" });
          const error = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        const row = { ...data };
        identities.set(key(data.provider, data.providerUserId), row);
        return row;
      }
    }
  };

  await assert.rejects(
    ensureIdentityLinks(tx, {
      canonicalUserId: "u-1",
      currentOpenId: "ou-1",
      tenantKey: "prod",
      userId: "target-user"
    }),
    (error) => error.code === "LARK_IDENTITY_SPLIT"
  );
});

test("failure ledger descriptor never stores raw provider message, path, or user ID", async () => {
  const updates = [];
  const prisma = {
    integrationEventLog: {
      create: async () => ({}),
      update: async ({ data }) => {
        updates.push(data);
        return data;
      }
    }
  };
  const rawMessage = "failed /contact/v3/users/u-secret for user_id=u-secret";
  await assert.rejects(run(["--apply"], {
    LARK_APP_ID: "app",
    LARK_APP_SECRET: "secret"
  }, {
    prisma,
    fetchImpl: async () => response(400, { code: 40004, msg: rawMessage }),
    sleep: async () => undefined
  }));

  assert.equal(updates.length, 1);
  assert.deepEqual(JSON.parse(updates[0].errorMessage), {
    code: "LARK_API_40004",
    status: 400,
    operation: "lark.auth.tenant_token"
  });
  assert.equal(JSON.stringify(updates[0]).includes("u-secret"), false);
  assert.deepEqual(failureDescriptor({ message: rawMessage }), {
    code: "DIRECTORY_SYNC_FAILED",
    operation: "directory_sync"
  });
});
