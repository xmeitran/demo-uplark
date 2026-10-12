/**
 * Test helper: an in-memory database behind the Prisma calls the P&L services make (flat queries only — the loader
 * joins in memory). Supports equality, null, `in`, `notIn`, `not`, `gt/gte/lt/lte` (combined), `OR`, `orderBy`,
 * `take`, and create/createMany/update/updateMany/delete/deleteMany/count/$transaction. `select` is ignored.
 */
type Row = Record<string, any>;

function same(left: unknown, right: unknown) {
  return left instanceof Date && right instanceof Date ? left.getTime() === right.getTime() : left === right;
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Row[]).some((item) => matches(row, item));
    const value = row[key] ?? null;
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return same(value, cond);
    if ("in" in cond && !cond.in.includes(value)) return false;
    if ("notIn" in cond && cond.notIn.includes(value)) return false;
    if ("not" in cond && same(value, cond.not)) return false;
    if ("gte" in cond && !(value !== null && value >= cond.gte)) return false;
    if ("gt" in cond && !(value !== null && value > cond.gt)) return false;
    if ("lte" in cond && !(value !== null && value <= cond.lte)) return false;
    if ("lt" in cond && !(value !== null && value < cond.lt)) return false;
    return true;
  });
}

function ordered(rows: Row[], orderBy: any): Row[] {
  const keys: Array<[string, string]> = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((item: Row) => Object.entries(item)[0] as [string, string]);
  if (!keys.length) return rows;
  return [...rows].sort((left, right) => {
    for (const [key, direction] of keys) {
      const order = left[key] > right[key] ? 1 : left[key] < right[key] ? -1 : 0;
      if (order) return direction === "desc" ? -order : order;
    }
    return 0;
  });
}

export type FakeDb = ReturnType<typeof fakeDb>;

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  let sequence = 0;
  let lastStamp = 0;
  /** Strictly increasing, like rows written one after another: "newest first" never ties inside a test. */
  const stamp = () => new Date((lastStamp = Math.max(Date.now(), lastStamp + 1)));
  const table = (name: string) => (tables[name] ??= (seed[name] ?? []).map((row) => ({ ...row })));
  const find = (name: string, args: any = {}) => ordered(table(name).filter((row) => matches(row, args.where)), args.orderBy);
  const model = (name: string) => ({
    findMany: async (args: any = {}) => { const rows = find(name, args); return args.take ? rows.slice(0, args.take) : rows; },
    findFirst: async (args: any = {}) => find(name, args)[0] ?? null,
    findUnique: async (args: any = {}) => find(name, args)[0] ?? null,
    count: async (args: any = {}) => find(name, args).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++sequence}`, createdAt: stamp(), updatedAt: new Date(), ...data }; table(name).push(row); return row; },
    createMany: async ({ data }: any) => { for (const item of data) table(name).push({ id: `${name}-${++sequence}`, createdAt: stamp(), ...item }); return { count: data.length }; },
    update: async ({ where, data }: any) => {
      const row = table(name).find((item) => matches(item, where));
      if (!row) throw new Error(`${name}: row not found`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: any) => { const rows = table(name).filter((item) => matches(item, where)); for (const row of rows) Object.assign(row, data); return { count: rows.length }; },
    delete: async ({ where }: any) => { const index = table(name).findIndex((item) => matches(item, where)); if (index < 0) throw new Error(`${name}: row not found`); return table(name).splice(index, 1)[0]; },
    deleteMany: async ({ where }: any = {}) => { const keep = table(name).filter((item) => !matches(item, where)); const count = table(name).length - keep.length; tables[name] = keep; return { count }; }
  });
  const models: Record<string, ReturnType<typeof model>> = {};
  const client: any = new Proxy({}, {
    get(_target, property: string) {
      if (property === "$transaction") return async (work: any) => (typeof work === "function" ? work(client) : Promise.all(work));
      if (property === "then") return undefined;
      if (property === "table") return table;
      return (models[property] ??= model(property));
    }
  });
  return client as Record<string, ReturnType<typeof model>> & { table: (name: string) => Row[]; $transaction: (work: any) => Promise<any> };
}
