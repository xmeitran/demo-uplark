import { isSafePnlApiPath } from "../../../../src/components/pnl/pnl-query";
import { proxyCrmBffJson, readJsonBody, type CrmBffMethod } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

/**
 * Tab P&L: every /api/pnl/… call goes to the API's /pnl/… route of the same path and query
 * (dashboard, projects/:id, config/items, config/parameters, config/templates, funds, periods, staff-costs, entries …).
 * The endpoint list and response types are in docs/pnl-api-cho-man-hinh.md and packages/contracts/src/pnl.ts;
 * permissions are enforced by the API. Only /pnl/* is reachable: a path with "." / ".." or any character outside an
 * identifier is answered 404 here and never forwarded.
 */
async function forward(request: Request, context: Context, method: CrmBffMethod) {
  const { path } = await context.params;
  if (!isSafePnlApiPath(path)) return Response.json({ message: "Không tìm thấy." }, { status: 404 });
  const target = `/pnl/${path.map(encodeURIComponent).join("/")}`;
  return proxyCrmBffJson({ request, path: target, method, principalFallback: "founder", ...(method === "GET" ? {} : { body: await readJsonBody(request) }) });
}

export const GET = (request: Request, context: Context) => forward(request, context, "GET");
export const POST = (request: Request, context: Context) => forward(request, context, "POST");
export const PUT = (request: Request, context: Context) => forward(request, context, "PUT");
export const PATCH = (request: Request, context: Context) => forward(request, context, "PATCH");
export const DELETE = (request: Request, context: Context) => forward(request, context, "DELETE");
