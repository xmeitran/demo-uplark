import { describe, expect, it } from "vitest";
import { prismaErrorResponse } from "./prisma-exception.filter";

describe("prismaErrorResponse", () => {
  it("turns a unique collision into a 409 that names the field", () => {
    expect(prismaErrorResponse({ code: "P2002", meta: { target: ["workspaceId", "code"] } })).toEqual({
      statusCode: 409,
      message: "Mã đã được dùng cho một bản ghi khác. Hãy nhập giá trị khác rồi lưu lại."
    });
    expect(prismaErrorResponse({ code: "P2002", meta: { target: "Account_workspaceId_code_key" } }).message).toContain("Mã");
  });

  it("stays readable when the constraint columns are unknown", () => {
    const body = prismaErrorResponse({ code: "P2002", meta: null });
    expect(body.statusCode).toBe(409);
    expect(body.message).toContain("bị trùng");
  });

  it("turns a missing row into a 404 and leaves other errors a 500", () => {
    expect(prismaErrorResponse({ code: "P2025" }).statusCode).toBe(404);
    expect(prismaErrorResponse({ code: "P2003" })).toEqual({ statusCode: 500, message: "Internal server error" });
  });
});
