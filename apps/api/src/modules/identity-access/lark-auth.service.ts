import { activeMembershipWhere } from "./active-membership";
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  InternalServerErrorException,
  Logger
} from "@nestjs/common";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { tenantKey, workspaceKey } from "../../shared/http/request-context";
import { TenantWorkspaceService, type WorkspaceContext } from "../tenant-workspace/tenant-workspace.service";
import { NativeAuthService } from "./native-auth.service";
import { PrincipalService } from "./principal.service";
import { lockWorkspaceAuth } from "./auth-lifecycle-lock";

const STATE_TTL_MS = 1000 * 60 * 10;
const DEFAULT_AUTHORIZE_URL = "https://accounts.larksuite.com/open-apis/authen/v1/authorize";
const DEFAULT_TOKEN_URL = "https://open.larksuite.com/open-apis/authen/v2/oauth/token";
const DEFAULT_USER_INFO_URL = "https://open.larksuite.com/open-apis/authen/v1/user_info";
const DEFAULT_TENANT_TOKEN_URL = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal";
const PROVIDER = "lark";

interface LarkStatePayload {
  nonce: string;
  returnTo: string;
  redirectUri: string;
  tenantKey: string;
  workspaceKey: string;
  exp: number;
  invitationTokenHash?: string;
}

interface LarkTokenResponse {
  code?: string | number;
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface LarkUserInfoResponse {
  code?: number;
  msg?: string;
  data?: {
    name?: string;
    en_name?: string;
    avatar_url?: string;
    avatar_thumb?: string;
    avatar_middle?: string;
    avatar_big?: string;
    open_id?: string;
    union_id?: string;
    email?: string;
    enterprise_email?: string;
    user_id?: string;
    tenant_key?: string;
  };
}

interface LarkDirectoryUserResponse {
  code?: number;
  data?: {
    user?: {
      email?: string;
      enterprise_email?: string;
    };
  };
}

interface NormalizedLarkProfile {
  openId: string;
  unionId?: string;
  userId?: string;
  tenantKey?: string;
  email?: string;
  enterpriseEmail?: string;
  displayName: string;
  avatarUrl?: string;
}

@Injectable()
export class LarkAuthService {
  private readonly logger = new Logger(LarkAuthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantWorkspaceService) private readonly workspaces: TenantWorkspaceService,
    @Inject(PrincipalService) private readonly principals: PrincipalService,
    @Inject(NativeAuthService) private readonly nativeAuth: NativeAuthService
  ) {}

  async createAuthorizeUrl(input: { returnTo?: string; redirectUri?: string; invitationTokenHash?: string }) {
    if (input.invitationTokenHash && !/^[a-f0-9]{64}$/.test(input.invitationTokenHash)) throw new BadRequestException("Invalid invitation binding");
    const appId = this.requiredEnv("LARK_APP_ID");
    const redirectUri = this.normalizeRedirectUri(input.redirectUri);
    const returnTo = safeReturnTo(input.returnTo);
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);
    const state = this.signState({
      nonce: randomBytes(18).toString("base64url"),
      returnTo,
      redirectUri,
      tenantKey: tenantKey(),
      workspaceKey: workspaceKey(),
      exp: expiresAt.getTime(),
      invitationTokenHash: input.invitationTokenHash
    });

    await this.prisma.authActionToken.create({ data: {
      tokenHash: createHash("sha256").update(state).digest("hex"), purpose: "LARK_STATE", expiresAt
    } });

    const authorizationUrl = new URL(process.env.LARK_OAUTH_AUTHORIZE_URL ?? DEFAULT_AUTHORIZE_URL);
    authorizationUrl.searchParams.set("client_id", appId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    const scope = normalizeScopes(process.env.LARK_OAUTH_SCOPES ?? "contact:user.email:readonly contact:user.employee_id:readonly");
    if (scope) {
      authorizationUrl.searchParams.set("scope", scope);
    }

    return {
      authorizationUrl: authorizationUrl.toString(),
      state,
      expiresAt: expiresAt.toISOString()
    };
  }

