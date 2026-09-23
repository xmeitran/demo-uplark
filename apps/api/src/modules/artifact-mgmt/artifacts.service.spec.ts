import { BadRequestException } from "@nestjs/common";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { ArtifactsService } from "./artifacts.service";

const principal: PrincipalContext = {
  subjectType: "internal_user",
  subjectId: "usr-1",
  displayName: "Test User",
  email: "test@example.com",
  tenantKey: "prod",
  workspaceId: "twk-1",
  workspaceKey: "default",
  roleCodes: ["DELIVERY_LEAD"],
  accountIds: [],
  projectIds: [],
  customerAccountIds: [],
  customerProjectIds: [],
  roleVersion: "test",
  grantVersion: "test"
};

describe("ArtifactsService file lifecycle", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "b2b-crm-files-"));
    vi.stubEnv("CRM_FILE_STORAGE_ROOT", storageRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("writes validated local upload bytes and reads them back through a download grant", async () => {
    let storedFile: any;
    const prisma: Record<string, any> = {
      account: {
        findFirst: vi.fn().mockResolvedValue({ id: "acc-1", workspaceId: "twk-1" })
      },
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1" })
      },
      fileObject: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          storedFile = {
            id: "file-1",
            ...data,
            createdAt: new Date("2026-07-02T00:00:00.000Z"),
            updatedAt: new Date("2026-07-02T00:00:00.000Z")
          };
          return storedFile;
        }),
        findFirst: vi.fn().mockImplementation(async () => storedFile)
      },
      fileDownloadGrant: {
        create: vi.fn().mockResolvedValue({ id: "grant-1" }),
        findFirst: vi.fn().mockImplementation(async () => ({
          id: "grant-1",
          usedAt: null,
          fileObject: storedFile
        })),
        update: vi.fn().mockResolvedValue({ id: "grant-1" })
      }
    };
    const service = new ArtifactsService(prisma as any);
    const bytes = Buffer.from("hello production file lifecycle", "utf8");

    await expect(service.createFile({
      accountId: "acc-1",
      projectId: "prj-1",
      fileName: "handoff.txt",
      contentType: "text/plain",
      base64Data: bytes.toString("base64"),
      ownerType: "task",
      ownerId: "task-1"
    }, principal)).resolves.toMatchObject({
      id: "file-1",
      fileName: "handoff.txt",
      contentType: "text/plain",
      byteSize: bytes.byteLength,
      scanStatus: "clean"
    });

    const storagePath = join(storageRoot, ...storedFile.storageKey.split("/"));
    await expect(readFile(storagePath, "utf8")).resolves.toBe("hello production file lifecycle");

    const grant = await service.createDownloadGrant("file-1", { expiresInSeconds: 300 }, principal);
    const token = new URL(`http://localhost${grant.signedUrl}`).searchParams.get("token") ?? "";
    const download = await service.downloadFile("file-1", token);

    expect(download.file.id).toBe("file-1");
    expect(download.bytes.toString("utf8")).toBe("hello production file lifecycle");
    expect(prisma.fileDownloadGrant.update).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { usedAt: expect.any(Date) }
    });
  });

  it("blocks unsupported file types before storage write", async () => {
    const service = new ArtifactsService({
      account: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", workspaceId: "twk-1" }) }
    } as any);

    await expect(service.createFile({
      accountId: "acc-1",
      fileName: "payload.js",
      contentType: "application/javascript",
      base64Data: Buffer.from("alert(1)").toString("base64")
    }, principal)).rejects.toThrow(BadRequestException);
  });

  it("does not grant downloads until a file is clean", async () => {
    const service = new ArtifactsService({
      fileObject: {
        findFirst: vi.fn().mockResolvedValue({
          id: "file-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: null,
          status: "active",
          scanStatus: "pending"
        })
      }
    } as any);

    await expect(service.createDownloadGrant("file-1", { expiresInSeconds: 300 }, principal)).rejects.toThrow(BadRequestException);
  });
});
