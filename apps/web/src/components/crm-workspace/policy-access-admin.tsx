"use client";

import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type {
  AccountSummary,
  AccountsResponse,
  AdminAccessMemberSummary,
  AdminAccessMembersResponse,
  AdminInvitationSummary,
  AdminInvitationsResponse,
  AdminPolicyAuditEntry,
  AdminPolicyAuditResponse,
  AdminResendInvitationResponse,
  CreateInternalUserResponse,
  CreatePortalInvitationResponse,
  InternalRoleCode,
  ProjectSummary,
  ResourceListResponse,
  SalesOwnerSummary
} from "@b2b-crm/contracts";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { ModalLayer } from "../modal-layer";

type AdminMode = "internal" | "portal";
type RoleCode = InternalRoleCode;
type MemberStatus = "active" | "pending" | "review_required" | "accepted" | "revoked" | "expired" | "rejected" | "suspended";
type MemberType = "internal" | "portal";

type MemberRow = {
  id: string;
  activeSessionCount?: number;
  accountId?: string;
  accountName: string;
  avatarUrl?: string;
  departmentCode?: string;
  email: string;
  filterText: string;
  hasResourceProfile?: boolean;
  kind: MemberType;
  lastSeenAt?: string;
  larkOpenId?: string;
  larkTenantKey?: string;
  magicLink?: string;
  name: string;
  projectId?: string;
  projectName: string;
  roleCode: string;
  roleLabel: string;
  source: "api" | "fallback" | "local";
  status: MemberStatus;
};

const roleOptions: Array<{ code: RoleCode; label: string; resourceRole: string }> = [
  { code: "DELIVERY_LEAD", label: "Delivery Lead", resourceRole: "Implementation consultant" },
  { code: "SALES_OWNER", label: "Sales Owner", resourceRole: "Sales owner" },
  { code: "FINANCE_ADMIN", label: "Finance Admin", resourceRole: "Finance owner" },
  { code: "FOUNDER_GM", label: "Founder/GM", resourceRole: "Management" }
];

const portalRole = { code: "CUSTOMER_SPONSOR", label: "Customer Sponsor" };
const memberPageSize = 10;

function toApiMemberRow(member: AdminAccessMemberSummary): MemberRow {
  const roleCode = member.roleCodes[0] ?? "MEMBER";
  const roleLabel = roleOptions.find((role) => role.code === roleCode)?.label ?? roleCode.replaceAll("_", " ");
  return withFilterText({
    id: member.id,
    activeSessionCount: member.activeSessionCount,
    accountId: member.accountIds[0],
    accountName: member.accountNames[0] ?? "Toàn hệ thống",
    avatarUrl: member.avatarUrl,
    departmentCode: member.departmentCode,
    email: member.email,
    filterText: "",
    hasResourceProfile: member.hasResourceProfile,
    kind: member.subjectType,
    lastSeenAt: member.lastSeenAt,
    larkOpenId: member.larkOpenId,
    larkTenantKey: member.larkTenantKey,
    name: member.displayName,
    projectId: member.projectIds[0],
    projectName: member.projectNames[0] ?? "Tất cả dự án",
    roleCode,
    roleLabel,
    source: "api",
    status: member.status === "suspended" ? "suspended" : "active"
  });
}

function toInvitationMemberRow(invitation: AdminInvitationSummary): MemberRow {
  return withFilterText({
    id: invitation.id,
    accountId: invitation.accountId,
    accountName: invitation.accountName ?? "Chưa gắn account",
    email: invitation.invitedEmail,
    filterText: "",
    kind: "portal",
    name: invitation.requestedEmail ?? "Khách hàng được mời",
    projectId: invitation.projectId,
    projectName: invitation.projectName ?? "Portal theo account",
    roleCode: invitation.roleCode,
    roleLabel: invitation.roleCode === portalRole.code ? portalRole.label : invitation.roleCode.replaceAll("_", " "),
    source: "api",
    status: invitation.status
  });
}

