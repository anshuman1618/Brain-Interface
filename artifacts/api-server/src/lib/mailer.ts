import { createConnection, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { eq } from "drizzle-orm";
import { db, mailOutboxTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Outbound email.
 *
 * Every message is written to `mail_outbox` before a transport is touched and
 * updated with the outcome afterwards. That ordering is the point: a deadline
 * reminder that failed to send is visible in the outbox instead of vanishing
 * into a log line nobody reads.
 *
 * Two transports:
 *   smtp — used when SMTP_HOST is configured.
 *   log  — otherwise. The message is recorded and logged, not silently dropped,
 *          and its status is `suppressed` so nobody mistakes it for delivered.
 *
 * The SMTP client below is deliberately small — AUTH LOGIN over an implicit or
 * STARTTLS connection, which is what every mainstream provider accepts. It is
 * not a general-purpose mail library, and it does not pretend to be: no
 * attachments, no queueing, no retry backoff beyond the attempt counter.
 */

export type MailKind = "reminder" | "invite" | "document_request" | "erasure" | "notice";

export type Mail = {
  to: string;
  subject: string;
  body: string;
  kind?: MailKind;
  workspaceId?: number | null;
};

type SmtpConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure: boolean;
};

function smtpConfig(): SmtpConfig | null {
  const host = process.env["SMTP_HOST"]?.trim();
  if (!host) return null;
  const port = Number(process.env["SMTP_PORT"]) || 587;
  return {
    host,
    port,
    user: process.env["SMTP_USER"]?.trim(),
    pass: process.env["SMTP_PASS"],
    from: process.env["MAIL_FROM"]?.trim() || "no-reply@lexpractice.local",
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
  };
}

export function mailTransportName(): "smtp" | "log" {
  return smtpConfig() ? "smtp" : "log";
}

/** Headers are line-oriented; a newline in one is a header-injection bug. */
function headerSafe(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim();
}

function readUntil(sock: Socket | TLSSocket, expect: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      // Multi-line replies use "250-" for all but the final line.
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || /^\d{3}-/.test(last)) return;
      cleanup();
      const code = Number(last.slice(0, 3));
      if (code !== expect) reject(new Error(`SMTP expected ${expect}, got: ${last}`));
      else resolve(buf);
    };
    const onErr = (e: Error) => {
      cleanup();
      reject(e);
    };
    const cleanup = () => {
      sock.off("data", onData);
      sock.off("error", onErr);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP timeout"));
    }, 15_000);
    sock.on("data", onData);
    sock.on("error", onErr);
  });
}

async function sendSmtp(cfg: SmtpConfig, mail: Mail): Promise<void> {
  const say = async (sock: Socket | TLSSocket, line: string, expect: number) => {
    sock.write(line + "\r\n");
    await readUntil(sock, expect);
  };

  let sock: Socket | TLSSocket = cfg.secure
    ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : createConnection({ host: cfg.host, port: cfg.port });

  await new Promise<void>((res, rej) => {
    sock.once(cfg.secure ? "secureConnect" : "connect", () => res());
    sock.once("error", rej);
  });

  try {
    await readUntil(sock, 220);
    await say(sock, `EHLO lexpractice`, 250);

    if (!cfg.secure) {
      // Credentials and client material never travel in the clear.
      await say(sock, "STARTTLS", 220);
      const plain = sock as Socket;
      sock = tlsConnect({ socket: plain, servername: cfg.host });
      await new Promise<void>((res, rej) => {
        sock.once("secureConnect", () => res());
        sock.once("error", rej);
      });
      await say(sock, `EHLO lexpractice`, 250);
    }

    if (cfg.user && cfg.pass) {
      await say(sock, "AUTH LOGIN", 334);
      await say(sock, Buffer.from(cfg.user).toString("base64"), 334);
      await say(sock, Buffer.from(cfg.pass).toString("base64"), 235);
    }

    await say(sock, `MAIL FROM:<${headerSafe(cfg.from)}>`, 250);
    await say(sock, `RCPT TO:<${headerSafe(mail.to)}>`, 250);
    await say(sock, "DATA", 354);

    const body = mail.body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    sock.write(
      [
        `From: ${headerSafe(cfg.from)}`,
        `To: ${headerSafe(mail.to)}`,
        `Subject: ${headerSafe(mail.subject)}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        body,
        ".",
        "",
      ].join("\r\n"),
    );
    await readUntil(sock, 250);
    await say(sock, "QUIT", 221);
  } finally {
    sock.end();
    sock.destroy();
  }
}

/**
 * Record the message, then try to deliver it.
 *
 * Never throws: a chamber must not be blocked from inviting a colleague
 * because a mail server is unreachable. The outbox row carries the failure.
 */
export async function sendMail(mail: Mail): Promise<{ id: number; status: string }> {
  const cfg = smtpConfig();
  const transport = cfg ? "smtp" : "log";

  const [row] = await db
    .insert(mailOutboxTable)
    .values({
      workspaceId: mail.workspaceId ?? null,
      toEmail: mail.to,
      subject: mail.subject,
      body: mail.body,
      kind: mail.kind ?? "notice",
      status: "queued",
      transport,
      attempts: 1,
    })
    .returning();

  const id = row!.id;

  if (!cfg) {
    // Nothing configured. Suppressed, not sent — and it says so.
    logger.warn(
      { to: mail.to, subject: mail.subject, kind: mail.kind },
      "No SMTP transport configured — message recorded in the outbox but not delivered",
    );
    await db
      .update(mailOutboxTable)
      .set({ status: "suppressed", error: "SMTP_HOST is not configured" })
      .where(eq(mailOutboxTable.id, id));
    return { id, status: "suppressed" };
  }

  try {
    await sendSmtp(cfg, mail);
    await db
      .update(mailOutboxTable)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(mailOutboxTable.id, id));
    return { id, status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: mail.to }, "Mail delivery failed");
    await db
      .update(mailOutboxTable)
      .set({ status: "failed", error: message.slice(0, 500) })
      .where(eq(mailOutboxTable.id, id));
    return { id, status: "failed" };
  }
}
