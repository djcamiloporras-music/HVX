/* CVMILOPORRAS_SERVER */
/* Discount codes.

   GET  /api/coupons                 Bearer admin     the whole list
   POST /api/coupons                 Bearer admin     replaces the whole list
   POST /api/coupons?action=check    Bearer customer  what one code is worth

   These deliberately do not live under /api/data. That endpoint serves its
   keys to anyone who asks, which is right for the artist roster and wrong for
   a list of discount codes: publishing them would let any visitor read every
   code the label has ever created.

   The check is for the cart, so a customer sees their code land before they
   reach the payment page. It is a preview and nothing more. What is actually
   charged is decided in /api/orders, from the catalog price, whether or not
   this was ever called. */

import { getStore } from '@netlify/blobs';
import { cors, json, isAdmin, resolveSession } from '../lib/session.mjs';
import { evaluate, findCoupon, sanitize, toCents, fromCents } from '../lib/coupons.mjs';

const MAX_CODES = 200;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const store = getStore('hvx-shop');
  const action = new URL(req.url).searchParams.get('action');

  /* Strong read everywhere: the admin saves a code and the shop has to honour
     it on the next request, and the use counter is a read-modify-write that an
     eventual copy would silently roll back. */
  const read = async () =>
    (await store.get('coupons', { type: 'json', consistency: 'strong' })) || [];

  if (req.method === 'GET') {
    if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401);
    return json(await read());
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (action === 'check') {
    /* Signed in, same as placing an order. Without it this endpoint would be
       an open oracle: anybody could run through candidate codes until one
       answered yes. */
    const found = await resolveSession(req);
    if (!found) return json({ error: 'Sign in to use a discount code' }, 401);

    let body;
    try { body = await req.json(); } catch (e) { body = {}; }

    const list = await read();
    const coupon = findCoupon(list, body && body.code);
    const subtotalCents = Math.max(0, toCents(body && body.subtotal));
    const result = evaluate(coupon, subtotalCents);

    if (!result.ok) return json({ ok: false, error: result.reason }, 200);
    return json({
      ok: true,
      code: coupon.code,
      label: result.label,
      discount: fromCents(result.discountCents),
    });
  }

  if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await req.json(); } catch (e) { body = null; }
  if (!Array.isArray(body)) return json({ error: 'Body must be a JSON array' }, 400);
  if (body.length > MAX_CODES) return json({ error: 'Too many codes' }, 400);

  /* Existing counts win over whatever the form sent, so editing a code cannot
     reset how many times it has been redeemed. */
  const current = await read();
  const seen = new Set();
  const clean = [];
  for (const raw of body) {
    const item = sanitize(raw);
    if (!item) continue;
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    const before = findCoupon(current, item.code);
    if (before) item.uses = Math.max(item.uses, Number(before.uses) || 0);
    clean.push(item);
  }

  await store.setJSON('coupons', clean);
  return json({ ok: true, count: clean.length });
};

export const config = { path: '/api/coupons' };
