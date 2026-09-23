export function resolveWorkspaceSessionToken({
  cookieSessionToken,
  nodeEnv = process.env.NODE_ENV,
  querySessionToken
}: {
  cookieSessionToken?: string;
  nodeEnv?: string;
  querySessionToken?: string;
}) {
  return cookieSessionToken;
}

export function shouldRequirePublicSession({
  crmPublicSessionRequired = process.env.CRM_PUBLIC_SESSION_REQUIRED,
  nodeEnv = process.env.NODE_ENV,
  sessionToken
}: {
  crmPublicSessionRequired?: string;
  nodeEnv?: string;
  sessionToken?: string;
}) {
  if (sessionToken) {
    return false;
  }

  if (nodeEnv === "production") {
    return true;
  }

  if (crmPublicSessionRequired === "0") {
    return false;
  }

  return crmPublicSessionRequired === "1";
}

export function shouldFailClosedOnProtectedFallback({
  crmAllowPrincipalFallback = process.env.CRM_ALLOW_PRINCIPAL_FALLBACK,
  crmPublicSessionRequired = process.env.CRM_PUBLIC_SESSION_REQUIRED,
  nodeEnv = process.env.NODE_ENV
}: {
  crmAllowPrincipalFallback?: string;
  crmPublicSessionRequired?: string;
  nodeEnv?: string;
}) {
  if (nodeEnv === "production") {
    return true;
  }

  if (crmAllowPrincipalFallback !== "true") {
    return true;
  }

  if (crmPublicSessionRequired === "0") {
    return false;
  }

  return crmPublicSessionRequired === "1";
}
