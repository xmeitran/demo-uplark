export const ADMIN_SECTIONS = [
  "overview",
  "alerts",
  "parameters",
  "day-offs",
  "reminders",
  "approval",
  "pnl-config",
  "history"
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function adminSectionFromHash(hash: string): AdminSection {
  const section = hash.replace(/^#/, "");
  return ADMIN_SECTIONS.includes(section as AdminSection) ? section as AdminSection : "overview";
}
