import { describe, expect, it } from "vitest";
import { ApiResponseError, apiErrorMessage, isNetworkFailure, readApiError } from "./api-error";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readApiError", () => {
  it("surfaces the API message (string or validation array)", async () => {
    expect((await readApiError(json(400, { message: "Thiếu lý do On Hold." }))).message).toBe("Thiếu lý do On Hold.");
    expect((await readApiError(json(422, { message: ["a", "b"] }))).message).toBe("a, b");
  });

  it("falls back to the status when the body has no message", async () => {
    const error = await readApiError(new Response("<html>", { status: 500 }));
    expect(error.message).toBe("Yêu cầu thất bại (500).");
    expect(error.status).toBe(500);
  });
});

describe("offline draft rule", () => {
  it("never treats an API rejection as a network failure", () => {
    expect(isNetworkFailure(new ApiResponseError("x", 400))).toBe(false);
    expect(isNetworkFailure(new ApiResponseError("x", 403))).toBe(false);
    expect(isNetworkFailure(new ApiResponseError("x", 500))).toBe(false);
  });

  it("treats a thrown fetch or an unreachable gateway as a network failure", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new ApiResponseError("x", 503))).toBe(true);
  });

  it("shows the API message, or the fallback when the API never answered", () => {
    expect(apiErrorMessage(new ApiResponseError("Không đủ quyền", 403), "fallback")).toBe("Không đủ quyền");
    expect(apiErrorMessage(new TypeError("Failed to fetch"), "fallback")).toBe("fallback");
  });
});
