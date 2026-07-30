/* CVMILOPORRAS_SERVER */
/* Shared helpers for the HVX serverless functions.
   Lives outside netlify/functions so it is bundled as a library,
   never deployed as an endpoint of its own. */

import { getStore } from '@netlify/blobs';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function json(body, status) {
  return Response.json(body, {
    status: status || 200,
    headers: { ...cors, 'Cache-Control': 'no-store' },
  });
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('hex');
}

export function bearer(req) {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

/* True when the caller holds the admin token configured in Netlify. */
export function isAdmin(req) {
  const token = bearer(req);
  return Boolean(token && process.env.HVX_ADMIN_TOKEN && token === process.env.HVX_ADMIN_TOKEN);
}

/* Resolves a customer Bearer token to { user, session }, or null. */
export async function resolveSession(req) {
  const token = bearer(req);
  if (!token) return null;
  const store = getStore('hvx-auth');
  const session = await store.get('session:' + (await sha256Hex(token)), { type: 'json' });
  if (!session || !session.email) return null;
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null;
  const user = await store.get('user:' + (await sha256Hex(session.email)), { type: 'json' });
  if (!user) return null;
  return { user, session };
}

/* Strips secrets before a user record is sent to the browser. */
export function publicUser(user) {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    createdAt: user.createdAt,
  };
}
