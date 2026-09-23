import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { tenantKey, workspaceKey, workspaceName } from "../../shared/http/request-context";

export interface WorkspaceContext {
  tenantKey: string;
  workspaceId: string;
  workspaceKey: string;
}

@Injectable()
export class TenantWorkspaceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ensureDefaultWorkspace() {
    return this.prisma.tenantWorkspace.upsert({
      where: {
        tenantKey_workspaceKey: {
          tenantKey: tenantKey(),
          workspaceKey: workspaceKey()
        }
      },
      update: {},
      create: {
        id: process.env.FOUNDATION_WORKSPACE_ID ?? "twk-foundation",
        tenantKey: tenantKey(),
        workspaceKey: workspaceKey(),
        name: workspaceName(),
        status: "active",
        planCode: process.env.FOUNDATION_WORKSPACE_PLAN ?? "foundation",
        regionCode: process.env.FOUNDATION_WORKSPACE_REGION ?? undefined
      }
    });
  }

  async resolveWorkspace(input?: { workspaceId?: string | null; workspaceKey?: string | null; tenantKey?: string | null }) {
    if (input?.workspaceId) {
      const workspace = await this.prisma.tenantWorkspace.findUnique({ where: { id: input.workspaceId } });
      if (!workspace || workspace.status !== "active") {
        throw new NotFoundException("Workspace not found");
      }

      return this.toContext(workspace);
    }

    const key = input?.workspaceKey?.trim() || workspaceKey();
    const tenant = input?.tenantKey?.trim() || tenantKey();
    const workspace = await this.prisma.tenantWorkspace.findUnique({
      where: { tenantKey_workspaceKey: { tenantKey: tenant, workspaceKey: key } }
    });

    if (workspace && workspace.status === "active") {
      return this.toContext(workspace);
    }

    if (workspace) throw new NotFoundException("Workspace is inactive");

    if (tenant === tenantKey() && key === workspaceKey()) {
      return this.toContext(await this.ensureDefaultWorkspace());
    }

    throw new NotFoundException("Workspace not found");
  }

  async listWorkspaces(input?: { tenantKey?: string | null }) {
    const tenant = input?.tenantKey?.trim() || tenantKey();
    const workspaces = await this.prisma.tenantWorkspace.findMany({
      where: { tenantKey: tenant },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });

    return {
      data: workspaces.map((workspace) => ({
        id: workspace.id,
        tenantKey: workspace.tenantKey,
        workspaceKey: workspace.workspaceKey,
        name: workspace.name,
        status: workspace.status,
        planCode: workspace.planCode,
        regionCode: workspace.regionCode ?? undefined,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString()
      })),
      meta: { tenantKey: tenant, total: workspaces.length }
    };
  }

  toContext(workspace: { id: string; tenantKey: string; workspaceKey: string }): WorkspaceContext {
    return {
      tenantKey: workspace.tenantKey,
      workspaceId: workspace.id,
      workspaceKey: workspace.workspaceKey
    };
  }
}
