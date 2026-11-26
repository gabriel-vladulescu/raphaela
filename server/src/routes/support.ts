import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { FastifyReply } from 'fastify';
import { RETENTION_MONTHS, SUSPENDED_NOW } from '@/lib/accounts';
import { logAdmin } from '@/lib/adminLog';
import { langOf, siteLink, supportReplyEmail } from '@/lib/emails';
import { parseId, requireOwner, requireUser } from '@/lib/guards';
import { mailConfigured, sendMail } from '@/lib/mail';
import { notifySupport, notifySupportReply } from '@/lib/notifications';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CATEGORIES = ['account', 'content', 'technical', 'other'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The kinds of attachment accepted, and how each one's content starts (what the browser says isn't trusted). */
const FILE_TYPES: Record<string, (data: Buffer) => boolean> = {
  'image/jpeg': (d) => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff,
  'image/png': (d) => d.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/gif': (d) => d.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (d) => d.subarray(0, 4).toString('latin1') === 'RIFF' && d.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (d) => d.subarray(0, 5).toString('latin1') === '%PDF-',
  'text/plain': (d) => !d.includes(0),
};

interface Attachment {
  fileName: string;
  mime: string;
  data: Buffer;
}

const STATUSES = ['open', 'answered', 'closed'] as const;
type Status = (typeof STATUSES)[number];
const replySchema = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: { body: { type: 'string', minLength: 1, maxLength: 5000 }, lang: { type: 'string', enum: ['ro', 'en'] } },
} as const;

