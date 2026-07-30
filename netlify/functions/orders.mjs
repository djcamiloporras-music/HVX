/* CVMILOPORRAS_SERVER */
/* Order intake for the HVX store.

   POST /api/orders            (Bearer customer token)  creates an order
   GET  /api/orders?mine=1     (Bearer customer token)  the caller's orders
   GET  /api/orders            (Bearer admin token)     every order

   Prices and availability are re-read from the merch catalog on the server,
   so a tampered cart cannot change what an order costs. Orders are created
   unpaid; payment is settled separately (see payments-plaid.mjs). */

import { getStore } from '@netlify/blobs';
import { cors, json, resolveSession, isAdmin } from '../lib/session.mjs';

const MAX_QTY = 20;
const MAX_LINES = 30;

function reference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
  return 'HVX-' + stamp + rand;
}

function money(value) {
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const store = getStore('hvx-shop');

  if (req.method === 'GET') {
    const mine = new URL(req.url).searchParams.get('mine');
    const orders = (await store.get('orders', { type: 'json' })) || [];

    if (mine) {
      const found = await resolveSession(req);
      if (!found) return json({ error: 'Not authenticated' }, 401);
      return json(orders.filter((o) => o.customer && o.customer.email === found.user.email));
    }

    if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401);
    return json(orders);
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const found = await resolveSession(req);
  if (!found) return json({ error: 'You must be signed in to place an order' }, 401);

  let body;
  try { body = await req.json(); } catch (e) { body = null; }
  const requested = body && Array.isArray(body.items) ? body.items : null;
  if (!requested || !requested.length) return json({ error: 'Cart is empty' }, 400);
  if (requested.length > MAX_LINES) return json({ error: 'Too many items' }, 400);

  /* Authoritative catalog: the same blob the admin panel publishes. */
  const catalog = (await getStore('hvx-data').get('merch', { type: 'json' })) || [];

  const items = [];
  for (const line of requested) {
    const product = catalog.find((p) => p && p.id === (line && line.id));
    if (!product) return json({ error: 'Product no longer available' }, 409);

    const status = product.status || 'available';
    if (status !== 'available' && status !== 'preorder') {
      return json({ error: '"' + product.name + '" is not available for purchase' }, 409);
    }

    const qty = Math.min(MAX_QTY, Math.max(1, parseInt(line.qty, 10) || 1));
    const price = money(product.price);
    items.push({
      id: product.id,
      name: product.name,
      price,
      qty,
      lineTotal: Math.round(price * qty * 100) / 100,
      type: status === 'preorder' ? 'preorder' : 'stock',
      releaseDate: product.releaseDate || null,
    });
  }

  const total = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  const kinds = new Set(items.map((i) => i.type));

  const order = {
    id: Date.now(),
    reference: reference(),
    customer: {
      firstName: found.user.firstName,
      lastName: found.user.lastName,
      email: found.user.email,
    },
    items,
    total,
    currency: 'USD',
    fulfillment: kinds.size > 1 ? 'mixed' : items[0].type,
    status: 'pending_payment',
    payment: { provider: null, status: 'unpaid', reference: null },
    note: typeof body.note === 'string' ? body.note.slice(0, 500) : '',
    createdAt: new Date().toISOString(),
  };

  /* Strong read so two orders placed back to back cannot overwrite each other. */
  const orders = (await store.get('orders', { type: 'json', consistency: 'strong' })) || [];
  orders.unshift(order);
  await store.setJSON('orders', orders.slice(0, 2000));

  return json({ ok: true, order }, 201);
};

export const config = { path: '/api/orders' };
