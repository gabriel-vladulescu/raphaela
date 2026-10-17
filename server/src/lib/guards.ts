import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '@/lib/session';
import type { Visitor } from '@/lib/visitor';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    /** Set on every API request (statistics, guest likes). */
    visitor: Visitor;
  }
}

/** Authors and owners write posts. */
export const canWrite = (user: SessionUser | null) => user?.role === 'author' || user?.role === 'owner';

/** Owners edit any post; authors only their own. */
export const canEditPost = (user: SessionUser | null, authorId: number) =>
  user?.role === 'owner' || (user?.role === 'author' && user.id === authorId);

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'auth_required' });
}

export async function requireWriter(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'auth_required' });
  if (!canWrite(req.user)) return reply.code(403).send({ error: 'forbidden' });
}

export async function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'auth_required' });
  if (req.user.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
}

/** Parses a positive integer route param, or returns null. */
export function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
