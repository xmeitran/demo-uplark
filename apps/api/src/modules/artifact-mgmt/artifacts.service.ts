import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { CreateFileDownloadGrantInput, PrincipalContext, UploadFileInput } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { seesAllProjects, visibleProjectWhere } from "../delivery-handoff/project-visibility";
import { buildPaginationMeta, nonEmptyString, normalizePagination, optionalBoolean, optionalInteger, optionalString } from "../../shared/http/request-context";
import { optionalStringArray, toIso } from "../../shared/http/api-mappers";
import { parseExternalUrl, validateFileName } from "./file-names";

/**
 * Files and artifacts follow the project they belong to (7.7): an account sees the files of the projects it may see,
 * plus client-level files (no project). Customers see only files shared with them inside their grants.
 */
function visibleFileWhere(principal: PrincipalContext): Record<string, unknown> {
  if (principal.subjectType === "portal_user") {
    return { customerVisible: true, internalOnly: false, OR: [{ projectId: { in: principal.customerProjectIds ?? [] } }, { accountId: { in: principal.customerAccountIds ?? [] } }] };
  }
  if (seesAllProjects(principal)) return {};
  return { OR: [{ projectId: null }, { project: visibleProjectWhere(principal) }] };
}

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/json",
  "application/zip",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain"
];

