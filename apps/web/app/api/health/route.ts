import { NextResponse } from "next/server";

const DEFAULT_API_BASE_URL = "http://api:4000";

function getApiBaseUrl() {
  return (process.env.CRM_API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

export async function GET() {
  const response = await fetch(`${getApiBaseUrl()}/api/health`, {
    cache: "no-store",
    headers: { accept: "application/json" }
  });
  const body = await response.json().catch(() => ({ ok: false, service: "b2b-crm-saas-api" }));
  return NextResponse.json(body, { status: response.status });
}
