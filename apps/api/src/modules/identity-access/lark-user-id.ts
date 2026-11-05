import type { Prisma } from "@prisma/client";

/**
 * The identity holding a Lark user ID ("HN454"), whether typed in Tổ chức in another case or sent by Lark at sign-in.
 * Compared on exact spellings only: Prisma's case-insensitive `equals` becomes an unescaped ILIKE, where "_" or "%" in an
 * ID would match other people's IDs. The exact spelling wins over another case.
 */
export async function findLarkUserIdIdentity(client: Pick<Prisma.TransactionClient, "portalIdentity">, larkUserId: string, tenantKey: string) {
  const spellings = [...new Set([larkUserId, larkUserId.toUpperCase(), larkUserId.toLowerCase()])];
  const rows = await client.portalIdentity.findMany({ where: { provider: "lark_user_id", tenantKey, providerUserId: { in: spellings } }, include: { user: true } });
  return rows.find((row) => row.providerUserId === larkUserId) ?? rows[0];
}