export function PolicyAccessAdmin({
  accounts,
  projects,
  salesOwners,
  showDemoSessionAction
}: {
  accounts: AccountsResponse;
  projects: ResourceListResponse<ProjectSummary>;
  salesOwners: ResourceListResponse<SalesOwnerSummary>;
  showDemoSessionAction: boolean;
}) {
  const [mode, setMode] = useState<AdminMode>("internal");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deactivateRequest, setDeactivateRequest] = useState<MemberRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [hasApiAccess, setHasApiAccess] = useState(false);
  const [remoteMembers, setRemoteMembers] = useState<AdminAccessMemberSummary[]>([]);
  const [remoteInvitations, setRemoteInvitations] = useState<AdminInvitationSummary[]>([]);
  const [auditEntries, setAuditEntries] = useState<AdminPolicyAuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFilter, setAuditFilter] = useState<string | null>(null);
  const [localMembers, setLocalMembers] = useState<MemberRow[]>([]);
  const [createdUser, setCreatedUser] = useState<CreateInternalUserResponse | null>(null);
  const [invitation, setInvitation] = useState<CreatePortalInvitationResponse | null>(null);
  const [memberPage, setMemberPage] = useState(1);

  const firstAccountId = accounts.data[0]?.id ?? "";
  const firstProjectId = projects.data[0]?.id ?? "";
  const [internalForm, setInternalForm] = useState({
    email: "",
    displayName: "",
    roleCode: "DELIVERY_LEAD" as RoleCode,
    departmentCode: "delivery",
    accountId: firstAccountId,
    projectId: firstProjectId,
    createResourceProfile: true,
    displayRole: "Implementation consultant",
    weeklyHours: "40",
    billableTargetPercent: "70",
    skills: "lark, implementation"
  });
  const [portalForm, setPortalForm] = useState({
    invitedEmail: "",
    accountId: firstAccountId,
    projectId: firstProjectId
  });

  const selectedRole = useMemo(
    () => roleOptions.find((role) => role.code === internalForm.roleCode) ?? roleOptions[0],
    [internalForm.roleCode]
  );
  const selectedInternalAccount = useMemo(
    () => accounts.data.find((account) => account.id === internalForm.accountId),
    [accounts.data, internalForm.accountId]
  );
  const selectedInternalProject = useMemo(
    () => projects.data.find((project) => project.id === internalForm.projectId),
    [projects.data, internalForm.projectId]
  );
  const selectedPortalAccount = useMemo(
    () => accounts.data.find((account) => account.id === portalForm.accountId),
    [accounts.data, portalForm.accountId]
  );
  const selectedPortalProject = useMemo(
    () => projects.data.find((project) => project.id === portalForm.projectId),
    [projects.data, portalForm.projectId]
  );

  useEffect(() => {
    void loadAccessAdminData(true);
  }, []);

  const apiMemberRows = useMemo(
    () => [
      ...remoteMembers.map(toApiMemberRow),
      ...remoteInvitations.map(toInvitationMemberRow)
    ],
    [remoteInvitations, remoteMembers]
  );
  const fallbackMembers = useMemo(
    () =>
      salesOwners.data.map((owner) =>
        buildFallbackMember(owner, accounts.data[0], projects.data.find((project) => project.accountId === accounts.data[0]?.id))
      ),
    [accounts.data, projects.data, salesOwners.data]
  );

  const members = useMemo(() => {
    const baseRows = hasApiAccess ? apiMemberRows : fallbackMembers;
    const localIds = new Set(localMembers.map((member) => member.id));
    return [...localMembers, ...baseRows.filter((member) => !localIds.has(member.id))];
  }, [apiMemberRows, fallbackMembers, hasApiAccess, localMembers]);
  const stats = useMemo(
    () => ({
      active: members.filter((member) => member.status === "active").length,
      internal: members.filter((member) => member.kind === "internal").length,
      pending: members.filter((member) => member.status === "pending" || member.status === "review_required").length,
      scopeCount: new Set(members.map((member) => member.accountName).filter(Boolean)).size
    }),
    [members]
  );
  const filteredAuditEntries = useMemo(() => {
    if (!auditFilter) return auditEntries;
    const normalized = auditFilter.toLowerCase();
    return auditEntries.filter((entry) =>
      [entry.actorUserId, entry.actorDisplayName, entry.resourceId, entry.action, entry.resource, entry.reason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [auditEntries, auditFilter]);
  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return members.filter((member) => {
      const matchesQuery = !normalizedQuery || member.filterText.includes(normalizedQuery);
      const matchesRole = roleFilter === "all" || member.roleCode === roleFilter;
      const matchesScope =
        scopeFilter === "all" ||
        member.accountId === scopeFilter ||
        member.projectId === scopeFilter ||
        member.accountName === scopeFilter ||
        member.projectName === scopeFilter;
      return matchesQuery && matchesRole && matchesScope;
    });
  }, [members, query, roleFilter, scopeFilter]);
  const totalMemberPages = Math.max(1, Math.ceil(filteredMembers.length / memberPageSize));
  const currentMemberPage = Math.min(memberPage, totalMemberPages);
  const pagedMembers = filteredMembers.slice((currentMemberPage - 1) * memberPageSize, currentMemberPage * memberPageSize);

  useEffect(() => {
    setMemberPage(1);
  }, [query, roleFilter, scopeFilter, members.length]);

  async function createDemoSession() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/auth/demo/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "usr-kha-founder", tenantKey: "pilot" })
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      await loadAccessAdminData(false);
      setNotice("Đã tạo phiên founder local. Danh sách member, invite và audit log đã được tải từ API.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được phiên founder local.");
    } finally {
      setBusy(false);
    }
  }

  async function loadAccessAdminData(silent: boolean) {
    setAccessLoading(true);
    if (!silent) {
      setError(null);
    }
    try {
      const [membersResponse, invitationsResponse, auditResponse] = await Promise.all([
        fetch("/api/admin/members", { cache: "no-store" }),
        fetch("/api/admin/invitations", { cache: "no-store" }),
        fetch("/api/admin/policy-audit?limit=60", { cache: "no-store" })
      ]);
      const sessionExpiredResponse = [membersResponse, invitationsResponse, auditResponse].find(isSessionExpiredResponse);
      if (sessionExpiredResponse) {
        redirectToLogin();
        throw new Error("Phiên đăng nhập đã hết hạn. Đang chuyển về màn đăng nhập.");
      }
      if (!membersResponse.ok || !invitationsResponse.ok || !auditResponse.ok) {
        throw new Error(await errorMessage(membersResponse.ok ? invitationsResponse.ok ? auditResponse : invitationsResponse : membersResponse));
      }
      const [membersPayload, invitationsPayload, auditPayload] = await Promise.all([
        readJson<AdminAccessMembersResponse>(membersResponse),
        readJson<AdminInvitationsResponse>(invitationsResponse),
        readJson<AdminPolicyAuditResponse>(auditResponse)
      ]);
      setRemoteMembers(membersPayload.data ?? []);
      setRemoteInvitations(invitationsPayload.data ?? []);
      setAuditEntries(auditPayload.data ?? []);
      setHasApiAccess(true);
    } catch (err) {
      setHasApiAccess(false);
      if (!silent) {
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu phân quyền.");
      }
    } finally {
      setAccessLoading(false);
    }
  }

  async function submitInternalUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setCreatedUser(null);
    setInvitation(null);

    try {
      const userResponse = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: internalForm.email,
          displayName: internalForm.displayName,
          roleCode: internalForm.roleCode,
          tenantKey: "pilot",
          departmentCode: internalForm.departmentCode || undefined,
          accountId: internalForm.accountId || undefined,
          projectId: internalForm.projectId || undefined
        })
      });
      const user = await readJson<CreateInternalUserResponse>(userResponse);
      if (!userResponse.ok) {
        throw new Error(messageFromPayload(user));
      }

      if (internalForm.createResourceProfile) {
        const profileResponse = await fetch("/api/capacity/profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            displayRole: internalForm.displayRole || selectedRole.resourceRole,
            defaultWeeklyCapacityMinutes: Math.max(0, Number(internalForm.weeklyHours || 0) * 60),
            billableTargetPercent: Number(internalForm.billableTargetPercent || 70),
            skills: internalForm.skills.split(",").map((skill) => skill.trim()).filter(Boolean),
            active: true
          })
        });
        const profile = await readJson<{ message?: string }>(profileResponse);
        if (!profileResponse.ok) {
          throw new Error(messageFromPayload(profile));
        }
      }

      const row = buildLocalInternalMember(user, selectedRole.label, selectedInternalAccount, selectedInternalProject);
      setLocalMembers((current) => [row, ...current.filter((member) => member.id !== row.id)]);
      setCreatedUser(user);
      await loadAccessAdminData(true);
      setNotice(internalForm.createResourceProfile ? "Đã tạo member và hồ sơ nguồn lực." : "Đã tạo member nội bộ.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được tài khoản.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPortalInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setCreatedUser(null);
    setInvitation(null);

    try {
      const response = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitedEmail: portalForm.invitedEmail,
          accountId: portalForm.accountId || undefined,
          projectId: portalForm.projectId || undefined,
          roleCode: portalRole.code,
          tenantKey: "pilot"
        })
      });
      const payload = await readJson<CreatePortalInvitationResponse>(response);
      if (!response.ok) {
        throw new Error(messageFromPayload(payload));
      }
      const row = buildLocalPortalInvite(payload, selectedPortalAccount, selectedPortalProject);
      setLocalMembers((current) => [row, ...current.filter((member) => member.id !== row.id)]);
      setInvitation(payload);
      await loadAccessAdminData(true);
      setNotice("Đã tạo lời mời portal khách hàng.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được lời mời.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSessions(member: MemberRow) {
    if (member.kind !== "internal") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(member.id)}/revoke-sessions`, { method: "POST" });
      const payload = await readJson<{ revokedSessions?: number; message?: string }>(response);
      if (!response.ok) {
        throw new Error(messageFromPayload(payload));
      }
      await loadAccessAdminData(true);
      setNotice(`Đã revoke ${payload.revokedSessions ?? 0} phiên đăng nhập của ${member.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không revoke được session.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateMember(member: MemberRow) {
    if (member.kind !== "internal" || member.status !== "active") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(member.id)}/deactivate`, { method: "POST" });
      const payload = await readJson<{ revokedSessions?: number; endedRoleBindings?: number; message?: string }>(response);
      if (!response.ok) {
        throw new Error(messageFromPayload(payload));
      }
      await loadAccessAdminData(true);
      setNotice(`Đã khóa ${member.name}, revoke ${payload.revokedSessions ?? 0} session và kết thúc ${payload.endedRoleBindings ?? 0} role binding.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không khóa được member.");
    } finally {
      setBusy(false);
    }
  }

  async function resendInvitation(member: MemberRow) {
    if (member.kind !== "portal") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/invitations/${encodeURIComponent(member.id)}/resend`, { method: "POST" });
      const payload = await readJson<AdminResendInvitationResponse & { message?: string }>(response);
      if (!response.ok) {
        throw new Error(messageFromPayload(payload));
      }
      setInvitation(payload);
      await loadAccessAdminData(true);
      setNotice(`Đã gửi lại invite cho ${payload.invitedEmail}. Magic link mới đã hiện trong modal preview.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi lại được invite.");
    } finally {
      setBusy(false);
    }
  }

  function openAudit(member?: MemberRow) {
    setAuditFilter(member ? member.id : null);
    setAuditOpen(true);
  }

  function updateRole(roleCode: RoleCode) {
    const role = roleOptions.find((item) => item.code === roleCode) ?? roleOptions[0];
    setInternalForm((current) => ({
      ...current,
      roleCode,
      displayRole: current.displayRole || role.resourceRole
    }));
  }

  function openInvite(nextMode: AdminMode) {
    setMode(nextMode);
    setInviteOpen(true);
    setError(null);
    setNotice(null);
    setCreatedUser(null);
    setInvitation(null);
  }

  return (
    <section className="dashboard-panel policy-members-panel">
      <div className="policy-members-header">
        <div>
          <span className="policy-access-kicker">Quản trị truy cập</span>
          <h3>Members & lời mời</h3>
          <p>Danh sách người đang có quyền vào CRM và lời mời đang chờ xử lý. Thông tin chi tiết được mở qua modal khi cần.</p>
        </div>
        <div className="policy-members-actions">
          {showDemoSessionAction ? (
            <button className="task-button secondary" disabled={busy} type="button" onClick={createDemoSession}>
              Phiên founder local
            </button>
          ) : null}
          <button className="task-button secondary" disabled={accessLoading} type="button" onClick={() => loadAccessAdminData(false)}>
            {accessLoading ? "Đang tải..." : "Refresh"}
          </button>
          <button className="task-button secondary" type="button" onClick={() => openAudit()}>
            Audit log
          </button>
          <button className="task-button primary" type="button" onClick={() => openInvite("internal")}>
            + Gửi invite
          </button>
        </div>
      </div>

      <div className="policy-members-summary" aria-label="Member summary">
        <MemberMetric label="Active members" value={stats.active} />
        <MemberMetric label="Internal" value={stats.internal} />
        <MemberMetric label="Pending invites" value={stats.pending} />
        <MemberMetric label="Scopes" value={stats.scopeCount} />
      </div>

      {notice ? <div className="policy-access-notice success">{notice}</div> : null}
      {error ? <div className="policy-access-notice error">{error}</div> : null}

      <div className="policy-members-toolbar">
        <label className="policy-member-search">
          <span>Tìm member</span>
          <input
            className="task-text-input"
            placeholder="Tên, email, role hoặc scope"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <FilterChips
          label="Role"
          options={[
            { label: "Tất cả", value: "all" },
            ...roleOptions.map((role) => ({ label: role.label, value: role.code })),
            { label: portalRole.label, value: portalRole.code }
          ]}
          value={roleFilter}
          onChange={setRoleFilter}
        />
        <FilterChips
          label="Scope"
          options={[
            { label: "Tất cả", value: "all" },
            ...accounts.data.map((account) => ({ label: account.name, value: account.id })),
            ...projects.data.map((project) => ({ label: project.name, value: project.id }))
          ]}
          value={scopeFilter}
          onChange={setScopeFilter}
        />
      </div>

      <div className="policy-members-table-wrap">
        <table className="policy-members-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {pagedMembers.map((member) => (
              <tr key={member.id}>
                <td>
                  <div className="policy-member-identity">
                    <PolicyMemberAvatar member={member} />
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                      <small>
                        {member.larkOpenId ? "Nguồn đồng bộ" : "Tạo thủ công"} · {member.hasResourceProfile ? "Đã vào nguồn lực" : "Chưa vào nguồn lực"}
                      </small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="policy-member-role">{member.roleLabel}</span>
                  <small className="policy-member-muted">
                    {member.kind === "portal" ? "Portal" : "Nội bộ"}{member.departmentCode ? ` · ${formatDepartment(member.departmentCode)}` : ""}
                  </small>
                </td>
                <td>
                  <strong className="policy-member-scope">{member.accountName}</strong>
                  <small className="policy-member-muted">{member.projectName}</small>
                </td>
                <td>
                  <StatusPill status={member.status} />
                </td>
                <td>
                  <div className="policy-member-row-actions">
                    <button
                      className="task-button secondary"
                      disabled={busy || member.kind !== "internal" || member.activeSessionCount === 0}
                      title={member.kind !== "internal" ? "Portal invite chưa có session để revoke" : "Revoke active sessions"}
                      type="button"
                      onClick={() => revokeSessions(member)}
                    >
                      Revoke
                    </button>
                    <button
                      className="task-button secondary"
                      disabled={busy || member.kind !== "internal" || member.status !== "active"}
                      type="button"
                      onClick={() => setDeactivateRequest(member)}
                    >
                      Deactivate
                    </button>
                    <button
                      className="task-button secondary"
                      disabled={busy || member.kind !== "portal" || member.status === "accepted"}
                      type="button"
                      onClick={() => resendInvitation(member)}
                    >
                      Resend
                    </button>
                    <button className="task-button secondary" type="button" onClick={() => openAudit(member)}>
                      Audit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredMembers.length === 0 ? (
          <div className="policy-members-empty">
            <strong>Không có member khớp bộ lọc.</strong>
            <span>Thử bỏ bớt role/scope hoặc gửi invite mới.</span>
          </div>
        ) : null}
        <MemberPagination
          currentPage={currentMemberPage}
          pageSize={memberPageSize}
          totalItems={filteredMembers.length}
          totalPages={totalMemberPages}
          onPageChange={setMemberPage}
        />
      </div>

      {inviteOpen ? (
        <ModalLayer onClose={() => setInviteOpen(false)}>
        <div className="policy-invite-modal-backdrop" role="presentation" onClick={() => setInviteOpen(false)}>
          <div
            aria-modal="true"
            className="policy-invite-modal"
            role="dialog"
            aria-labelledby="policy-invite-title"
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
          >
            <div className="policy-invite-modal-header">
              <div>
                <span className="policy-access-kicker">Invite</span>
                <h3 id="policy-invite-title">Gửi quyền truy cập</h3>
              </div>
              <button aria-label="Đóng modal" className="task-modal-close" type="button" onClick={() => setInviteOpen(false)}>
                ×
              </button>
            </div>

            <div className="policy-invite-tabs" role="tablist" aria-label="Invite mode">
              <button
                aria-selected={mode === "internal"}
                className={mode === "internal" ? "active" : ""}
                role="tab"
                type="button"
                onClick={() => setMode("internal")}
              >
                Member nội bộ
              </button>
              <button
                aria-selected={mode === "portal"}
                className={mode === "portal" ? "active" : ""}
                role="tab"
                type="button"
                onClick={() => setMode("portal")}
              >
                Khách hàng
              </button>
            </div>

            {mode === "internal" ? (
              <InviteInternalForm
                busy={busy}
                createdUser={createdUser}
                form={internalForm}
                selectedAccount={selectedInternalAccount}
                selectedProject={selectedInternalProject}
                selectedRole={selectedRole}
                accounts={accounts.data}
                projects={projects.data}
                onChange={setInternalForm}
                onSubmit={submitInternalUser}
                onUpdateRole={updateRole}
              />
            ) : (
              <InvitePortalForm
                busy={busy}
                form={portalForm}
                invitation={invitation}
                selectedAccount={selectedPortalAccount}
                selectedProject={selectedPortalProject}
                accounts={accounts.data}
                projects={projects.data}
                onChange={setPortalForm}
                onSubmit={submitPortalInvitation}
              />
            )}
          </div>
        </div>
        </ModalLayer>
      ) : null}

      {deactivateRequest ? (
        <ConfirmActionDialog
          confirmLabel="Khóa tài khoản"
          onCancel={() => setDeactivateRequest(null)}
          onConfirm={async () => {
            const member = deactivateRequest;
            setDeactivateRequest(null);
            await deactivateMember(member);
          }}
          title="Khóa tài khoản nội bộ?"
          tone="danger"
        >
          Tài khoản {deactivateRequest.name} sẽ bị khóa, các session đang hoạt động sẽ bị revoke và role binding đang mở sẽ được kết thúc.
        </ConfirmActionDialog>
      ) : null}

      {auditOpen ? (
        <ModalLayer onClose={() => setAuditOpen(false)}>
        <div className="policy-invite-modal-backdrop" role="presentation" onClick={() => setAuditOpen(false)}>
          <div
            aria-modal="true"
            className="policy-audit-modal"
            role="dialog"
            aria-labelledby="policy-audit-title"
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
          >
            <div className="policy-invite-modal-header">
              <div>
                <span className="policy-access-kicker">Audit</span>
                <h3 id="policy-audit-title">Lịch sử quyền truy cập</h3>
              </div>
              <button aria-label="Đóng modal" className="task-modal-close" type="button" onClick={() => setAuditOpen(false)}>
                ×
              </button>
            </div>
            <div className="policy-audit-list">
              {filteredAuditEntries.map((entry) => (
                <article className="policy-audit-item" key={`${entry.source}-${entry.id}`}>
                  <div>
                    <strong>{entry.action}</strong>
                    <span>{entry.resource}{entry.resourceId ? ` · ${entry.resourceId}` : ""}</span>
                  </div>
                  <div>
                    <span>{entry.actorDisplayName ?? entry.actorUserId ?? "System"}</span>
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  </div>
                  {entry.reason ? <p>{entry.reason}</p> : null}
                </article>
              ))}
              {filteredAuditEntries.length === 0 ? (
                <div className="policy-members-empty">
                  <strong>Chưa có audit log phù hợp.</strong>
                  <span>Thử refresh hoặc bỏ lọc theo member.</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        </ModalLayer>
      ) : null}
    </section>
  );
}

