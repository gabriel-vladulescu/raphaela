import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { RETENTION_MONTHS, SUSPENDED_NOW } from '@/lib/accounts';
import { parseId, requireOwner } from '@/lib/guards';
import { notifySupport } from '@/lib/notifications';

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

/**
 * Support: the contact form (anyone, signed in or not), kept in the database with its attachments, which never
 * become public files; administrators get a notification, and read the tickets here. No replies yet.
 */
const supportRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

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
      `INSERT INTO support_tickets (user_id, visitor_id, name, email, category, title, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
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

  // ---- Administrators: the tickets, newest first.
  app.get<{ Querystring: { offset: number; limit: number } }>(
    '/admin/support',
    {
      preHandler: requireOwner,
      schema: {
        querystring: {
          type: 'object',
          properties: { offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        },
      },
    },
    async (req) => {
      const { offset, limit } = req.query;
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT t.id, t.name, t.email, t.category, t.title, t.body, t.created_at, t.seen_at,
                (SELECT COUNT(*) FROM support_attachments a WHERE a.ticket_id = t.id) AS files
           FROM support_tickets t
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT ? OFFSET ?`,
        [limit + 1, offset],
      );
      const [[unseen]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM support_tickets WHERE seen_at IS NULL');
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
        })),
        hasMore: rows.length > limit,
        unseen: Number(unseen!.n),
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
    const [files] = await db.execute<RowDataPacket[]>('SELECT id, file_name, mime, size FROM support_attachments WHERE ticket_id = ? ORDER BY id', [row.id]);
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
        files: files.map((file) => ({ id: file.id as number, name: file.file_name as string, mime: file.mime as string, size: file.size as number })),
      },
    };
  });

  // An attachment: pictures and PDFs open in the browser, anything else downloads; nothing runs from it.
  app.get<{ Params: { id: string; fileId: string } }>('/admin/support/:id/files/:fileId', { preHandler: requireOwner }, async (req, reply) => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT file_name, mime, data FROM support_attachments WHERE id = ? AND ticket_id = ?', [
      parseId(req.params.fileId) ?? 0,
      parseId(req.params.id) ?? 0,
    ]);
    const file = rows[0];
    if (!file) return reply.code(404).send({ error: 'not_found' });
    const mime = file.mime as string;
    const inline = mime.startsWith('image/') || mime === 'application/pdf';
    reply
      .type(mime === 'text/plain' ? 'text/plain; charset=utf-8' : mime)
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.file_name as string)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('Cache-Control', 'private, max-age=3600');
    return reply.send(file.data as Buffer);
  });
};

export default supportRoutes;
