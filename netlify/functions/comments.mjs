/* CVMILOPORRAS_SERVER */
/* Comments on feed posts.

   GET  /api/comments?post=<id>        public, published comments only
   POST /api/comments?post=<id>        Bearer customer  { text }
   GET  /api/comments?action=pending   Bearer admin, everything held for review
   POST /api/comments?action=approve   Bearer admin  { post, id }
   POST /api/comments?action=delete    Bearer admin  { post, id }

   Every comment for a post lives in one blob, published and held together,
   each carrying its own status. One source of truth per post: a separate
   queue would be a second copy to keep in step, and the two would drift.

   The public reply never includes an email address. The admin needs to know
   who wrote something; a visitor does not, and the same record serves both
   only because the two shapes are built separately below. */

import { getStore } from '@netlify/blobs';
import { cors, json, isAdmin, resolveSession, sha256Hex } from '../lib/session.mjs';
import { review } from '../lib/moderation.mjs';

const MAX_PER_HOUR = 10;
const MAX_PER_POST = 500;

/* The post id becomes part of a blob key, so it may only be what the admin
   panel actually generates. */
function safeId(value) {
  const s = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

function key(postId) {
  return 'comments:' + postId;
}

/* First name plus an initial. Enough to feel like a person wrote it,
   without publishing a full name someone gave us to buy a t-shirt. */
function displayName(user) {
  const first = String(user.firstName || '').trim();
  const last = String(user.lastName || '').trim();
  return last ? first + ' ' + last.charAt(0).toUpperCase() + '.' : first;
}

function publicView(c) {
  return { id: c.id, name: c.name, text: c.text, createdAt: c.createdAt };
}

/* Comments are cheap to post and expensive to clean up, so the same person
   cannot flood a thread faster than a human would write. */
async function overRate(store, email) {
  const rateKey = 'rate:' + (await sha256Hex(email));
  const now = Date.now();
  const seen = (await store.get(rateKey, { type: 'json', consistency: 'strong' })) || [];
  const recent = seen.filter((t) => now - t < 3600000);
  if (recent.length >= MAX_PER_HOUR) return true;
  recent.push(now);
  await store.setJSON(rateKey, recent);
  return false;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const store = getStore('hvx-social');

  /* ---------- admin: everything waiting for a decision ---------- */
  if (action === 'pending') {
    if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401);
    const listing = await store.list({ prefix: 'comments:' });
    const held = [];
    for (const blob of (listing && listing.blobs) || []) {
      const rows = (await store.get(blob.key, { type: 'json', consistency: 'strong' })) || [];
      rows.forEach((c) => {
        if (c.status === 'held') held.push({ ...c, post: blob.key.slice('comments:'.length) });
      });
    }
    held.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json(held);
  }

  /* ---------- admin: approve or remove one ---------- */
  if (req.method === 'POST' && (action === 'approve' || action === 'delete')) {
    if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401);
    let body;
    try { body = await req.json(); } catch (e) { body = {}; }
    const postId = safeId(body && body.post);
    const commentId = safeId(body && body.id);
    if (!postId || !commentId) return json({ error: 'post and id are required' }, 400);

    const rows = (await store.get(key(postId), { type: 'json', consistency: 'strong' })) || [];
    const at = rows.findIndex((c) => c && c.id === commentId);
    if (at === -1) return json({ error: 'Comment not found' }, 404);

    if (action === 'delete') {
      rows.splice(at, 1);
    } else {
      rows[at].status = 'published';
      rows[at].approvedAt = new Date().toISOString();
    }
    await store.setJSON(key(postId), rows);
    return json({ ok: true, post: postId, id: commentId, action });
  }

  /* ---------- everything else is about one post ---------- */
  const postId = safeId(url.searchParams.get('post'));
  if (!postId) return json({ error: 'A valid post is required' }, 400);

  if (req.method === 'GET') {
    const rows = (await store.get(key(postId), { type: 'json', consistency: 'strong' })) || [];
    const published = rows.filter((c) => c && c.status === 'published');
    published.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return json({ post: postId, count: published.length, comments: published.map(publicView) });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const found = await resolveSession(req);
  if (!found) return json({ error: 'Sign in to leave a comment' }, 401);

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const text = String((body && body.text) || '').trim();

  const verdict = review(text);
  if (verdict.verdict === 'reject') {
    return json({ error: verdict.reason, verdict: 'reject' }, 422);
  }

  if (await overRate(store, found.user.email)) {
    return json({ error: 'You have posted a lot in the last hour. Try again later.' }, 429);
  }

  const rows = (await store.get(key(postId), { type: 'json', consistency: 'strong' })) || [];
  if (rows.length >= MAX_PER_POST) {
    return json({ error: 'This thread is full.' }, 409);
  }

  const comment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: displayName(found.user),
    email: found.user.email,
    text,
    status: verdict.verdict === 'clean' ? 'published' : 'held',
    reason: verdict.reason || '',
    createdAt: new Date().toISOString(),
  };
  rows.push(comment);
  await store.setJSON(key(postId), rows);

  /* Say plainly what happened. A comment that silently vanishes into a queue
     makes people post it again, and again. */
  return json({
    ok: true,
    status: comment.status,
    comment: comment.status === 'published' ? publicView(comment) : null,
    message: comment.status === 'published'
      ? 'Posted.'
      : 'Thanks. This one is waiting to be checked before it appears.',
  }, 201);
};

export const config = { path: '/api/comments' };