  async completeCallback(input: { code?: string; state?: string; redirectUri?: string; invitationToken?: string }) {
    let stage = "validate callback";
    try {
      const code = requiredString(input.code, "code");
      const redirectUri = this.normalizeRedirectUri(input.redirectUri);
      const state = this.verifyState(requiredString(input.state, "state"));
      if (state.redirectUri !== redirectUri) {
        throw new BadRequestException("Lark redirectUri does not match authorization state");
      }

      const invitationTokenHash = input.invitationToken ? createHash("sha256").update(input.invitationToken).digest("hex") : undefined;
      if (state.invitationTokenHash !== invitationTokenHash) throw new BadRequestException("Invitation does not match authorization state");
      const consumed = await this.prisma.authActionToken.updateMany({
        where: { tokenHash: createHash("sha256").update(input.state!).digest("hex"), purpose: "LARK_STATE", consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) throw new BadRequestException("OAuth state is expired or already used");

      stage = "exchange authorization code";
      const token = await this.exchangeCodeForToken({ code, redirectUri });
      stage = "fetch Lark user profile";
      const profile = await this.fetchUserInfo(token.accessToken);
      stage = "resolve workspace";
      const workspace = await this.workspaces.resolveWorkspace({
        tenantKey: state.tenantKey,
        workspaceKey: state.workspaceKey
      });
      this.assertLarkTenantAllowed(profile.tenantKey);
      stage = "resolve CRM user";
      const userId = input.invitationToken
        ? (await this.nativeAuth.acceptSsoInvitation(input.invitationToken, profile, workspace)).userId
        : (await this.resolveUserFromProfile(profile, workspace)).id;
      stage = "create CRM session";
      const session = await this.nativeAuth.completeIdentityLogin(userId, {
        tenantKey: workspace.tenantKey,
        workspaceId: workspace.workspaceId,
        workspaceKey: workspace.workspaceKey
      }, { authMethod: "lark" });

      return {
        ...session,
        returnTo: state.returnTo
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Lark OAuth callback failed at ${stage}: ${message}`);
      throw error;
    }
  }

  async createLinkedSession(input: { openId?: string; tenantKey?: string; workspaceKey?: string }) {
    if (process.env.NODE_ENV === "production" || process.env.CRM_LOCAL_AUTH_ENABLED !== "true" || process.env.CRM_ENABLE_DIRECT_LARK_SESSION !== "true") {
      throw new ForbiddenException("Direct Lark session creation is disabled in production");
    }

    const openId = requiredString(input.openId, "openId");
    const workspace = await this.workspaces.resolveWorkspace({
      tenantKey: input.tenantKey,
      workspaceKey: input.workspaceKey
    });
    const identity = await this.prisma.portalIdentity.findUnique({
      where: {
        provider_providerUserId_tenantKey: {
          provider: PROVIDER,
          providerUserId: openId,
          tenantKey: workspace.tenantKey
        }
      }
    });
    if (!identity) {
      throw new ForbiddenException("Lark identity is not linked to a CRM user");
    }

    return this.principals.createSessionForUser(identity.userId, {
      tenantKey: workspace.tenantKey,
      workspaceId: workspace.workspaceId,
      workspaceKey: workspace.workspaceKey
    });
  }

  private async exchangeCodeForToken(input: { code: string; redirectUri: string }) {
    const response = await this.providerFetch(process.env.LARK_OAUTH_TOKEN_URL ?? DEFAULT_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.requiredEnv("LARK_APP_ID"),
        client_secret: this.requiredEnv("LARK_APP_SECRET"),
        code: input.code,
        redirect_uri: input.redirectUri
      })
    });
    const body = (await response.json().catch(() => ({}))) as LarkTokenResponse;
    if (!response.ok || String(body.code ?? "0") !== "0" || !body.access_token) {
      throw new BadGatewayException("Lark token exchange failed");
    }

    return {
      accessToken: body.access_token,
      expiresIn: body.expires_in,
      scope: body.scope
    };
  }

  private async fetchUserInfo(accessToken: string): Promise<NormalizedLarkProfile> {
    const response = await this.providerFetch(process.env.LARK_USER_INFO_URL ?? DEFAULT_USER_INFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const body = (await response.json().catch(() => ({}))) as LarkUserInfoResponse;
    if (!response.ok || body.code !== 0 || !body.data?.open_id) {
      throw new BadGatewayException("Lark user information could not be verified");
    }

    // The OAuth user_info response can expose the account's personal email.
    // Resolve the directory record as well so a company-managed address wins
    // when Lark has both values available. The directory lookup is best-effort:
    // missing contact permission must not prevent an otherwise valid login.
    const directoryUser = body.data.user_id ? await this.fetchDirectoryUser(body.data.user_id) : undefined;
    const email = normalizeEmail(body.data.email);
    const enterpriseEmail = normalizeEmail(directoryUser?.enterprise_email ?? body.data.enterprise_email);

    return {
      openId: body.data.open_id,
      unionId: body.data.union_id,
      userId: body.data.user_id,
      tenantKey: body.data.tenant_key,
      email,
      enterpriseEmail,
      displayName: body.data.name?.trim() || body.data.en_name?.trim() || enterpriseEmail || email || body.data.open_id,
      avatarUrl: body.data.avatar_url ?? body.data.avatar_big ?? body.data.avatar_middle ?? body.data.avatar_thumb
    };
  }

  private async fetchDirectoryUser(userId: string) {
    const appId = process.env.LARK_APP_ID?.trim();
    const appSecret = process.env.LARK_APP_SECRET?.trim();
    if (!appId || !appSecret || appId === "local-disabled" || appSecret === "local-disabled") return undefined;

    const baseUrl = (process.env.LARK_OPEN_API_BASE_URL?.trim() || "https://open.larksuite.com").replace(/\/$/, "");
    try {
      const tokenResponse = await this.providerFetch(process.env.LARK_TENANT_TOKEN_URL ?? DEFAULT_TENANT_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
      const tokenBody = (await tokenResponse.json().catch(() => ({}))) as { code?: number; tenant_access_token?: string };
      if (!tokenResponse.ok || tokenBody.code !== 0 || !tokenBody.tenant_access_token) return undefined;

      const response = await this.providerFetch(`${baseUrl}/open-apis/contact/v3/users/${encodeURIComponent(userId)}?user_id_type=user_id`, {
        headers: { authorization: `Bearer ${tokenBody.tenant_access_token}` }
      });
      const body = (await response.json().catch(() => ({}))) as LarkDirectoryUserResponse;
      if (!response.ok || body.code !== 0) return undefined;
      return body.data?.user;
    } catch {
      this.logger.warn("Lark directory email lookup was unavailable; falling back to OAuth profile email");
      return undefined;
    }
  }

  private async resolveUserFromProfile(profile: NormalizedLarkProfile, workspace: WorkspaceContext) {
    this.assertLarkTenantAllowed(profile.tenantKey);

    const linkedIdentity = await this.prisma.portalIdentity.findUnique({
      where: {
        provider_providerUserId_tenantKey: {
          provider: PROVIDER,
          providerUserId: profile.openId,
          tenantKey: workspace.tenantKey
        }
      },
      include: { user: true }
    });
    if (linkedIdentity) {
      await this.requireActiveMembership(linkedIdentity.user, workspace);
      return this.updateUserProfile(linkedIdentity.user.id, profile);
    }

    const matchedUser = await this.findUserByEmail(profile);
    if (matchedUser) {
      await this.requireActiveMembership(matchedUser, workspace);
      await this.linkIdentity(matchedUser.id, profile.openId, workspace.tenantKey);
      return this.updateUserProfile(matchedUser.id, profile);
    }

    const bootstrapAdmin = await this.findBootstrapAdmin(profile.openId, workspace);
    if (bootstrapAdmin) {
      await this.requireActiveMembership(bootstrapAdmin, workspace);
      await this.linkIdentity(bootstrapAdmin.id, profile.openId, workspace.tenantKey);
      return this.updateUserProfile(bootstrapAdmin.id, profile);
    }

    if (process.env.CRM_LARK_AUTO_PROVISION === "true") {
      return this.provisionUserFromProfile(profile, workspace);
    }

    throw new ForbiddenException("Lark user is not allowed for this CRM workspace");
  }

  private async provisionUserFromProfile(profile: NormalizedLarkProfile, workspace: WorkspaceContext) {
    const email = profile.enterpriseEmail ?? profile.email;
    if (!email) {
      throw new ForbiddenException("Lark account email is required for workspace access");
    }

    const roleCode = (process.env.CRM_LARK_DEFAULT_ROLE_CODE ?? "WORKSPACE_USER").trim().toUpperCase();
    const allowedProvisioningRoles = new Set(["WORKSPACE_USER", "SALES_OWNER", "DELIVERY_LEAD", "FINANCE_ADMIN"]);
    if (!allowedProvisioningRoles.has(roleCode)) {
      throw new InternalServerErrorException("CRM_LARK_DEFAULT_ROLE_CODE must be a non-admin workspace role");
    }

    return this.prisma.$transaction(async tx => {
      // Serialize first-login provisioning per workspace so two OAuth callbacks
      // cannot create duplicate users or memberships for the same account.
      await lockWorkspaceAuth(tx, workspace.workspaceId);

      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        await this.requireActiveMembership(existingUser, workspace);
        const existingIdentity = await tx.portalIdentity.findUnique({
          where: {
            provider_providerUserId_tenantKey: {
              provider: PROVIDER,
              providerUserId: profile.openId,
              tenantKey: workspace.tenantKey
            }
          }
        });
        if (existingIdentity && existingIdentity.userId !== existingUser.id) {
          throw new ForbiddenException("Lark identity is already linked to another account");
        }
        await tx.portalIdentity.upsert({
          where: {
            provider_providerUserId_tenantKey: {
              provider: PROVIDER,
              providerUserId: profile.openId,
              tenantKey: workspace.tenantKey
            }
          },
          update: {},
          create: {
            userId: existingUser.id,
            provider: PROVIDER,
            providerUserId: profile.openId,
            tenantKey: workspace.tenantKey
          }
        });
        return this.updateUserProfile(existingUser.id, profile);
      }

      const role = await tx.role.findUnique({ where: { code: roleCode } });
      if (!role) {
        throw new InternalServerErrorException(`CRM Lark role ${roleCode} is not configured`);
      }

      const user = await tx.user.create({
        data: {
          email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          emailVerifiedAt: new Date(),
          subjectType: "INTERNAL_USER",
          status: "ACTIVE"
        }
      });
      await tx.portalIdentity.create({
        data: {
          userId: user.id,
          provider: PROVIDER,
          providerUserId: profile.openId,
          tenantKey: workspace.tenantKey
        }
      });
      await tx.roleBinding.create({
        data: {
          userId: user.id,
          roleId: role.id,
          tenantKey: workspace.tenantKey,
          workspaceId: workspace.workspaceId
        }
      });

      return user;
    });
  }

  private async findUserByEmail(profile: NormalizedLarkProfile) {
    const emails = [profile.enterpriseEmail, profile.email].filter(Boolean) as string[];
    if (!emails.length) {
      return undefined;
    }

    const users = await this.prisma.user.findMany({
      where: { email: { in: emails } },
      orderBy: { createdAt: "asc" }
    });
    return users.find((user) => user.email === profile.enterpriseEmail) ?? users[0];
  }

  private async findBootstrapAdmin(openId: string, workspace: WorkspaceContext) {
    if (!csv(process.env.FOUNDATION_ADMIN_LARK_OPEN_IDS ?? process.env.FOUNDATION_ADMIN_LARK_OPEN_ID).includes(openId)) {
      return undefined;
    }

    const adminUserId = process.env.FOUNDATION_ADMIN_USER_ID?.trim();
    const adminEmail = normalizeEmail(process.env.FOUNDATION_ADMIN_EMAIL);
    return this.prisma.user.findFirst({
      where: adminUserId
        ? { id: adminUserId, status: "ACTIVE" }
        : adminEmail
        ? { email: adminEmail, status: "ACTIVE" }
        : {
            status: "ACTIVE",
            roleBindings: {
              some: {
                tenantKey: workspace.tenantKey,
                endsAt: null,
                role: { code: process.env.FOUNDATION_ADMIN_ROLE ?? "FOUNDER_GM" }
              }
            }
          },
      orderBy: { createdAt: "asc" }
    });
  }

  private async requireActiveMembership(user: { id: string; status: string }, workspace: WorkspaceContext) {
    if (user.status !== "ACTIVE") throw new ForbiddenException("Account is inactive");
    const membership = await this.prisma.roleBinding.findFirst({ where: { userId: user.id, workspaceId: workspace.workspaceId, tenantKey: workspace.tenantKey, ...activeMembershipWhere() } });
    const grant = membership ? undefined : await this.prisma.customerAccessGrant.findFirst({ where: { userId: user.id, workspaceId: workspace.workspaceId, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
    if (!membership && !grant) throw new ForbiddenException("Active workspace membership is required");
  }

  private async providerFetch(url: string, init: RequestInit) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(10000), redirect: "error" });
    } catch {
      throw new BadGatewayException("Lark authentication provider is temporarily unavailable");
    }
  }

  private async updateUserProfile(userId: string, profile: NormalizedLarkProfile) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl ?? undefined
      }
    });
  }

  private async linkIdentity(userId: string, openId: string, crmTenantKey: string) {
    const identity = await this.prisma.portalIdentity.upsert({
      where: {
        provider_providerUserId_tenantKey: {
          provider: PROVIDER,
          providerUserId: openId,
          tenantKey: crmTenantKey
        }
      },
      update: {},
      create: {
        userId,
        provider: PROVIDER,
        providerUserId: openId,
        tenantKey: crmTenantKey
      }
    });
    if (identity.userId !== userId) throw new ForbiddenException("Lark identity is already linked to another account");
    return identity;
  }

  private assertLarkTenantAllowed(larkTenantKey?: string) {
    const allowed = csv(process.env.LARK_ALLOWED_TENANT_KEYS);
    if (allowed.length && (!larkTenantKey || !allowed.includes(larkTenantKey))) {
      throw new ForbiddenException("Lark tenant is not allowed for this CRM workspace");
    }
  }

  private normalizeRedirectUri(value?: string) {
    const raw = requiredString(value, "redirectUri");
    let url: URL;
    try { url = new URL(raw); } catch { throw new BadRequestException("Invalid redirectUri"); }
    const configured = csv(process.env.LARK_OAUTH_REDIRECT_URIS);
    for (const origin of [process.env.PUBLIC_WEB_URL, process.env.PUBLIC_APP_URL]) {
      if (origin) {
        try { configured.push(new URL("/api/auth/lark/callback", origin).toString()); } catch { /* reject below */ }
      }
    }
    const local = process.env.NODE_ENV !== "production" && process.env.CRM_LOCAL_AUTH_ENABLED === "true"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.pathname === "/api/auth/lark/callback";
    if (url.username || url.password || url.hash || url.search || !["http:", "https:"].includes(url.protocol)
      || (!local && (url.protocol !== "https:" || !configured.includes(url.toString())))) {
      throw new BadRequestException("redirectUri is not configured for this application");
    }
    return url.toString();
  }

  private signState(payload: LarkStatePayload) {
    const encoded = base64UrlJson(payload);
    const signature = createHmac("sha256", this.stateSecret()).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  private verifyState(state: string): LarkStatePayload {
    const [encoded, signature] = state.split(".");
    if (!encoded || !signature) {
      throw new BadRequestException("Invalid Lark OAuth state");
    }

    const expected = createHmac("sha256", this.stateSecret()).update(encoded).digest("base64url");
    if (!constantTimeEqual(signature, expected)) {
      throw new BadRequestException("Invalid Lark OAuth state signature");
    }

    const payload = parseBase64UrlJson(encoded) as LarkStatePayload;
    if (!payload.returnTo || !payload.redirectUri || !payload.nonce || !payload.exp || payload.exp < Date.now()) {
      throw new BadRequestException("Expired or malformed Lark OAuth state");
    }

    return {
      ...payload,
      returnTo: safeReturnTo(payload.returnTo)
    };
  }

  private stateSecret() {
    const secret = process.env.LARK_OAUTH_STATE_SECRET || process.env.CRM_SESSION_SECRET || process.env.LARK_APP_SECRET;
    if (!secret) throw new InternalServerErrorException("Lark OAuth signing secret is required");
    return secret;
  }

  private requiredEnv(name: string) {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new InternalServerErrorException(`${name} is required for Lark SSO`);
    }

    return value;
  }
}

function normalizeScopes(value: string) {
  return [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))].join(" ");
}

function safeReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }

  return value;
}

function requiredString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${fieldName} is required`);
  }

  return value.trim();
}

function normalizeEmail(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function csv(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseBase64UrlJson(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new BadRequestException("Invalid Lark OAuth state payload");
  }
}

function constantTimeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}
