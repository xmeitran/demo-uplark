import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import * as nodemailer from "nodemailer";

@Injectable()
export class AuthMailService {
  async sendAction(email: string, purpose: "invitation" | "reset" | "verification", token: string) {
    const origin = process.env.CRM_AUTH_PUBLIC_ORIGIN ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
    let base: URL;
    try { base = new URL(origin); } catch { throw new ServiceUnavailableException("Public authentication origin not configured"); }
    if ((process.env.NODE_ENV === "production" && base.protocol !== "https:") || !["https:", "http:"].includes(base.protocol)) throw new ServiceUnavailableException("Secure public origin required");
    const pathname = purpose === "invitation" ? "/signup" : purpose === "reset" ? "/reset-password" : "/verify-email";
    const link = new URL(pathname, base); link.searchParams.set("token", token);
    const mail = { from: process.env.CRM_AUTH_MAIL_FROM ?? "CRM Local <no-reply@localhost>", to: email, subject: `CRM ${purpose}`, text: `Complete your ${purpose}: ${link.toString()}\nIf you did not request this, ignore this message.` };
    if (process.env.CRM_AUTH_MAIL_MODE === "smtp") {
      if (!process.env.CRM_AUTH_SMTP_URL || !process.env.CRM_AUTH_MAIL_FROM) throw new ServiceUnavailableException("Email delivery is not configured");
      const smtp = new URL(process.env.CRM_AUTH_SMTP_URL);
      if (!["smtp:", "smtps:"].includes(smtp.protocol)) throw new ServiceUnavailableException("Invalid SMTP transport");
      const transport = nodemailer.createTransport({
        host: smtp.hostname, port: Number(smtp.port || (smtp.protocol === "smtps:" ? 465 : 587)),
        secure: smtp.protocol === "smtps:", requireTLS: true, tls: { minVersion: "TLSv1.2" },
        auth: smtp.username ? { user: decodeURIComponent(smtp.username), pass: decodeURIComponent(smtp.password) } : undefined,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        disableFileAccess: true, disableUrlAccess: true
      });
      try { await transport.sendMail(mail); } finally { transport.close(); }
      return "smtp" as const;
    }
    if (process.env.NODE_ENV === "production" || process.env.CRM_AUTH_MAIL_MODE !== "spool") throw new ServiceUnavailableException("Email delivery is not configured");
    const directory = resolve(process.env.CRM_AUTH_MAIL_SPOOL ?? resolve(homedir(), ".local/share/b2b-crm-local/mail"));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(mail, null, 2), { mode: 0o600, flag: "wx" });
    return "spool" as const;
  }
}
