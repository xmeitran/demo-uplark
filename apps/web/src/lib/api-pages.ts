type PagedResponse<T> = { data?: T[]; meta?: { pagination?: { hasNextPage?: boolean; offset?: number; returned?: number; total?: number } } };

export const API_PAGE_LIMIT = 100;

/** Offsets of the pages after the first one, for a list whose total is known. */
export function remainingPageOffsets(total: number, loaded: number, limit = API_PAGE_LIMIT) {
  const offsets: number[] = [];
  for (let offset = limit; offset < total && loaded < total; offset += limit) offsets.push(offset);
  return offsets;
}

async function readPage<T>(url: string, signal: AbortSignal | undefined, errorLabel: string): Promise<PagedResponse<T>> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`${errorLabel} (${response.status}).`);
  return response.json() as Promise<PagedResponse<T>>;
}

/**
 * Load every row of a list endpoint. The API caps `limit` at 100, so one request is never "all":
 * page with limit=100&offset until the reported total (or hasNextPage=false) is reached.
 */
export async function fetchAllPages<T>(path: string, options: { signal?: AbortSignal; errorLabel?: string } = {}): Promise<T[]> {
  const { signal, errorLabel = "Không tải được dữ liệu" } = options;
  const separator = path.includes("?") ? "&" : "?";
  const pageUrl = (offset: number) => `${path}${separator}limit=${API_PAGE_LIMIT}&offset=${offset}`;
  const firstPage = await readPage<T>(pageUrl(0), signal, errorLabel);
  const rows: T[] = [...(firstPage.data ?? [])];
  const firstPagination = firstPage.meta?.pagination;
  const total = firstPagination?.total;

  // A stable total lets the remaining pages load in small concurrent batches.
  if (typeof total === "number" && total > rows.length) {
    const offsets = remainingPageOffsets(total, rows.length);
    for (let index = 0; index < offsets.length; index += 8) {
      const pages = await Promise.all(offsets.slice(index, index + 8).map((offset) => readPage<T>(pageUrl(offset), signal, errorLabel)));
      for (const page of pages) rows.push(...(page.data ?? []));
    }
    return rows;
  }

  // Endpoints without a total: follow hasNextPage.
  let offset = rows.length;
  for (let pageIndex = 1; pageIndex < 100 && firstPagination?.hasNextPage; pageIndex += 1) {
    const payload = await readPage<T>(pageUrl(offset), signal, errorLabel);
    const pageRows = payload.data ?? [];
    rows.push(...pageRows);
    const pagination = payload.meta?.pagination;
    if (!pagination?.hasNextPage || pageRows.length === 0) break;
    const nextOffset = (pagination.offset ?? offset) + (pagination.returned ?? pageRows.length);
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
  return rows;
}
