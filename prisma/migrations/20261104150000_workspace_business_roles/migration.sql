-- Admin › Setting: an organization's own business roles carry the permissions of a built-in one.
ALTER TABLE "Role" ADD COLUMN "baseRoleCode" TEXT;

-- Per organization: renamed / hidden built-in business roles, and the organization's own roles.
CREATE TABLE "WorkspaceBusinessRole" (
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceBusinessRole_pkey" PRIMARY KEY ("workspaceId","code")
);

ALTER TABLE "WorkspaceBusinessRole" ADD CONSTRAINT "WorkspaceBusinessRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