@Injectable()
export class ArtifactsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listArtifacts(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const where = {
      workspaceId: principal.workspaceId,
      ...(optionalString(query.accountId, "accountId") ? { accountId: query.accountId } : {}),
      ...(optionalString(query.projectId, "projectId") ? { projectId: query.projectId } : {}),
      ...(optionalString(query.artifactType, "artifactType") ? { artifactType: query.artifactType } : {}),
      AND: [visibleFileWhere(principal)]
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.projectArtifact.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: pagination.limit, skip: pagination.offset }),
      this.prisma.projectArtifact.count({ where })
    ]);

    return {
      data: rows.map((row) => this.mapArtifact(row)),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: rows.length })
      }
    };
  }

  async createArtifact(input: any, principal: PrincipalContext) {
    const account = await this.ensureAccount(nonEmptyString(input.accountId, "accountId"), principal.workspaceId);
    if (input.projectId) {
      await this.ensureProject(input.projectId, principal, account.id);
    }
    const code = input.code?.trim() || `${account.code}-ART-${Date.now().toString(36).toUpperCase()}`;
    const artifact = await this.prisma.projectArtifact.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId: account.id,
        projectId: optionalString(input.projectId, "projectId") ?? undefined,
        code,
        name: nonEmptyString(input.name, "name"),
        artifactType: input.artifactType?.trim() || "general",
        storageKey: nonEmptyString(input.storageKey ?? code, "storageKey"),
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
        internalOnly: optionalBoolean(input.internalOnly, "internalOnly") ?? true,
        allowedRoles: optionalStringArray(input.allowedRoles) ?? []
      }
    });

    return this.mapArtifact(artifact);
  }

  async listFiles(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const where = {
      workspaceId: principal.workspaceId,
      ...(optionalString(query.accountId, "accountId") ? { accountId: query.accountId } : {}),
      ...(optionalString(query.projectId, "projectId") ? { projectId: query.projectId } : {}),
      ...(optionalString(query.status, "status") ? { status: query.status } : {}),
      AND: [visibleFileWhere(principal)]
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.fileObject.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: pagination.limit, skip: pagination.offset }),
      this.prisma.fileObject.count({ where })
    ]);

    return {
      data: rows.map((row) => this.mapFile(row)),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: rows.length })
      }
    };
  }

  async createFile(input: UploadFileInput, principal: PrincipalContext) {
    const account = await this.ensureAccount(nonEmptyString(input.accountId, "accountId"), principal.workspaceId);
    if (input.projectId) {
      await this.ensureProject(input.projectId, principal, account.id);
    }
    const storageProvider = input.storageProvider ?? "local";
    if (storageProvider === "external") {
      return this.createExternalFile(input, principal, account.id);
    }
    if (storageProvider !== "local") {
      throw new BadRequestException("Only local file storage is supported for direct uploads");
    }

    const fileName = validateFileName(input.fileName);
    const contentType = this.validateContentType(input.contentType);
    const base64Data = this.normalizeBase64Payload(nonEmptyString(input.base64Data, "base64Data"));
    const maxBytes = this.maxUploadBytes();
    if (base64Data.length > Math.ceil(maxBytes / 3) * 4 + 4) {
      throw new BadRequestException(`File size exceeds ${maxBytes} bytes`);
    }
    const bytes = Buffer.from(base64Data, "base64");
    if (bytes.byteLength === 0) {
      throw new BadRequestException("File content is empty");
    }
    if (bytes.byteLength > maxBytes) {
      throw new BadRequestException(`File size exceeds ${maxBytes} bytes`);
    }

    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `${principal.workspaceId}/${account.id}/${Date.now().toString(36)}-${checksum.slice(0, 12)}-${randomBytes(6).toString("hex")}`;
    const filePath = this.storagePathForKey(storageKey);
    await mkdir(dirname(filePath), { recursive: true });

    let fileWritten = false;
    try {
      await writeFile(filePath, bytes, { flag: "wx" });
      fileWritten = true;
      const file = await this.prisma.fileObject.create({
        data: {
          workspaceId: principal.workspaceId,
          accountId: account.id,
          projectId: optionalString(input.projectId, "projectId") ?? undefined,
          fileName,
          contentType,
          byteSize: bytes.byteLength,
          checksumSha256: checksum,
          storageProvider,
          storageKey,
          ownerType: input.ownerType?.trim() || "general",
          ownerId: optionalString(input.ownerId, "ownerId") ?? undefined,
          customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
          internalOnly: optionalBoolean(input.internalOnly, "internalOnly") ?? true,
          allowedRoles: input.allowedRoles ?? [],
          scanStatus: "clean",
          status: "active",
          createdByUserId: principal.subjectId
        }
      });

      return this.mapFile(file);
    } catch (error) {
      if (fileWritten) {
        await rm(filePath, { force: true });
      }
      throw error;
    }
  }

  async createDownloadGrant(fileObjectId: string, input: CreateFileDownloadGrantInput, principal: PrincipalContext) {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileObjectId, workspaceId: principal.workspaceId, status: "active", AND: [visibleFileWhere(principal)] } });
    if (!file) {
      throw new NotFoundException("File not found");
    }
    if (file.scanStatus !== "clean") {
      throw new BadRequestException("File scan status does not allow download");
    }
    if (file.storageProvider === "external") {
      throw new BadRequestException("External file objects must be opened using externalUrl");
    }

    const expiresInSeconds = optionalInteger(input.expiresInSeconds, "expiresInSeconds") ?? 300;
    if (expiresInSeconds < 30 || expiresInSeconds > 3600) {
      throw new BadRequestException("expiresInSeconds must be between 30 and 3600");
    }
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    await this.prisma.fileDownloadGrant.create({
      data: {
        workspaceId: principal.workspaceId,
        fileObjectId: file.id,
        accountId: file.accountId,
        projectId: file.projectId,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt,
        createdByUserId: principal.subjectId
      }
    });

    return {
      fileObjectId: file.id,
      signedUrl: `/api/files/${encodeURIComponent(file.id)}/download?token=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString()
    };
  }

  async downloadFile(fileObjectId: string, token: string | undefined) {
    const rawToken = nonEmptyString(token, "token");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const grant = await this.prisma.fileDownloadGrant.findFirst({
      where: {
        fileObjectId,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: { fileObject: true }
    });
    if (!grant || !grant.fileObject || grant.fileObject.status !== "active") {
      throw new NotFoundException("Download grant not found");
    }
    if (grant.fileObject.scanStatus !== "clean") {
      throw new BadRequestException("File scan status does not allow download");
    }
    if (grant.fileObject.storageProvider !== "local") {
      throw new BadRequestException("File storage provider is not downloadable");
    }

    const bytes = await readFile(this.storagePathForKey(grant.fileObject.storageKey));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== grant.fileObject.checksumSha256) {
      throw new BadRequestException("Stored file checksum does not match metadata");
    }

    if (!grant.usedAt) {
      await this.prisma.fileDownloadGrant.update({
        where: { id: grant.id },
        data: { usedAt: new Date() }
      });
    }

    return {
      file: this.mapFile(grant.fileObject),
      bytes
    };
  }

  private async ensureAccount(accountId: string, workspaceId: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, workspaceId } });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }

  private async ensureProject(projectId: string, principal: PrincipalContext, accountId: string) {
    if (principal.subjectType === "portal_user") throw new ForbiddenException("Customers cannot add project files");
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId, accountId, AND: [visibleProjectWhere(principal)] } });
    if (!project) {
      throw new BadRequestException("Project does not belong to selected account/workspace");
    }
    return project;
  }

  private mapArtifact(row: any) {
    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId ?? undefined,
      code: row.code,
      name: row.name,
      artifactType: row.artifactType,
      customerVisible: row.customerVisible,
      allowedRoles: optionalStringArray(row.allowedRoles) ?? []
    };
  }

  private mapFile(row: any) {
    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId ?? undefined,
      fileName: row.fileName,
      contentType: row.contentType,
      byteSize: row.byteSize,
      checksumSha256: row.checksumSha256,
      storageProvider: row.storageProvider,
      externalUrl: row.externalUrl ?? undefined,
      ownerType: row.ownerType,
      ownerId: row.ownerId ?? undefined,
      customerVisible: row.customerVisible,
      internalOnly: row.internalOnly,
      allowedRoles: optionalStringArray(row.allowedRoles) ?? [],
      scanStatus: row.scanStatus,
      status: row.status,
      createdAt: toIso(row.createdAt)!,
      revokedAt: toIso(row.revokedAt),
      deletedAt: toIso(row.deletedAt)
    };
  }

  private async createExternalFile(input: UploadFileInput, principal: PrincipalContext, accountId: string) {
    const externalUrl = parseExternalUrl(input.externalUrl);
    // A link's name is only a label (an external file is never downloaded, see downloadFile), so the executable-extension
    // check does not apply: a link named after its host, "upbasevn.sg.larksuite.com", ends in ".com".
    const fileName = validateFileName(input.fileName || externalUrl.hostname, false);
    const checksum = createHash("sha256").update(externalUrl.toString()).digest("hex");
    const storageKey = `external/${principal.workspaceId}/${accountId}/${checksum}-${randomBytes(6).toString("hex")}`;
    const file = await this.prisma.fileObject.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId,
        projectId: optionalString(input.projectId, "projectId") ?? undefined,
        fileName,
        contentType: "text/uri-list",
        byteSize: 0,
        checksumSha256: checksum,
        storageProvider: "external",
        storageKey,
        externalUrl: externalUrl.toString(),
        ownerType: input.ownerType?.trim() || "project_document",
        ownerId: optionalString(input.ownerId, "ownerId") ?? undefined,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
        internalOnly: optionalBoolean(input.internalOnly, "internalOnly") ?? true,
        allowedRoles: input.allowedRoles ?? [],
        scanStatus: "clean",
        status: "active",
        createdByUserId: principal.subjectId
      }
    });
    return this.mapFile(file);
  }

  private maxUploadBytes() {
    const parsed = Number(process.env.CRM_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_UPLOAD_BYTES;
  }

  private validateContentType(value: unknown) {
    const contentType = nonEmptyString(value, "contentType").toLowerCase();
    const allowed = (process.env.CRM_ALLOWED_UPLOAD_CONTENT_TYPES ?? DEFAULT_ALLOWED_CONTENT_TYPES.join(","))
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(contentType)) {
      throw new BadRequestException("contentType is not allowed");
    }
    return contentType;
  }

  private normalizeBase64Payload(value: string) {
    const payload = value.includes(",") ? value.split(",").pop() ?? "" : value;
    const normalized = payload.replace(/\s+/g, "");
    if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
      throw new BadRequestException("base64Data must be valid base64");
    }
    return normalized;
  }

  private storagePathForKey(storageKey: string) {
    const root = normalize(process.env.CRM_FILE_STORAGE_ROOT ?? join(process.cwd(), "var", "crm-files"));
    const target = normalize(join(root, ...storageKey.split("/")));
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new BadRequestException("Invalid storage key");
    }
    return target;
  }
}
