import { proxyNativeAuth } from "@/lib/native-auth-proxy";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return proxyNativeAuth(request, "lark/session");
}
