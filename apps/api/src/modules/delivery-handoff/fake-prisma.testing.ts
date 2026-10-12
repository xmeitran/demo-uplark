/**
 * Test helper: an in-memory stand-in for the few Prisma calls the baseline / change-request / import code makes.
 * Supports equality, `in`, `notIn`, `not`, `lt/lte/gt/gte` in `where`, a single-key `orderBy`, `increment`, and the
 * two `groupBy` shapes used (`_sum.minutes`, `_max.version`). Not a general Prisma fake.
 */
type Row = Record<string, any>;

/** Column defaults of the schema that the code under test relies on. */
const COLUMN_DEFAULTS: Record<string, Row> = {
  projectWarning: { status: "open" },
  projectTask: { archivedAt: null, parentTaskId: null },
  projectContractItem: { status: "active", contractType: null, valueAmount: null, currency: "VND" },
  projectStage: { changeRequestId: null }
};

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Row[]).some((item) => matches(row, item));
    const value = row[key] ?? null;
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return value === cond || (cond instanceof Date && value instanceof Date && +value === +cond);
    if ("in" in cond) return cond.in.includes(value);
    if ("notIn" in cond) return !cond.notIn.includes(value);
    if ("not" in cond) return value !== cond.not;
    if ("gte" in cond) return value >= cond.gte;
    if ("gt" in cond) return value > cond.gt;
    if ("lte" in cond) return value <= cond.lte;
    if ("lt" in cond) return value < cond.lt;
    return true; // relation filters are not modelled
  });
}

function ordered(rows: Row[], orderBy: any): Row[] {
  const [first] = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  if (!first) return rows;
  const [key, direction] = Object.entries(first)[0] as [string, string];
  return [...rows].sort((left, right) => (left[key] > right[key] ? 1 : left[key] < right[key] ? -1 : 0) * (direction === "desc" ? -1 : 1));
}

export function fakePrisma(seed: Record<string, Row[]> = {}) {
  const db: Record<string, Row[]> = {};
  let seq = 0;
  const table = (name: string) => (db[name] ??= [...(seed[name] ?? [])]);
  const model = (name: string) => ({
    findMany: async (args: any = {}) => {
      const rows = ordered(table(name).filter((row) => matches(row, args.where)), args.orderBy);
      // The one relation the code selects: a change-request stage with its evaluation task.
      const tasks = name === "projectStage" ? args.select?.tasks : undefined;
      return tasks ? rows.map((row) => ({ ...row, tasks: table("projectTask").filter((task) => task.stageId === row.id && matches(task, tasks.where)) })) : rows;
    },
    findFirst: async (args: any = {}) => ordered(table(name).filter((row) => matches(row, args.where)), args.orderBy)[0] ?? null,
    count: async (args: any = {}) => table(name).filter((row) => matches(row, args.where)).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...COLUMN_DEFAULTS[name], ...data }; table(name).push(row); return row; },
    createMany: async ({ data }: any) => { for (const item of data) table(name).push({ id: `${name}-${++seq}`, ...item }); return { count: data.length }; },
    update: async ({ where, data }: any) => {
      const row = table(name).find((item) => matches(item, where.projectId_prefix ?? where));
      if (!row) throw new Error(`${name}: row not found`);
      for (const [key, value] of Object.entries<any>(data)) row[key] = value && typeof value === "object" && "increment" in value ? (row[key] ?? 0) + value.increment : value;
      return row;
    },
    updateMany: async ({ where, data }: any) => { const rows = table(name).filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; },
    upsert: async ({ where, create, update }: any) => {
      const row = table(name).find((item) => matches(item, where.projectId_prefix ?? where));
      if (!row) { table(name).push({ ...create }); return { ...create }; }
      for (const [key, value] of Object.entries<any>(update)) row[key] = value && typeof value === "object" && "increment" in value ? (row[key] ?? 0) + value.increment : value;
      return row;
    },
    groupBy: async ({ by, where }: any) => {
      const groups = new Map<string, Row[]>();
      for (const row of table(name).filter((item) => matches(item, where))) groups.set(row[by[0]], [...(groups.get(row[by[0]]) ?? []), row]);
      return [...groups].map(([key, rows]) => ({ [by[0]]: key, _sum: { minutes: rows.reduce((total, row) => total + (row.minutes ?? 0), 0) }, _max: { version: Math.max(...rows.map((row) => row.version ?? 0)) } }));
    }
  });
  const prisma: any = new Proxy({ $transaction: async (run: any) => run(prisma), $queryRaw: async () => [] }, {
    get: (target: any, name: string) => (name in target ? target[name] : (target[name] = model(name)))
  });
  return { prisma, db, table };
}
