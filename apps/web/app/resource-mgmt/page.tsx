import { cookies } from "next/headers";
import { CRM_SESSION_COOKIE_NAME } from "../../src/lib/crm-bff-proxy";
import { getAuthMeWithAuth } from "../../src/lib/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ResourceMgmtPage() {
  const { ResourceMgmtFunctionPage } = await import("../../src/components/crm-workspace/resource-mgmt");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(CRM_SESSION_COOKIE_NAME)?.value;
  const principal = await getAuthMeWithAuth({ sessionToken });

  return (
    <ResourceMgmtFunctionPage
      shellPrincipal={principal?.displayName}
      shellPrincipalAvatarUrl={principal?.avatarUrl}
    />
  );
}
