import { describe, expect, it, vi } from "vitest";
import { AlertsService } from "./alerts.service";

const admin = { subjectId: "u1", subjectType: "internal_user", workspaceId: "w1", roleCodes: ["WORKSPACE_ADMIN"] } as any;

function setup(total = 0) {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { projectWarning: { findMany, count: vi.fn().mockResolvedValue(total), groupBy: vi.fn().mockResolvedValue([]) }, user: { findMany: vi.fn().mockResolvedValue([]) } };
  return { service: new AlertsService(prisma as any, {} as any, {} as any), findMany };
}

describe("AlertsService.listWarnings filters", () => {
  it("defaults to open warnings, 100 per page", async () => {
    const { service, findMany } = setup();
    const result = await service.listWarnings({}, admin);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { workspaceId: "w1", status: { in: ["open"] } }, take: 100, skip: 0 });
    expect(result.meta.pagination).toMatchObject({ limit: 100, offset: 0, total: 0, hasNextPage: false });
  });

  it("accepts comma-joined multi values, an owner list and a Vietnam day range on openedAt", async () => {
    const { service, findMany } = setup(250);
    const result = await service.listWarnings({ status: "open,closed", typeCode: "DL-01,TD-02", projectId: "p1", severity: "high,critical", ownerUserId: "u1,u2", from: "2026-10-01", to: "2026-10-02", limit: "100", offset: "100" }, admin);
    const { where, take, skip } = findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      status: { in: ["open", "closed"] }, typeCode: { in: ["DL-01", "TD-02"] }, projectId: { in: ["p1"] }, severity: { in: ["high", "critical"] }, ownerUserId: { in: ["u1", "u2"] },
      openedAt: { gte: new Date("2026-09-30T17:00:00.000Z"), lt: new Date("2026-10-02T17:00:00.000Z") }
    });
    expect([take, skip]).toEqual([100, 100]);
    expect(result.meta.pagination).toMatchObject({ total: 250, hasNextPage: true });
  });

  it("status=all lifts the status filter and q searches title, detail and project", async () => {
    const { service, findMany } = setup();
    await service.listWarnings({ status: "all", q: " trễ hạn " }, admin);
    const { where } = findMany.mock.calls[0][0];
    expect(where.status).toBeUndefined();
    expect(where.OR).toHaveLength(4);
    expect(where.OR[0]).toEqual({ title: { contains: "trễ hạn", mode: "insensitive" } });
  });

  it("rejects a malformed day", async () => {
    const { service } = setup();
    await expect(service.listWarnings({ from: "10/2026" }, admin)).rejects.toThrow();
  });
});
