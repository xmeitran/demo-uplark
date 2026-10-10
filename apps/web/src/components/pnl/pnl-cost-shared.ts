export const moneyFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
export const hoursFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

export const inputClass = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";
export const labelClass = "mb-1.5 block text-xs font-semibold text-muted-foreground";
export const primaryButton = "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton = "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const thClass = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/** Digits typed by the user → number of đồng. Empty input is "no value", not zero. */
export function parseMoneyInput(value: string): number | undefined {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : undefined;
}

export function formatMoneyInput(value: string) {
  const amount = parseMoneyInput(value);
  return amount === undefined ? "" : moneyFormat.format(amount);
}

/**
 * The number a parameter text stands for. MIRROR of parseParameterValue in
 * apps/api/src/modules/resource-controls/pnl-calc.ts — the API's reading is the one that
 * counts; this copy only shows "Hệ thống hiểu là…" while typing. Both specs run the same
 * table of cases: change the two functions together.
 *
 *  - "%" divides by 100 ("5%" → 0.05).
 *  - Both "." and ",": the one written last is the decimal mark ("1.250,5", "1,250.5" → 1250.5).
 *  - One kind, several times: thousands ("1.250.000" → 1250000).
 *  - One separator: a decimal mark, EXCEPT a non-zero 1–3 digit integer part followed by
 *    exactly three digits ("26.300", "1,250"), read as thousands. "0.125" is always 0.125.
 */
export function readParameterValue(raw: string): number | undefined {
  const text = raw.trim();
  const match = /-?\d[\d.,]*/.exec(text);
  if (!match) return undefined;
  const negative = match[0].startsWith("-");
  const body = match[0].replace(/^-/, "").replace(/[.,]+$/, "");
  const dots = body.split(".").length - 1;
  const commas = body.split(",").length - 1;
  let digits: string;
  if (dots && commas) {
    const decimal = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    if ((decimal === "." ? dots : commas) !== 1) return undefined;
    digits = body.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (dots + commas > 1) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(body)) return undefined;
    digits = body.replace(/[.,]/g, "");
  } else if (/^0*[1-9]\d{0,2}[.,]\d{3}$/.test(body)) {
    digits = body.replace(/[.,]/, "");
  } else {
    digits = body.replace(",", ".");
  }
  const value = Number(digits);
  if (!Number.isFinite(value)) return undefined;
  const signed = negative ? -value : value;
  return text.includes("%") ? signed / 100 : signed;
}

export function currentPeriodKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

export function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function shiftPeriod(periodKey: string, delta: number) {
  const [year, month] = periodKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodLabel(periodKey: string) {
  return `Tháng ${periodKey.slice(5, 7)}/${periodKey.slice(0, 4)}`;
}

export function monthDateRange(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: `${periodKey}-01`, endDate: `${periodKey}-${String(lastDay).padStart(2, "0")}` };
}

/** Reads an API response, turning 401/403 and API messages into a Vietnamese error. */
export async function readApi<T>(response: Response, fallback: string): Promise<T> {
  if (response.status === 401) {
    window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }
  const payload = await response.json().catch(() => ({})) as { message?: string | string[] };
  if (response.status === 403) throw new Error("Bạn chưa được cấp quyền chi phí. Liên hệ Admin để được cấp quyền P&L.");
  if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join("; ") : payload.message || fallback);
  return payload as T;
}

const nameKey = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Rows copied from a spreadsheet ("Tên <tab> đơn giá", one person per line) → rates by person.
 * Names match ignoring case and diacritics; a name shared by two people is left unmatched
 * rather than guessed.
 */
export function matchPastedRates(text: string, people: ReadonlyArray<{ userId: string; displayName: string }>) {
  const byName = new Map<string, string[]>();
  for (const person of people) byName.set(nameKey(person.displayName), [...(byName.get(nameKey(person.displayName)) ?? []), person.userId]);
  const matched: Record<string, number> = {};
  const unmatched: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/\t|;/).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    // "150000.00" / "150000,5" carry decimals; "150.000" is a thousands separator.
    const amount = parseMoneyInput(cells[cells.length - 1].replace(/[.,]\d{1,2}$/, ""));
    const ids = byName.get(nameKey(cells[0])) ?? [];
    if (amount === undefined) continue; // header or note row
    if (ids.length === 1) matched[ids[0]] = amount; else unmatched.push(cells[0]);
  }
  return { matched, unmatched };
}
