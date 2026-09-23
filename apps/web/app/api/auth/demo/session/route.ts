import { proxyNativeAuth } from "@/lib/native-auth-proxy";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.CRM_DEMO_AUTH_ENABLED !== "true") return Response.json({message:"Demo authentication is disabled"},{status:404});
  return proxyNativeAuth(request, "demo/session");
}
