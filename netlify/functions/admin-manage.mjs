/* CVMILOPORRAS_SERVER */
/* Administrative maintenance for orders and customer accounts.

   GET  /api/admin/manage?action=list-accounts    every registered customer
   POST /api/admin/manage?action=cancel-order     { reference }
   POST /api/admin/manage?action=delete-order     { reference, force? }
   POST /api/admin/manage?action=delete-account   { email }

   Every action needs the admin token. Cancelling keeps the record and only
   changes its status; deleting removes it for good.

   Deleting an account erases the person's credentials and every session
   they hold, then redacts their name and email from past orders instead of
   deleting those orders. The money moved: a revenue total that quietly
   drops because someone asked to be forgotten is an accounting problem,
   not a privacy fix. The purchase survives, the person behind it does not. */

import { getStore } from '@netlify/blobs';
import { cors, json, isAdmin, sha256Hex } from '../lib/session.mjs';

const REDACTED_EMAIL = 'deleted@removed.invalid';

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/* Sessions are keyed by the hash of their own token, so the only way to
   find the ones belonging to an address is to read them. */
async function dropSessions(auth, email) {
  let dropped = 0;
  const listing = await auth.list({ prefix: 'session:' });
  for (const blob of (listing && listing.blobs) || []) {
    const session = await auth.get(blob.key, { type: 'json' });
    if (session && String(session.email).toLowerCase() === email) {
      await auth.delete(blob.key);
      dropped += 1;
    }
  }
  return dropped;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401);

  const action = new URL(req.url).searchParams.get('action');
  const shop = getStore('hvx-shop');
  const auth = getStore('hvx-auth');

  if (req.method === 'GET') {
    if (action !== 'list-accounts') return json({ error: 'Unknown action' }, 400);
    const index = (await auth.get('users-index', { type: 'json', consistency: 'strong' })) || [];
    return json(index);
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  if (action === 'cancel-order' || action === 'delete-order') {
    const reference = clean(body.reference, 40);
    if (!reference) return json({ error: 'Order reference is required' }, 400);

    /* Strong read: this whole list is written back, so a stale copy would
       silently erase any order placed in the last few seconds. */
    const orders = (await shop.get('orders', { type: 'json', consistency: 'strong' })) || [];
    const at = orders.findIndex((o) => o && o.reference === reference);
    if (at === -1) return json({ error: 'Order not found' }, 404);
    const order = orders[at];
    const paid = Boolean(order.payment && order.payment.status === 'paid');

    if (action === 'delete-order') {
      /* Deleting a paid order erases money from the books. Allowed, but
         never by accident: the caller has to ask for it outright. */
      if (paid && body.force !== true) {
        return json({
          error: 'That order is paid. Cancel it instead, or repeat with force to delete it anyway.',
          reference: order.reference,
        }, 409);
      }
      orders.splice(at, 1);
      await shop.setJSON('orders', orders);
      return json({ ok: true, deleted: order.reference });
    }

    if (order.status === 'cancelled') return json({ ok: true, order, already: true });
    order.status = 'cancelled';
    order.cancelledAt = new Date().toISOString();
    await shop.setJSON('orders', orders);
    /* Nothing here moves money. A paid order that is cancelled still has to
       be refunded by hand in Stripe, so say so rather than imply otherwise. */
    return json({ ok: true, order, refundRequired: paid });
  }

  if (action === 'delete-account') {
    const email = clean(body.email, 200).toLowerCase();
    if (!email) return json({ error: 'Email is required' }, 400);

    const userKey = 'user:' + (await sha256Hex(email));
    const user = await auth.get(userKey, { type: 'json', consistency: 'strong' });
    if (user) await auth.delete(userKey);

    const sessionsRevoked = await dropSessions(auth, email);

    const index = (await auth.get('users-index', { type: 'json', consistency: 'strong' })) || [];
    const kept = index.filter((u) => u && String(u.email).toLowerCase() !== email);
    const indexTrimmed = kept.length !== index.length;
    if (indexTrimmed) await auth.setJSON('users-index', kept);

    const orders = (await shop.get('orders', { type: 'json', consistency: 'strong' })) || [];
    let ordersRedacted = 0;
    orders.forEach((o) => {
      if (o && o.customer && String(o.customer.email).toLowerCase() === email) {
        o.customer = { firstName: 'Deleted', lastName: 'Customer', email: REDACTED_EMAIL };
        o.redactedAt = new Date().toISOString();
        ordersRedacted += 1;
      }
    });
    if (ordersRedacted) await shop.setJSON('orders', orders);

    if (!user && !indexTrimmed && !ordersRedacted) {
      return json({ error: 'Nothing found for that email address' }, 404);
    }

    return json({ ok: true, email, accountRemoved: Boolean(user), sessionsRevoked, ordersRedacted });
  }

  return json({ error: 'Unknown action' }, 400);
};

export const config = { path: '/api/admin/manage' };
