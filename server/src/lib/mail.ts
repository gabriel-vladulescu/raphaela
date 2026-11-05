import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';
import { site } from '@/lib/siteIdentity';

// Email goes out through an SMTP server that administrators set in the admin panel (Setări → Email); the settings
// are kept in app_settings ('smtp', JSON). In development, with none set, emails are written to the server's log
// instead, so the links in them can still be followed.

/** How the connection is secured: TLS from the start (usually port 465), STARTTLS (587), or none (25, local relays). */
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface SmtpSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
  /** How many emails a day the SMTP server allows (0: not set). Only shown and warned about, never enforced: the
   *  server refuses past its limit anyway, and that shows in the history. */
  dailyLimit: number;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** What it is, for the history (verify, reset, change, deleted, restored, suspended, test, newsletter…). */
  kind: string;
  /** Extra headers (the newsletter's one-click unsubscribe). */
  headers?: Record<string, string>;
}

const EMPTY: SmtpSettings = { host: '', port: 587, security: 'starttls', user: '', password: '', fromEmail: '', fromName: site.name, dailyLimit: 0 };

let settings: SmtpSettings = EMPTY;
let transport: Transporter | null = null;
/** For the history (set by loadMailSettings at startup). */
let pool: Pool | null = null;

/** Keeps a line in the history (email_log): never throws, an email isn't held up by it. */
async function record(mail: Mail, status: 'sent' | 'failed' | 'logged', error: string | null = null) {
  try {
    await pool?.execute('INSERT INTO email_log (created_at, to_email, kind, subject, status, error) VALUES (UTC_TIMESTAMP(), ?, ?, ?, ?, ?)', [
      mail.to.slice(0, 255),
      mail.kind.slice(0, 30),
      mail.subject.slice(0, 255),
      status,
      error ? error.slice(0, 1000) : null,
    ]);
  } catch (err) {
    console.warn('Email history failed:', (err as Error).message);
  }
}

export async function loadMailSettings(db: Pool) {
  pool = db;
  const [rows] = await db.query<RowDataPacket[]>("SELECT value FROM app_settings WHERE name = 'smtp'");
  try {
    settings = rows[0] ? { ...EMPTY, ...(JSON.parse(rows[0].value as string) as Partial<SmtpSettings>) } : EMPTY;
  } catch {
    settings = EMPTY;
  }
  transport = null;
}

export const mailSettings = () => settings;

/** An SMTP server is set. */
export const mailConfigured = () => Boolean(settings.host && settings.fromEmail);

/** Emails can go out: through SMTP, or (development only) into the log. */
export const canSendMail = () => mailConfigured() || !config.production;

export async function saveMailSettings(db: Pool, next: SmtpSettings) {
  await db.query("INSERT INTO app_settings (name, value) VALUES ('smtp', ?) AS new ON DUPLICATE KEY UPDATE value = new.value", [JSON.stringify(next)]);
  settings = next;
  transport = null;
}

function createTransport(s: SmtpSettings) {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    auth: s.user ? { user: s.user, pass: s.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

const fromOf = (s: SmtpSettings) => ({ name: s.fromName || site.name, address: s.fromEmail });

/**
 * Sends an email. False when it can't go out (no SMTP server in production) or the server refused it (logged).
 * Never throws: the action that sends it (signing up, a new password…) still happens.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailConfigured()) {
    if (config.production) {
      await record(mail, 'failed', 'Niciun server SMTP setat');
      return false;
    }
    console.log(`\n✉  Email (no SMTP server set, so it's only shown here)\n   To: ${mail.to}\n   Subject: ${mail.subject}\n\n${mail.text.replace(/^/gm, '   ')}\n`);
    await record(mail, 'logged');
    return true;
  }
  try {
    transport ??= createTransport(settings);
    await transport.sendMail({ from: fromOf(settings), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, headers: mail.headers });
    await record(mail, 'sent');
    return true;
  } catch (err) {
    console.error('Sending an email failed:', err);
    await record(mail, 'failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** A test email with the given settings (they may not be saved yet). Throws the SMTP server's error, to show it. */
export async function sendTestMail(s: SmtpSettings, mail: Mail) {
  const test = createTransport(s);
  try {
    await test.verify();
    await test.sendMail({ from: fromOf(s), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    await record(mail, 'sent');
  } catch (err) {
    await record(mail, 'failed', err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    test.close();
  }
}
