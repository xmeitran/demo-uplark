#!/usr/bin/env node
// 7.5 "Quét đầu ngày" for deployments without the worker (e.g. Render): call this from a cron.
//   ALERT_SCAN_API_URL=https://<api-host> ALERT_SCAN_TOKEN=<same value as on the API> node scripts/operations/run-alert-scan.mjs [--force]
// --force also scans on a weekend or a workspace day off. See docs/alert-scan.md.
const apiUrl = (process.env.ALERT_SCAN_API_URL ?? process.env.CRM_API_INTERNAL_URL ?? "").trim().replace(/\/$/, "");
const token = (process.env.ALERT_SCAN_TOKEN ?? "").trim();
if (!apiUrl || !token) {
  console.error("ALERT_SCAN_API_URL (or CRM_API_INTERNAL_URL) and ALERT_SCAN_TOKEN are required.");
  process.exit(2);
}
const response = await fetch(`${apiUrl}/api/internal/alert-scan${process.argv.includes("--force") ? "?force=1" : ""}`, { method: "POST", headers: { "x-alert-scan-token": token } });
const body = await response.text();
console.log(body);
if (!response.ok) process.exit(1);
