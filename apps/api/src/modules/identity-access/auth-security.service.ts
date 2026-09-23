import { BadRequestException, HttpException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../shared/prisma/prisma.service";

const N = 131072;
let activeHashes = 0;
export function hashAuthToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function randomAuthToken() { return randomBytes(32).toString("base64url"); }
export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || [...password].length < 12 || Buffer.byteLength(password) > 256) {
    throw new BadRequestException("Password must contain at least 12 characters and at most 256 bytes");
  }
}
async function derive(password: string, salt: Buffer) {
  if (activeHashes >= 2) throw new HttpException("Authentication busy; retry shortly", 429);
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64,
      { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { activeHashes--; }
}
export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = randomBytes(16);
  return `scrypt$${N}$8$1$${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: unknown, encoded?: string | null) {
  if (typeof password !== "string" || Buffer.byteLength(password) > 256) return false;
  const match = encoded?.match(/^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
  // Do equal-cost work even for unknown identities or unconfigured credentials.
  const salt = Buffer.from(match?.[1] ?? "00".repeat(16), "hex");
  const actual = await derive(password, salt);
  const expected = Buffer.from(match?.[2] ?? "00".repeat(64), "hex");
  return timingSafeEqual(actual, expected) && !!match;
}
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = randomBytes(20); let result = "", bits = 0, value = 0;
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  return result;
}
function decodeBase32(value: string) {
  let bits = 0, accumulator = 0; const result: number[] = [];
  for (const char of value) { const n = ALPHABET.indexOf(char); if (n < 0) throw new Error("Invalid MFA secret"); accumulator = (accumulator << 5) | n; bits += 5; if (bits >= 8) { result.push((accumulator >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(result);
}
export function totpAt(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
export function matchingTotpStep(secret: string, code: unknown, now = Date.now()): number | null {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code))) return step;
  return null;
}
@Injectable()
export class AuthSecurityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private key() {
    const value = process.env.CRM_AUTH_ENCRYPTION_KEY;
    if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new ServiceUnavailableException("MFA encryption key is not configured");
    return Buffer.from(value, "hex");
  }
  encrypt(secret: string, userId: string) {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(userId)); const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64url")).join(".");
  }
  decrypt(encrypted: string, userId: string) {
    const [iv, tag, ciphertext] = encrypted.split(".").map(s => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", this.key(), iv); decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
  async limit(scope: string, subject: string, maximum = 10, windowMs = 900000) {
    const now = Date.now(); const bucket = Math.floor(now / windowMs);
    const key = `${scope}:${bucket}:${hashAuthToken(subject)}`;
    const row = await this.prisma.authRateLimit.upsert({ where: { key }, create: { key, attempts: 1, expiresAt: new Date((bucket + 1) * windowMs) }, update: { attempts: { increment: 1 } } });
    if (row.attempts > maximum) throw new HttpException("Too many attempts; try again later", 429);
    if (Math.random() < 0.01) await this.prisma.authRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now - windowMs) } } });
  }
}
