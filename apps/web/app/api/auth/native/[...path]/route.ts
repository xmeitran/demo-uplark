import { proxyNativeAuth } from "@/lib/native-auth-proxy";
export const dynamic = "force-dynamic";
const allowed: Record<string, RegExp> = {
  GET: /^(capabilities|account|sessions|workspaces|admin\/invitations)$/,
  PATCH: /^(account|admin\/users\/[^/]+\/role)$/,
  POST: /^(password\/(login|forgot|reset|change)|email\/(verify|verification-request|change-request)|mfa\/(challenge|enroll|confirm|disable)|invitations\/activate|admin\/invitations(?:\/[^/]+\/revoke)?|sessions\/(revoke-others|[^/]+\/revoke)|workspaces\/switch|admin\/users\/[^/]+\/reactivate)$/,
};
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.map(encodeURIComponent).join("/");
  if (!allowed[request.method]?.test(path)) return Response.json({ message: "Not found" }, { status: 404 });
  return proxyNativeAuth(request, path);
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
