import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllPages, remainingPageOffsets } from "./api-pages";

afterEach(() => vi.unstubAllGlobals());

function stubPages(pages: Array<{ data: number[]; pagination: Record<string, unknown> }>) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
    const page = pages[offset / 100];
    return new Response(JSON.stringify({ data: page.data, meta: { pagination: page.pagination } }), { status: 200 });
  }));
  return urls;
}

describe("fetchAllPages", () => {
  it("computes the offsets after the first page", () => {
    expect(remainingPageOffsets(250, 100)).toEqual([100, 200]);
    expect(remainingPageOffsets(100, 100)).toEqual([]);
  });

  it("loads past the 100-row cap when the API reports a total", async () => {
    const urls = stubPages([
      { data: Array(100).fill(1), pagination: { total: 230 } },
      { data: Array(100).fill(2), pagination: { total: 230 } },
      { data: Array(30).fill(3), pagination: { total: 230 } }
    ]);
    expect(await fetchAllPages<number>("/api/projects?principal=founder")).toHaveLength(230);
    expect(urls[0]).toBe("/api/projects?principal=founder&limit=100&offset=0");
  });

  it("follows hasNextPage when there is no total", async () => {
    stubPages([
      { data: Array(100).fill(1), pagination: { hasNextPage: true, offset: 0, returned: 100 } },
      { data: Array(5).fill(2), pagination: { hasNextPage: false, offset: 100, returned: 5 } }
    ]);
    expect(await fetchAllPages<number>("/api/risks")).toHaveLength(105);
  });

  it("throws with the status instead of returning a partial list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(fetchAllPages("/api/projects", { errorLabel: "Không tải được dự án" })).rejects.toThrow("Không tải được dự án (403).");
  });
});
