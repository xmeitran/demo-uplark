export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { redirect } from "next/navigation";

export default async function WorkspacePage({
  searchParams
}: {
  searchParams?: Promise<{ principal?: string; session?: string }>;
}) {
  redirect(toRootRedirect(await searchParams));
}

function toRootRedirect(params?: { principal?: string; session?: string }) {
  const nextParams = new URLSearchParams();
  if (params?.principal) {
    nextParams.set("principal", params.principal);
  }
  if (params?.session && process.env.NODE_ENV !== "production") {
    nextParams.set("session", params.session);
  }

  const query = nextParams.toString();
  return query ? `/?${query}` : "/";
}