function InviteInternalForm({
  accounts,
  busy,
  createdUser,
  form,
  onChange,
  onSubmit,
  onUpdateRole,
  projects,
  selectedAccount,
  selectedProject,
  selectedRole
}: {
  accounts: AccountSummary[];
  busy: boolean;
  createdUser: CreateInternalUserResponse | null;
  form: {
    accountId: string;
    billableTargetPercent: string;
    createResourceProfile: boolean;
    departmentCode: string;
    displayName: string;
    displayRole: string;
    email: string;
    projectId: string;
    roleCode: RoleCode;
    skills: string;
    weeklyHours: string;
  };
  onChange: Dispatch<SetStateAction<typeof form>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateRole: (roleCode: RoleCode) => void;
  projects: ProjectSummary[];
  selectedAccount?: AccountSummary;
  selectedProject?: ProjectSummary;
  selectedRole: { code: RoleCode; label: string; resourceRole: string };
}) {
  return (
    <form className="policy-invite-form" onSubmit={onSubmit}>
      <div className="policy-invite-layout">
        <div className="policy-invite-main">
          <section className="policy-invite-section">
            <h4>Người nhận</h4>
            <div className="policy-invite-grid">
              <label>
                <span>Email đăng nhập</span>
                <input
                  className="task-text-input"
                  placeholder="name@company.com"
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) => onChange((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
              <label>
                <span>Tên hiển thị</span>
                <input
                  className="task-text-input"
                  placeholder="Nguyễn Văn A"
                  required
                  value={form.displayName}
                  onChange={(event) => onChange((current) => ({ ...current, displayName: event.target.value }))}
                />
              </label>
              <label>
                <span>Phòng ban</span>
                <input
                  className="task-text-input"
                  value={form.departmentCode}
                  onChange={(event) => onChange((current) => ({ ...current, departmentCode: event.target.value }))}
                />
              </label>
            </div>
          </section>

          <section className="policy-invite-section">
            <h4>Role & scope</h4>
            <div className="policy-role-picker" aria-label="Role nội bộ">
              {roleOptions.map((role) => (
                <button className={form.roleCode === role.code ? "active" : ""} key={role.code} type="button" onClick={() => onUpdateRole(role.code)}>
                  {role.label}
                </button>
              ))}
            </div>
            <div className="policy-invite-two">
              <OptionTiles
                label="Khách hàng"
                options={[
                  { value: "", label: "Chưa gắn", detail: "Gắn sau" },
                  ...accounts.map((account) => ({ value: account.id, label: account.name, detail: "Account" }))
                ]}
                value={form.accountId}
                onChange={(accountId) => onChange((current) => ({ ...current, accountId }))}
              />
              <OptionTiles
                label="Dự án"
                options={[
                  { value: "", label: "Chưa gắn", detail: "Không giới hạn" },
                  ...projects.map((project) => ({ value: project.id, label: project.name, detail: project.accountName ?? "Project" }))
                ]}
                value={form.projectId}
                onChange={(projectId) => onChange((current) => ({ ...current, projectId }))}
              />
            </div>
          </section>

          <section className="policy-invite-section">
            <label className="policy-access-check">
              <input
                checked={form.createResourceProfile}
                type="checkbox"
                onChange={(event) => onChange((current) => ({ ...current, createResourceProfile: event.target.checked }))}
              />
              <span>Thêm hồ sơ nguồn lực</span>
            </label>
            {form.createResourceProfile ? (
              <div className="policy-invite-grid">
                <label>
                  <span>Vai trò nguồn lực</span>
                  <input
                    className="task-text-input"
                    value={form.displayRole || selectedRole.resourceRole}
                    onChange={(event) => onChange((current) => ({ ...current, displayRole: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Giờ chuẩn/tuần</span>
                  <input
                    className="task-text-input"
                    min="0"
                    type="number"
                    value={form.weeklyHours}
                    onChange={(event) => onChange((current) => ({ ...current, weeklyHours: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Billable target (%)</span>
                  <input
                    className="task-text-input"
                    min="0"
                    max="200"
                    type="number"
                    value={form.billableTargetPercent}
                    onChange={(event) => onChange((current) => ({ ...current, billableTargetPercent: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}
          </section>
        </div>

        <AccessPreview
          title="Member nội bộ"
          rows={[
            ["Email", form.email || "Chưa nhập"],
            ["Role", selectedRole.label],
            ["Account", selectedAccount?.name ?? "Chưa gắn"],
            ["Dự án", selectedProject?.name ?? "Chưa gắn"],
            ["Nguồn lực", form.createResourceProfile ? `${form.weeklyHours || 0} giờ/tuần` : "Không tạo"]
          ]}
          result={createdUser?.loginUrl}
          resultLabel="Link đăng nhập"
        />
      </div>

      <div className="policy-invite-footer">
        <button className="task-button primary" disabled={busy} type="submit">
          {busy ? "Đang tạo..." : "Tạo member"}
        </button>
      </div>
    </form>
  );
}

function InvitePortalForm({
  accounts,
  busy,
  form,
  invitation,
  onChange,
  onSubmit,
  projects,
  selectedAccount,
  selectedProject
}: {
  accounts: AccountSummary[];
  busy: boolean;
  form: { accountId: string; invitedEmail: string; projectId: string };
  invitation: CreatePortalInvitationResponse | null;
  onChange: Dispatch<SetStateAction<typeof form>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  projects: ProjectSummary[];
  selectedAccount?: AccountSummary;
  selectedProject?: ProjectSummary;
}) {
  return (
    <form className="policy-invite-form" onSubmit={onSubmit}>
      <div className="policy-invite-layout">
        <div className="policy-invite-main">
          <section className="policy-invite-section">
            <h4>Người nhận</h4>
            <label>
              <span>Email khách hàng</span>
              <input
                className="task-text-input"
                placeholder="sponsor@customer.com"
                required
                type="email"
                value={form.invitedEmail}
                onChange={(event) => onChange((current) => ({ ...current, invitedEmail: event.target.value }))}
              />
            </label>
          </section>
          <section className="policy-invite-section">
            <h4>Scope portal</h4>
            <div className="policy-invite-two">
              <OptionTiles
                label="Khách hàng"
                options={[
                  { value: "", label: "Chưa gắn", detail: "Không khuyến nghị" },
                  ...accounts.map((account) => ({ value: account.id, label: account.name, detail: "Account" }))
                ]}
                value={form.accountId}
                onChange={(accountId) => onChange((current) => ({ ...current, accountId }))}
              />
              <OptionTiles
                label="Dự án"
                options={[
                  { value: "", label: "Chưa gắn", detail: "Theo account" },
                  ...projects.map((project) => ({ value: project.id, label: project.name, detail: project.accountName ?? "Project" }))
                ]}
                value={form.projectId}
                onChange={(projectId) => onChange((current) => ({ ...current, projectId }))}
              />
            </div>
          </section>
        </div>

        <AccessPreview
          title="Portal invite"
          rows={[
            ["Email", form.invitedEmail || "Chưa nhập"],
            ["Role", portalRole.label],
            ["Account", selectedAccount?.name ?? "Chưa gắn"],
            ["Dự án", selectedProject?.name ?? "Chưa gắn"],
            ["Hiệu lực", "72 giờ"]
          ]}
          result={invitation?.magicLink}
          resultLabel="Magic link"
        />
      </div>

      <div className="policy-invite-footer">
        <button className="task-button primary" disabled={busy} type="submit">
          {busy ? "Đang tạo..." : "Tạo lời mời"}
        </button>
      </div>
    </form>
  );
}

function FilterChips({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <fieldset className="policy-filter-chips">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={value === option.value ? "active" : ""}
            key={`${label}-${option.value}`}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function MemberMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OptionTiles({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ detail?: string; label: string; value: string }>;
  value: string;
}) {
  return (
    <fieldset className="policy-option-field">
      <legend>{label}</legend>
      <div className="policy-option-grid">
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={value === option.value ? "active" : ""}
            key={`${label}-${option.value || "none"}`}
            type="button"
            onClick={() => onChange(option.value)}
          >
            <strong>{option.label}</strong>
            {option.detail ? <span>{option.detail}</span> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function AccessPreview({
  result,
  resultLabel,
  rows,
  title
}: {
  result?: string;
  resultLabel: string;
  rows: Array<[string, string]>;
  title: string;
}) {
  return (
    <aside className="policy-access-preview" aria-label="Tóm tắt quyền truy cập">
      <div>
        <span>Preview</span>
        <h4>{title}</h4>
      </div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {result ? (
        <div className="policy-access-result">
          <span>{resultLabel}</span>
          <p>{result}</p>
        </div>
      ) : null}
    </aside>
  );
}

function StatusPill({ status }: { status: MemberStatus }) {
  const label = {
    active: "Đang hoạt động",
    accepted: "Đã nhận lời mời",
    expired: "Hết hạn",
    pending: "Chờ nhận lời mời",
    rejected: "Bị từ chối",
    revoked: "Đã thu hồi",
    review_required: "Chờ duyệt",
    suspended: "Đã khóa"
  }[status];
  return <span className={`policy-member-status ${status}`}>{label}</span>;
}

function MemberPagination({
  currentPage,
  onPageChange,
  pageSize,
  totalItems,
  totalPages
}: {
  currentPage: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}) {
  if (totalItems <= pageSize) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalItems, currentPage * pageSize);

  return (
    <div className="policy-members-pagination" aria-label="Phân trang member">
      <span>{start}-{end} / {totalItems} member</span>
      <div>
        <button
          className="task-button secondary"
          disabled={currentPage <= 1}
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        >
          Trước
        </button>
        <button
          className="task-button secondary"
          disabled={currentPage >= totalPages}
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        >
          Sau
        </button>
      </div>
    </div>
  );
}

function buildFallbackMember(owner: SalesOwnerSummary, account?: AccountSummary, project?: ProjectSummary): MemberRow {
  const roleCode = owner.roleCodes[0] ?? "SALES_OWNER";
  const roleLabel = roleOptions.find((role) => role.code === roleCode)?.label ?? roleCode.replaceAll("_", " ");
  const accountName = roleCode === "FOUNDER_GM" ? "Toàn hệ thống" : account?.name ?? "Theo quyền CRM";
  const projectName = roleCode === "FOUNDER_GM" ? "Tất cả dự án" : project?.name ?? "Theo phạm vi role";
  return withFilterText({
    id: owner.id,
    accountId: account?.id,
    accountName,
    email: owner.email,
    filterText: "",
    kind: "internal",
    name: owner.displayName,
    projectId: project?.id,
    projectName,
    roleCode,
    roleLabel,
    source: "fallback",
    status: "active"
  });
}

function buildLocalInternalMember(
  user: CreateInternalUserResponse,
  roleLabel: string,
  account?: AccountSummary,
  project?: ProjectSummary
): MemberRow {
  return withFilterText({
    id: user.id,
    accountId: account?.id,
    accountName: account?.name ?? "Chưa gắn account",
    email: user.email,
    filterText: "",
    kind: "internal",
    name: user.displayName,
    projectId: project?.id,
    projectName: project?.name ?? "Chưa gắn project",
    roleCode: user.roleCode,
    roleLabel,
    source: "local",
    status: "active"
  });
}

function buildLocalPortalInvite(
  invitation: CreatePortalInvitationResponse,
  account?: AccountSummary,
  project?: ProjectSummary
): MemberRow {
  return withFilterText({
    id: invitation.id,
    accountId: account?.id,
    accountName: account?.name ?? "Chưa gắn account",
    email: invitation.invitedEmail,
    filterText: "",
    kind: "portal",
    magicLink: invitation.magicLink,
    name: "Khách hàng được mời",
    projectId: project?.id,
    projectName: project?.name ?? "Portal theo account",
    roleCode: portalRole.code,
    roleLabel: portalRole.label,
    source: "local",
    status: invitation.status === "review_required" ? "review_required" : "pending"
  });
}

function withFilterText(member: MemberRow): MemberRow {
  return {
    ...member,
    filterText: [
      member.name,
      member.email,
      member.roleCode,
      member.roleLabel,
      member.accountName,
      member.projectName,
      member.status,
      member.kind
    ]
      .join(" ")
      .toLowerCase()
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({} as T));
}

async function errorMessage(response: Response) {
  return messageFromPayload(await readJson<{ message?: string }>(response));
}

function isSessionExpiredResponse(response: Response) {
  return response.status === 401 || response.headers.get("x-crm-session-status") === "invalid";
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const loginUrl = `/login?returnTo=${encodeURIComponent(returnTo)}&auth_error=session_required`;
  window.location.assign(loginUrl);
}

function messageFromPayload(payload: unknown) {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    return typeof message === "string" ? message : JSON.stringify(message);
  }
  return "Yêu cầu chưa thành công.";
}

function PolicyMemberAvatar({ member }: { member: MemberRow }) {
  return (
    <span className="policy-member-avatar" aria-label={member.name || member.email}>
      {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initialsFor(member.name || member.email)}
    </span>
  );
}

function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "U").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

function formatDepartment(departmentCode: string) {
  const labels: Record<string, string> = {
    delivery: "Delivery",
    dx: "DX",
    finance: "Finance",
    founder: "Founder/GM",
    sales: "Sales"
  };
  return labels[departmentCode] ?? departmentCode;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
