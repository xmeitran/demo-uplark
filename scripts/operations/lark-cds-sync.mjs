const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_LARK_CODES = new Set([99991400, 190004, 190005, 190010]);

function stableId(prefix, value) {
  return `${prefix}-${value}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function teamCode(name) {
  return `CDS_${String(name ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function roleForTeam(name) {
  return name === "Business Development" || name === "Marketing B2B" ? "SALES_OWNER" : "DELIVERY_LEAD";
}

function avatarUrl(user) {
  return user.avatar?.avatar_72 ?? user.avatar?.avatar_240 ?? user.avatar?.avatar_origin ?? undefined;
}

function bestEmail(user, existingEmail) {
  return existingEmail ?? user.enterprise_email ?? user.email ?? `${user.user_id}@lark.local`;
}

function normalizedEmails(user) {
  return [...new Set(
    [user.enterprise_email, user.email]
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function isActive(user) {
  return !user.status?.is_resigned && !user.status?.is_exited && !user.status?.is_frozen && !user.status?.is_unjoin;
}

function retryAfterMs(response, attempt) {
  const candidates = [];
  const resetSeconds = Number(response?.headers?.get?.("x-ogw-ratelimit-reset"));
  if (Number.isFinite(resetSeconds) && resetSeconds >= 0) {
    candidates.push(resetSeconds * 1000);
  }
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      candidates.push(seconds * 1000);
    } else {
      const dateMs = Date.parse(retryAfter);
      if (Number.isFinite(dateMs)) candidates.push(Math.max(dateMs - Date.now(), 0));
    }
  }
  const fallback = Math.min(250 * 2 ** (attempt - 1), 2_000);
  return Math.min(Math.max(candidates.length ? Math.max(...candidates) : fallback, 0), 60_000);
}

function operationForPath(method, path) {
  if (path.includes("tenant_access_token")) return "lark.auth.tenant_token";
  if (path.endsWith("/children")) return "lark.contact.departments.children";
  if (path.includes("find_by_department")) return "lark.contact.users.by_department";
  if (path.includes("/contact/v3/users/")) return "lark.contact.user.detail";
  return `lark.${method.toLowerCase()}.request`;
}

function apiError(method, path, status, payload) {
  const operation = operationForPath(method, path);
  const error = new Error(`Lark request failed during ${operation}.`);
  error.status = status;
  error.larkCode = payload?.code;
  error.operation = operation;
  return error;
}

export function createLarkContactClient({
  baseUrl,
  appId,
  appSecret,
  timeoutMs = 15_000,
  maxAttempts = 3,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  async function json(path, { params, method = "GET", body, token } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`Lark request timed out after ${timeoutMs}ms`)), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {})
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
        const payload = await response.json();
        if (response.ok && payload.code === 0) {
          return payload.data ?? payload;
        }
        const error = apiError(method, path, response.status, payload);
        const retryable = RETRYABLE_HTTP_STATUS.has(response.status)
          || RETRYABLE_LARK_CODES.has(Number(payload?.code));
        if (!retryable || attempt === maxAttempts) throw error;
        lastError = error;
      } catch (error) {
        const status = error?.status;
        if ((status && !RETRYABLE_HTTP_STATUS.has(status)) || attempt === maxAttempts) throw error;
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      await sleep(retryAfterMs(response, attempt));
    }
    throw lastError ?? new Error(`Lark API failed ${method} ${path}.`);
  }

  async function tenantAccessToken() {
    const data = await json("/auth/v3/tenant_access_token/internal", {
      method: "POST",
      body: { app_id: appId, app_secret: appSecret }
    });
    if (!data.tenant_access_token) throw new Error("Lark tenant_access_token was not returned.");
    return data.tenant_access_token;
  }

  async function paged(path, { params, token, maxPages = 1000 }) {
    const items = [];
    const seenTokens = new Set();
    let pageToken;
    for (let page = 0; page < maxPages; page += 1) {
      const data = await json(path, {
        token,
        params: { ...params, page_size: 50, page_token: pageToken }
      });
      items.push(...(data.items ?? []));
      if (!data.has_more) return items;
      const nextToken = data.page_token;
      if (!nextToken || seenTokens.has(nextToken)) {
        throw new Error(`Lark pagination token did not advance for ${path}.`);
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }
    throw new Error(`Lark pagination exceeded ${maxPages} pages for ${path}.`);
  }

  return { json, paged, tenantAccessToken };
}

function countWarning(department, actualCount) {
  const expectedCount = Number(department.member_count);
  if (!Number.isFinite(expectedCount) || expectedCount === actualCount) return undefined;
  return {
    code: "DEPARTMENT_MEMBER_COUNT_MISMATCH",
    departmentCode: department.isRoot ? "CDS" : teamCode(department.name),
    expectedCount,
    actualCount
  };
}

export function departmentIdForType(department, departmentIdType) {
  const value = departmentIdType === "open_department_id"
    ? department.open_department_id
    : department.department_id;
  if (!value) {
    throw new Error(`Lark department response is missing ${departmentIdType}.`);
  }
  return value;
}

function primaryMembership(memberships) {
  return [...memberships].sort((left, right) => {
    const roleRank = Number(right.roleCode === "SALES_OWNER") - Number(left.roleCode === "SALES_OWNER");
    if (roleRank !== 0) return roleRank;
    const childRank = Number(left.isRoot) - Number(right.isRoot);
    if (childRank !== 0) return childRank;
    return left.teamCode.localeCompare(right.teamCode);
  })[0];
}

export async function fetchCdsDirectory(client, { departmentId, departmentIdType }) {
  const token = await client.tenantAccessToken();
  const descendants = await client.paged(`/contact/v3/departments/${encodeURIComponent(departmentId)}/children`, {
    token,
    params: {
      department_id_type: departmentIdType,
      user_id_type: "user_id",
      fetch_child: true
    }
  });
  const departments = [
    {
      name: "CDS",
      department_id: departmentIdType === "department_id" ? departmentId : undefined,
      open_department_id: departmentIdType === "open_department_id" ? departmentId : undefined,
      isRoot: true
    },
    ...descendants.map((department) => ({ ...department, isRoot: false }))
  ];
  const warnings = [];
  const detailCache = new Map();
  const rows = [];

  for (const department of departments) {
    const resolvedDepartmentId = departmentIdForType(department, departmentIdType);
    const users = await client.paged("/contact/v3/users/find_by_department", {
      token,
      params: {
        department_id: resolvedDepartmentId,
        department_id_type: departmentIdType,
        user_id_type: "user_id"
      }
    });
    const warning = countWarning(department, users.length);
    if (warning) warnings.push(warning);

    for (const listedUser of users) {
      const canonicalUserId = listedUser.user_id;
      if (!canonicalUserId) {
        throw new Error("Lark Contact sync requires user_id. Confirm scope contact:user.employee_id:readonly is enabled.");
      }
      let detail = detailCache.get(canonicalUserId);
      if (!detail) {
        const data = await client.json(`/contact/v3/users/${encodeURIComponent(canonicalUserId)}`, {
          token,
          params: {
            user_id_type: "user_id",
            department_id_type: departmentIdType
          }
        });
        detail = data.user ?? {};
        detailCache.set(canonicalUserId, detail);
      }
      const currentUser = { ...listedUser, ...detail, user_id: canonicalUserId };
      if (!currentUser.open_id) {
        const error = new Error("Lark Contact detail did not return the current open_id.");
        error.code = "LARK_OPEN_ID_REQUIRED";
        error.operation = "lark.contact.user.detail";
        throw error;
      }
      const code = department.isRoot ? "CDS" : teamCode(department.name);
      rows.push({
        teamName: department.isRoot ? "CHUYEN DOI SO" : department.name,
        teamDepartmentId: resolvedDepartmentId,
        teamOpenDepartmentId: department.open_department_id,
        teamCode: code,
        roleCode: department.isRoot ? "DELIVERY_LEAD" : roleForTeam(department.name),
        isRoot: department.isRoot,
        user: currentUser
      });
    }
  }

  const byUserId = new Map();
  for (const row of rows) {
    const canonicalUserId = row.user.user_id;
    const existing = byUserId.get(canonicalUserId);
    if (!existing) {
      byUserId.set(canonicalUserId, { user: row.user, memberships: [row] });
    } else if (!existing.memberships.some((membership) => membership.teamCode === row.teamCode)) {
      existing.memberships.push(row);
    }
  }

  return {
    teams: departments,
    users: [...byUserId.values()]
      .map(({ user, memberships }) => {
        const primary = primaryMembership(memberships);
        return {
          ...primary,
          user,
          teams: memberships.map((membership) => membership.teamCode).sort()
        };
      })
      .sort((a, b) => (a.user.name ?? "").localeCompare(b.user.name ?? "", "vi")),
    warnings
  };
}

async function ensureWorkspace(tx, config) {
  const workspace = await tx.tenantWorkspace.findUnique({ where: { id: config.workspaceId } });
  if (workspace) {
    if (
      workspace.tenantKey !== config.tenantKey
      || workspace.workspaceKey !== config.workspaceKey
      || workspace.status !== "active"
    ) {
      const error = new Error("Configured workspace does not match an active directory sync target.");
      error.code = "WORKSPACE_TARGET_INVALID";
      error.operation = "database.workspace.validate";
      throw error;
    }
    return workspace;
  }
  const sameKey = await tx.tenantWorkspace.findUnique({
    where: { tenantKey_workspaceKey: { tenantKey: config.tenantKey, workspaceKey: config.workspaceKey } }
  });
  if (sameKey) {
    const error = new Error("Configured workspace ID conflicts with the existing tenant/workspace key.");
    error.code = "WORKSPACE_TARGET_CONFLICT";
    error.operation = "database.workspace.validate";
    throw error;
  }
  return tx.tenantWorkspace.create({
    data: {
      id: config.workspaceId,
      tenantKey: config.tenantKey,
      workspaceKey: config.workspaceKey,
      name: config.workspaceName,
      status: "active",
      planCode: "foundation"
    }
  });
}

async function ensureTeam(tx, code, name) {
  return (await tx.team.findUnique({ where: { code } }))
    ?? tx.team.create({ data: { id: stableId("team", code.toLowerCase()), code, name } });
}

async function ensureRole(tx, code) {
  return (await tx.role.findUnique({ where: { code } }))
    ?? tx.role.create({ data: { code, name: code.replaceAll("_", " "), type: "BUSINESS" } });
}

function identityWhere(provider, providerUserId, tenantKey) {
  return {
    provider_providerUserId_tenantKey: { provider, providerUserId, tenantKey }
  };
}

async function readIdentityPair(tx, canonicalUserId, currentOpenId, tenantKey) {
  const [canonical, openId] = await Promise.all([
    tx.portalIdentity.findUnique({
      where: identityWhere("lark_user_id", canonicalUserId, tenantKey),
      include: { user: true }
    }),
    tx.portalIdentity.findUnique({
      where: identityWhere("lark", currentOpenId, tenantKey),
      include: { user: true }
    })
  ]);
  return { canonical, openId };
}

async function findEmailFallbackUser(tx, user, canonicalUserId) {
  const emails = normalizedEmails(user);
  if (!emails.length) return undefined;
  const candidates = await tx.user.findMany({
    where: {
      OR: emails.map((email) => ({
        email: { equals: email, mode: "insensitive" }
      }))
    },
    include: {
      identities: {
        where: { provider: "lark_user_id" },
        select: { providerUserId: true }
      }
    }
  });
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  if (uniqueCandidates.length > 1) {
    const error = new Error("Normalized email matches multiple user records.");
    error.code = "LARK_EMAIL_AMBIGUOUS";
    error.operation = "database.user.email_fallback";
    throw error;
  }
  const candidate = uniqueCandidates[0];
  const conflictingCanonical = candidate?.identities?.some(
    (identity) => identity.providerUserId !== canonicalUserId
  );
  if (conflictingCanonical) {
    const error = new Error("Normalized email is owned by a different canonical Lark identity.");
    error.code = "LARK_EMAIL_CANONICAL_CONFLICT";
    error.operation = "database.user.email_fallback";
    throw error;
  }
  return candidate;
}

function assertIdentityPair(pair, expectedUserId) {
  if (pair.canonical && pair.openId && pair.canonical.userId !== pair.openId.userId) {
    const error = new Error("Canonical and open Lark identities are split across users.");
    error.code = "LARK_IDENTITY_SPLIT";
    error.operation = "database.identity.validate";
    throw error;
  }
  if (expectedUserId && (
    pair.canonical?.userId !== expectedUserId
    || pair.openId?.userId !== expectedUserId
  )) {
    const error = new Error("Lark identity post-condition failed.");
    error.code = "LARK_IDENTITY_POSTCONDITION_FAILED";
    error.operation = "database.identity.validate";
    throw error;
  }
}

async function guardedIdentityCreate(tx, data) {
  try {
    await tx.portalIdentity.create({ data });
    return 1;
  } catch (error) {
    if (error?.code === "P2002") return 0;
    throw error;
  }
}

export async function ensureIdentityLinks(tx, {
  canonicalUserId,
  currentOpenId,
  tenantKey,
  userId
}) {
  const before = await readIdentityPair(tx, canonicalUserId, currentOpenId, tenantKey);
  assertIdentityPair(before);
  let created = 0;
  if (!before.canonical) {
    created += await guardedIdentityCreate(tx, {
      userId,
      provider: "lark_user_id",
      providerUserId: canonicalUserId,
      tenantKey
    });
  }
  if (!before.openId) {
    created += await guardedIdentityCreate(tx, {
      userId,
      provider: "lark",
      providerUserId: currentOpenId,
      tenantKey
    });
  }
  const after = await readIdentityPair(tx, canonicalUserId, currentOpenId, tenantKey);
  assertIdentityPair(after, userId);
  return created;
}

function changedUserData(existingUser, desired) {
  const changes = {};
  for (const [key, value] of Object.entries(desired)) {
    if (value !== undefined && (existingUser[key] ?? null) !== (value ?? null)) {
      changes[key] = value;
    }
  }
  return changes;
}

export async function syncCdsUsers(prisma, directory, config) {
  const summary = {
    apply: config.apply,
    trigger: config.trigger,
    additiveOnly: true,
    sourceDepartment: config.departmentId,
    fetchedDepartments: directory.teams.length,
    fetchedUsers: directory.users.length,
    warningCount: directory.warnings.length,
    degraded: directory.warnings.length > 0,
    warnings: directory.warnings,
    created: 0,
    updated: 0,
    identitiesLinked: 0,
    rolesBound: 0,
    teamMemberships: 0
  };
  if (!config.apply) return summary;

  const transactionResult = await prisma.$transaction(async (tx) => {
    const scope = [
      "lark-directory-sync",
      config.tenantKey,
      config.workspaceId,
      config.departmentId
    ].join(":");
    const lockRows = await tx.$queryRawUnsafe(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
      scope
    );
    if (lockRows?.[0]?.locked !== true) {
      return { outcome: "SKIPPED_LOCKED" };
    }

    await ensureWorkspace(tx, config);
    const cdsTeam = await ensureTeam(tx, "CDS", "CHUYEN DOI SO");
    const roleCache = new Map();

    for (const row of directory.users) {
      const canonicalUserId = row.user.user_id;
      const currentOpenId = row.user.open_id;
      const identities = await readIdentityPair(tx, canonicalUserId, currentOpenId, config.tenantKey);
      assertIdentityPair(identities);
      const existingUser = identities.canonical?.user
        ?? identities.openId?.user
        ?? await findEmailFallbackUser(tx, row.user, canonicalUserId);
      const email = bestEmail(row.user, existingUser?.email).trim().toLowerCase();
      const userData = {
        email,
        displayName: row.user.name ?? email,
        avatarUrl: avatarUrl(row.user),
        departmentCode: row.teamCode,
        subjectType: "INTERNAL_USER",
        ...(existingUser ? {} : { status: isActive(row.user) ? "ACTIVE" : "SUSPENDED" })
      };
      let user;
      if (existingUser) {
        const changes = changedUserData(existingUser, userData);
        user = Object.keys(changes).length
          ? await tx.user.update({ where: { id: existingUser.id }, data: changes })
          : existingUser;
        if (Object.keys(changes).length) summary.updated += 1;
      } else {
        user = await tx.user.create({ data: { id: stableId("usr-lark", canonicalUserId), ...userData } });
        summary.created += 1;
      }

      summary.identitiesLinked += await ensureIdentityLinks(tx, {
        canonicalUserId,
        currentOpenId,
        tenantKey: config.tenantKey,
        userId: user.id
      });

      for (const code of new Set(["CDS", ...row.teams])) {
        const name = code === "CDS"
          ? "CHUYEN DOI SO"
          : code === row.teamCode
            ? row.teamName
            : code.replace(/^CDS_/, "").replaceAll("_", " ");
        const team = code === "CDS" ? cdsTeam : await ensureTeam(tx, code, name);
        const membership = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId: team.id, userId: user.id } }
        });
        if (!membership) {
          await tx.teamMember.create({ data: { teamId: team.id, userId: user.id } });
          summary.teamMemberships += 1;
        }
      }

      const role = roleCache.get(row.roleCode) ?? (await ensureRole(tx, row.roleCode));
      roleCache.set(row.roleCode, role);
      const bindingWhere = {
        userId_roleId_tenantKey_workspaceId: {
          userId: user.id,
          roleId: role.id,
          tenantKey: config.tenantKey,
          workspaceId: config.workspaceId
        }
      };
      const binding = await tx.roleBinding.findUnique({ where: bindingWhere });
      if (!binding) {
        await tx.roleBinding.create({
          data: {
            userId: user.id,
            roleId: role.id,
            tenantKey: config.tenantKey,
            workspaceId: config.workspaceId
          }
        });
        summary.rolesBound += 1;
      } else if (binding.endsAt) {
        await tx.roleBinding.update({
          where: bindingWhere,
          data: { endsAt: null }
        });
        summary.rolesBound += 1;
      }
    }
    return { outcome: "APPLIED" };
  }, { timeout: 120_000, maxWait: 10_000 });

  summary.outcome = transactionResult.outcome;
  return summary;
}

export function sanitizeRunSummary(summary) {
  return {
    trigger: summary.trigger,
    apply: summary.apply,
    additiveOnly: true,
    sourceDepartment: summary.sourceDepartment,
    fetchedDepartments: summary.fetchedDepartments,
    fetchedUsers: summary.fetchedUsers,
    warningCount: summary.warningCount,
    degraded: summary.degraded,
    warnings: summary.warnings,
    created: summary.created,
    updated: summary.updated,
    identitiesLinked: summary.identitiesLinked,
    rolesBound: summary.rolesBound,
    teamMemberships: summary.teamMemberships,
    outcome: summary.outcome ?? (summary.apply ? "APPLIED" : "DRY_RUN")
  };
}