/** An attachment, as sent to whoever may see it: pictures and PDFs open in the browser, anything else downloads. */
function sendFile(reply: FastifyReply, file: RowDataPacket) {
  const mime = file.mime as string;
  const inline = mime.startsWith('image/') || mime === 'application/pdf';
  reply
    .type(mime === 'text/plain' ? 'text/plain; charset=utf-8' : mime)
    .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.file_name as string)}`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    .header('Cache-Control', 'private, max-age=3600');
  return reply.send(file.data as Buffer);
}

/**
 * Support: the contact form (anyone, signed in or not), kept in the database with its attachments, which never
 * become public files; administrators get a notification. A ticket is a conversation: an administrator answers
 * from the admin panel (only with a way to send email: the answer always goes by email), and when it was sent
 * signed in, the answer is in the person's account too (/suport/tichete/{id}, with a notification), where they answer
 * back. Its state: open (waiting for an answer), answered, closed (an administrator's; answering opens it again).
 */
const supportRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  /** A ticket's replies, oldest first. */
  async function repliesOf(ticketId: number) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.id, r.author_id, r.author_name, r.staff, r.body, r.created_at, r.emailed, COALESCE(u.avatar_url, u.picture) AS picture
         FROM support_replies r LEFT JOIN users u ON u.id = r.author_id WHERE r.ticket_id = ? ORDER BY r.created_at, r.id`,
      [ticketId],
    );
    return rows.map((row) => ({
      id: row.id as number,
      /** An administrator's (else the sender's own). */
      staff: Boolean(row.staff),
      author: { id: (row.author_id as number | null) ?? null, name: row.author_name as string, picture: row.picture as string | null },
      body: row.body as string,
      createdAt: row.created_at as Date,
      emailed: Boolean(row.emailed),
    }));
  }

  async function filesOf(ticketId: number) {
    const [files] = await db.execute<RowDataPacket[]>('SELECT id, file_name, mime, size FROM support_attachments WHERE ticket_id = ? ORDER BY id', [ticketId]);
    return files.map((file) => ({ id: file.id as number, name: file.file_name as string, mime: file.mime as string, size: file.size as number }));
  }

  app.post('/support', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const fields: Record<string, string> = {};
    const files: Attachment[] = [];
    for await (const part of req.parts({ limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 10, fieldSize: 10_000 } })) {
      if (part.type === 'file') {
        const data = await part.toBuffer(); // past the size limit: a 413 (file_too_large)
        if (data.length === 0) continue;
        const check = FILE_TYPES[part.mimetype];
        if (!check || !check(data)) return reply.code(400).send({ error: 'support_file_type' });
        files.push({ fileName: part.filename.slice(0, 255) || 'fisier', mime: part.mimetype, data });
      } else {
        fields[part.fieldname] = String(part.value ?? '').trim();
      }
    }

    // A field people can't see: filled in, it's a robot. It's told all went well, and nothing is kept.
    if (fields.website) return { ok: true };

    const email = (fields.email ?? '').toLowerCase();
    const title = fields.title ?? '';
    const body = fields.body ?? '';
    const name = (fields.name ?? '').slice(0, 100) || null;
    const category = CATEGORIES.find((c) => c === fields.category) ?? 'other';
    if (!EMAIL.test(email) || email.length > 190) return reply.code(400).send({ error: 'support_email' });
    if (title.length < 3 || title.length > 160) return reply.code(400).send({ error: 'support_title' });
    if (body.length < 10 || body.length > 5000) return reply.code(400).send({ error: 'support_body' });

    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO support_tickets (user_id, visitor_id, name, email, category, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [req.user?.id ?? null, req.visitor.id, name, email, category, title, body],
    );
    const id = result.insertId;
    for (const file of files) {
      await db.execute('INSERT INTO support_attachments (ticket_id, file_name, mime, size, data) VALUES (?, ?, ?, ?, ?)', [
        id,
        file.fileName,
        file.mime,
        file.data.length,
        file.data,
      ]);
    }
    void notifySupport(db, { id, title, email, userId: req.user?.id ?? null });
    return { ok: true, id };
  });

  // ---- Administrators: the tickets, the latest activity first; by state.
  app.get<{ Querystring: { status?: Status; offset: number; limit: number } }>(
    '/admin/support',
    {
      preHandler: requireOwner,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: STATUSES },
            offset: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
      },
    },
    async (req) => {
      const { status, offset, limit } = req.query;
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT t.id, t.name, t.email, t.category, t.title, t.body, t.status, t.user_id, t.created_at, t.updated_at, t.seen_at,
                (SELECT COUNT(*) FROM support_attachments a WHERE a.ticket_id = t.id) AS files,
                (SELECT COUNT(*) FROM support_replies r WHERE r.ticket_id = t.id) AS replies
           FROM support_tickets t
          ${status ? 'WHERE t.status = ?' : ''}
          ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.id DESC
          LIMIT ? OFFSET ?`,
        [...(status ? [status] : []), limit + 1, offset],
      );
      const [[unseen]] = await db.query<RowDataPacket[]>(
        `SELECT SUM(seen_at IS NULL) AS n, COUNT(*) AS total, SUM(status = 'open') AS open, SUM(status = 'answered') AS answered, SUM(status = 'closed') AS closed
           FROM support_tickets`,
      );
      return {
        tickets: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          name: row.name as string | null,
          email: row.email as string,
          category: row.category as string,
          title: row.title as string,
          preview: String(row.body).slice(0, 160),
          createdAt: row.created_at as Date,
          seen: row.seen_at !== null,
          files: Number(row.files),
          status: row.status as Status,
          replies: Number(row.replies),
          /** Sent signed in: the answers reach their account too. */
          account: row.user_id !== null,
          updatedAt: (row.updated_at as Date | null) ?? (row.created_at as Date),
        })),
        hasMore: rows.length > limit,
        unseen: Number(unseen!.n ?? 0),
        counts: {
          all: Number(unseen!.total ?? 0),
          open: Number(unseen!.open ?? 0),
          answered: Number(unseen!.answered ?? 0),
          closed: Number(unseen!.closed ?? 0),
        },
      };
    },
  );

  // One ticket, with its attachments' details; opening it marks it seen (and its notification read).
  app.get<{ Params: { id: string } }>('/admin/support/:id', { preHandler: requireOwner }, async (req, reply) => {
    const id = parseId(req.params.id);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*, u.name AS user_name, u.role AS user_role FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      [id ?? 0],
    );
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await db.execute('UPDATE support_tickets SET seen_at = UTC_TIMESTAMP() WHERE id = ? AND seen_at IS NULL', [row.id]);
    await db.execute('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE ticket_id = ? AND user_id = ? AND read_at IS NULL', [row.id, req.user!.id]);
    // The account with the sender's address, when it isn't the one that sent it (someone whose account was deleted or
    // suspended writes signed out): to find it, and restore it, from the ticket.
    const [byEmail] = await db.execute<RowDataPacket[]>(
      `SELECT u.id, u.name, u.role, u.deleted_at, DATE_ADD(u.deleted_at, INTERVAL ${RETENTION_MONTHS} MONTH) AS purge_on, ${SUSPENDED_NOW} AS suspended
         FROM users u WHERE u.email = ? AND u.purged_at IS NULL`,
      [row.email],
    );
    const match = byEmail[0];
    return {
      ticket: {
        id: row.id as number,
        name: row.name as string | null,
        email: row.email as string,
        category: row.category as string,
        title: row.title as string,
        body: row.body as string,
        createdAt: row.created_at as Date,
        user: row.user_id ? { id: row.user_id as number, name: row.user_name as string, role: row.user_role as string } : null,
        /** The account with the sender's address (deleted, suspended or not), whoever sent it. */
        account: match
          ? {
              id: match.id as number,
              name: match.name as string,
              role: match.role as string,
              deletedAt: match.deleted_at as Date | null,
              purgeOn: match.purge_on as Date | null,
              suspended: Boolean(Number(match.suspended)),
            }
          : null,
        files: await filesOf(row.id as number),
        status: row.status as Status,
        replies: await repliesOf(row.id as number),
      },
      /** Answering needs an SMTP server, in development too (the answer always goes by email, never only to the console). */
      mail: mailConfigured(),
    };
  });

  // An administrator's answer: by email to the sender's address, and in their account when they sent it signed in
  // (with a notification). Not without an SMTP server, in development too. The ticket is answered.
  app.post<{ Params: { id: string }; Body: { body: string; lang?: string } }>(
    '/admin/support/:id/replies',
    { preHandler: requireOwner, schema: { body: replySchema } },
    async (req, reply) => {
      const body = req.body.body.trim();
      if (body.length < 2) return reply.code(400).send({ error: 'support_body' });
      if (!mailConfigured()) return reply.code(503).send({ error: 'email_unavailable' });
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT t.id, t.title, t.email, t.user_id, u.deleted_at IS NULL AND u.id IS NOT NULL AS account_active
           FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
        [parseId(req.params.id) ?? 0],
      );
      const ticket = rows[0];
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const id = ticket.id as number;
      const inApp = Boolean(Number(ticket.account_active));
      const [result] = await db.execute<ResultSetHeader>(
        'INSERT INTO support_replies (ticket_id, author_id, author_name, staff, body, created_at) VALUES (?, ?, ?, 1, ?, UTC_TIMESTAMP())',
        [id, req.user!.id, req.user!.name.slice(0, 80), body],
      );
      await db.execute("UPDATE support_tickets SET status = 'answered', updated_at = UTC_TIMESTAMP(), seen_at = COALESCE(seen_at, UTC_TIMESTAMP()) WHERE id = ?", [id]);
      const emailed = await sendMail(
        supportReplyEmail(ticket.email as string, langOf(req.body.lang), { title: ticket.title as string, body, url: inApp ? siteLink(`/suport/tichete/${id}`) : null }),
      );
      if (emailed) await db.execute('UPDATE support_replies SET emailed = 1 WHERE id = ?', [result.insertId]);
      if (inApp) await notifySupportReply(db, { ticketId: id, userId: ticket.user_id as number, title: ticket.title as string, excerpt: body, actorId: req.user!.id });
      void logAdmin(db, req.user!, 'support.reply', { type: 'support', id, label: ticket.title as string }, { to: ticket.email, inApp, emailed });
      return { replies: await repliesOf(id), status: 'answered', emailed, inApp };
    },
  );

  // Closed (nothing more to do), or open again.
  app.post<{ Params: { id: string }; Body: { status: 'open' | 'closed' } }>(
    '/admin/support/:id/status',
    {
      preHandler: requireOwner,
      schema: { body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: ['open', 'closed'] } } } },
    },
    async (req, reply) => {
      const id = parseId(req.params.id) ?? 0;
      const [rows] = await db.execute<RowDataPacket[]>('SELECT id, title, status FROM support_tickets WHERE id = ?', [id]);
      if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
      if (rows[0].status !== req.body.status) {
        await db.execute('UPDATE support_tickets SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [req.body.status, id]);
        void logAdmin(db, req.user!, req.body.status === 'closed' ? 'support.close' : 'support.reopen', { type: 'support', id, label: rows[0].title as string });
      }
      return { status: req.body.status };
    },
  );

  // ---- The person who sent tickets signed in: theirs, each a conversation, answered from here.

  app.get('/support/tickets', { preHandler: requireUser }, async (req) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.id, t.title, t.category, t.status, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM support_replies r WHERE r.ticket_id = t.id AND r.staff = 1) AS answers,
              (SELECT COUNT(*) FROM notifications n WHERE n.ticket_id = t.id AND n.user_id = t.user_id AND n.type = 'support_reply' AND n.read_at IS NULL) AS unread
         FROM support_tickets t WHERE t.user_id = ? ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.id DESC LIMIT 100`,
      [req.user!.id],
    );
    return {
      tickets: rows.map((row) => ({
        id: row.id as number,
        title: row.title as string,
        category: row.category as string,
        status: row.status as Status,
        createdAt: row.created_at as Date,
        updatedAt: (row.updated_at as Date | null) ?? (row.created_at as Date),
        answers: Number(row.answers),
        /** Answers not read yet. */
        unread: Number(row.unread),
      })),
    };
  });

  /** One of the signed-in person's tickets, or null. */
  async function ownTicket(userId: number, id: string) {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?', [parseId(id) ?? 0, userId]);
    return rows[0] ?? null;
  }

  // Opening it reads its answers (their notifications).
  app.get<{ Params: { id: string } }>('/support/tickets/:id', { preHandler: requireUser }, async (req, reply) => {
    const row = await ownTicket(req.user!.id, req.params.id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await db.execute("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE ticket_id = ? AND user_id = ? AND type = 'support_reply' AND read_at IS NULL", [
      row.id,
      req.user!.id,
    ]);
    return {
      ticket: {
        id: row.id as number,
        title: row.title as string,
        category: row.category as string,
        body: row.body as string,
        email: row.email as string,
        status: row.status as Status,
        createdAt: row.created_at as Date,
        files: await filesOf(row.id as number),
        replies: await repliesOf(row.id as number),
      },
    };
  });

  app.get<{ Params: { id: string; fileId: string } }>('/support/tickets/:id/files/:fileId', { preHandler: requireUser }, async (req, reply) => {
    const ticket = await ownTicket(req.user!.id, req.params.id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    const [rows] = await db.execute<RowDataPacket[]>('SELECT file_name, mime, data FROM support_attachments WHERE id = ? AND ticket_id = ?', [
      parseId(req.params.fileId) ?? 0,
      ticket.id,
    ]);
    return rows[0] ? sendFile(reply, rows[0]) : reply.code(404).send({ error: 'not_found' });
  });

  // Their answer: the ticket is open again (waiting for an administrator), who hears about it.
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    '/support/tickets/:id/replies',
    { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }, schema: { body: replySchema } },
    async (req, reply) => {
      const ticket = await ownTicket(req.user!.id, req.params.id);
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const body = req.body.body.trim();
      if (body.length < 2) return reply.code(400).send({ error: 'support_body' });
      await db.execute('INSERT INTO support_replies (ticket_id, author_id, author_name, staff, body, created_at) VALUES (?, ?, ?, 0, ?, UTC_TIMESTAMP())', [
        ticket.id,
        req.user!.id,
        req.user!.name.slice(0, 80),
        body,
      ]);
      await db.execute("UPDATE support_tickets SET status = 'open', updated_at = UTC_TIMESTAMP(), seen_at = NULL WHERE id = ?", [ticket.id]);
      void notifySupport(db, { id: ticket.id as number, title: ticket.title as string, email: ticket.email as string, userId: req.user!.id, answer: body });
      return { replies: await repliesOf(ticket.id as number), status: 'open' };
    },
  );

  // An attachment: pictures and PDFs open in the browser, anything else downloads; nothing runs from it.
  app.get<{ Params: { id: string; fileId: string } }>('/admin/support/:id/files/:fileId', { preHandler: requireOwner }, async (req, reply) => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT file_name, mime, data FROM support_attachments WHERE id = ? AND ticket_id = ?', [
      parseId(req.params.fileId) ?? 0,
      parseId(req.params.id) ?? 0,
    ]);
    return rows[0] ? sendFile(reply, rows[0]) : reply.code(404).send({ error: 'not_found' });
  });
};

export default supportRoutes;
