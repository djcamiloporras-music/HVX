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
import { evaluate, findCoupon, fromCents, toCents } from '../lib/coupons.mjs';

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
    /* Strong read so a customer or the admin panel sees an order the moment
       it is placed, not after the eventual-consistency window. */
    const orders = (await store.get('orders', { type: 'json', consistency: 'strong' })) || [];

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

    /* money() answers 0 for anything it cannot read, so a price written as
       a range once turned a $2,000 piece into a free one. Refuse the sale
       instead: a product nobody can price is a product nobody can buy. */
    const price = money(product.price);
    if (!(price > 0)) {
      return json({
        error: '"' + product.name + '" is not priced correctly and cannot be sold right now.',
      }, 409);
    }
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

  const subtotal = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  const kinds = new Set(items.map((i) => i.type));

  /* The cart already showed the customer what their code was worth, and none
     of that is trusted here. The code is re-read, re-checked and re-applied
     against prices taken from the catalog, because the browser can send any
     discount it likes and this is the number that gets charged. */
  let discount = 0;
  let appliedCoupon = null;
  const requestedCode = body && body.coupon;
  if (requestedCode) {
    const coupons = (await store.get('coupons', { type: 'json', consistency: 'strong' })) || [];
    const coupon = findCoupon(coupons, requestedCode);
    const verdict = evaluate(coupon, toCents(subtotal));
    /* A code that stopped being valid between the cart and this call stops the
       order rather than quietly charging full price: somebody who typed a code
       and saw it accepted should never be billed as though they had not. */
    if (!verdict.ok) return json({ error: verdict.reason, coupon: 'rejected' }, 409);

    discount = fromCents(verdict.discountCents);
    appliedCoupon = { code: coupon.code, type: coupon.type, value: coupon.value, label: verdict.label };

    /* Counted here, where the order becomes real, and not when the cart
       checked it. A code with ten uses left would otherwise be exhausted by
       ten people typing it and walking away. */
    const i = coupons.findIndex((c) => c && c.code === coupon.code);
    if (i > -1) {
      coupons[i] = { ...coupons[i], uses: (Number(coupons[i].uses) || 0) + 1 };
      await store.setJSON('coupons', coupons);
    }
  }

  const total = Math.round((subtotal - discount) * 100) / 100;

  const order = {
    id: Date.now(),
    reference: reference(),
    customer: {
      firstName: found.user.firstName,
      lastName: found.user.lastName,
      email: found.user.email,
    },
    items,
    subtotal,
    discount,
    coupon: appliedCoupon,
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
