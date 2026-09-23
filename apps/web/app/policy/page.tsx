import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildCrmApiEndpoint, CRM_SESSION_COOKIE_NAME } from "../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function PolicyPage({
  searchParams
}: {
  searchParams?: Promise<{ principal?: string; session?: string }>;
}) {
  await redirectIfPolicySessionIsInvalid();
  const { PolicyFunctionPage } = await import("../../src/components/crm-workspace/policy");
  return <PolicyFunctionPage searchParams={searchParams} />;
}

async function redirectIfPolicySessionIsInvalid() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(CRM_SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return;
  }

  const response = await fetch(buildCrmApiEndpoint("/auth/me"), {
    cache: "no-store",
    headers: {
      authorization: `Bearer ${sessionToken}`
    }
  });

  if (response.status === 401) {
    redirect(`/api/auth/session/expired?returnTo=${encodeURIComponent("/policy")}`);
  }
}
