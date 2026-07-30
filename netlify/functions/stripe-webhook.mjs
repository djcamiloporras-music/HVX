/* CVMILOPORRAS_SERVER */
/* Stripe webhook receiver: marks an order paid once Stripe confirms it.

   Never trust a browser redirect to decide that money arrived. The customer
   can close the tab, and the success URL can be visited by hand. This
   endpoint is the only place an order becomes "paid".

   POST /api/payments/stripe/webhook   (called by Stripe, not by the browser)

   SETUP (step 5 of the Stripe checklist)
   1. Stripe dashboard > Developers > Webhooks > Add endpoint.
   2. URL:  https://hvxmusic.com/api/payments/stripe/webhook
   3. Events to send: checkout.session.completed
                      checkout.session.async_payment_failed
   4. Copy the signing secret (whsec_...) into the Netlify environment
      variable STRIPE_WEBHOOK_SECRET, then redeploy. */

import { getStore } from '@netlify/blobs';

const TOLERANCE_SECONDS = 300;

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Buffer.from(sig).toString('hex');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Verifies the Stripe-Signature header against the raw request body. */
async function verify(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim()))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  return safeEqual(await hmacHex(secret, timestamp + '.' + rawBody), signature);
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('Webhook secret not configured', { status: 501 });
  }

  const rawBody = await req.text();
  const ok = await verify(rawBody, req.headers.get('stripe-signature'), secret);
  if (!ok) {
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return new Response('Bad payload', { status: 400 }); }

  const session = event && event.data && event.data.object;
  const reference = session && (session.client_reference_id
    || (session.metadata && session.metadata.orderRef));

  if (!reference) return Response.json({ received: true, ignored: 'no order reference' });

  const shop = getStore('hvx-shop');
  const orders = (await shop.get('orders', { type: 'json' })) || [];
  const order = orders.find((o) => o.reference === reference);
  if (!order) return Response.json({ received: true, ignored: 'unknown order' });

  if (event.type === 'checkout.session.completed') {
    /* Idempotent: replaying the same event changes nothing. */
    if (order.payment && order.payment.status === 'paid') {
      return Response.json({ received: true, duplicate: true });
    }
    order.status = 'paid';
    order.payment = {
      provider: 'stripe',
      status: 'paid',
      reference: session.id,
      paymentIntent: session.payment_intent || null,
      amountTotal: typeof session.amount_total === 'number' ? session.amount_total / 100 : order.total,
      paidAt: new Date().toISOString(),
    };
    await shop.setJSON('orders', orders);
    return Response.json({ received: true, order: order.reference, status: 'paid' });
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    order.status = 'payment_failed';
    order.payment = { ...(order.payment || {}), provider: 'stripe', status: 'failed' };
    await shop.setJSON('orders', orders);
    return Response.json({ received: true, order: order.reference, status: 'failed' });
  }

  return Response.json({ received: true, ignored: event.type });
};

export const config = { path: '/api/payments/stripe/webhook' };
