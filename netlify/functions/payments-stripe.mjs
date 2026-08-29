/* CVMILOPORRAS_SERVER */
/* Stripe Checkout for the HVX store.

   The customer is redirected to a payment page hosted by Stripe, so card
   details never reach this site. Cards, Apple Pay and Google Pay are all
   handled there. The order total is rebuilt from the stored order, never
   from the browser, so a tampered cart cannot change the amount charged.

   Shipping addresses are collected by Stripe on its own page, limited to
   the United States, and written onto the order by the webhook.

   GET  /api/payments/stripe?action=status                    public
   POST /api/payments/stripe?action=create-checkout-session   Bearer customer
        { reference }  ->  { url }   redirect the browser to url

   TO ACTIVATE
   1. Create an account at dashboard.stripe.com.
   2. Developers > API keys, copy the Secret key (sk_test_... to trial it).
   3. In Netlify: Project configuration > Environment variables, add
        STRIPE_SECRET_KEY      sk_test_... or sk_live_...
        STRIPE_WEBHOOK_SECRET  whsec_... (see stripe-webhook.mjs, step 5)
   4. Redeploy. ?action=status will report "configured".
   No code changes are needed to go from test mode to live: swap the key. */

import { getStore } from '@netlify/blobs';
import { cors, json, resolveSession, isAdmin } from '../lib/session.mjs';

const STRIPE_API = 'https://api.stripe.com/v1';

/* Stripe's REST API takes form-encoded bodies, including nested keys
   such as line_items[0][price_data][unit_amount]. */
function formEncode(obj, prefix, out) {
  const params = out || new URLSearchParams();
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value === undefined || value === null) return;
    const field = prefix ? prefix + '[' + key + ']' : key;
    if (typeof value === 'object') {
      formEncode(value, field, params);
    } else {
      params.append(field, String(value));
    }
  });
  return params;
}

async function stripe(path, payload) {
  const res = await fetch(STRIPE_API + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(payload).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || 'Stripe request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

async function stripeGet(path) {
  const res = await fetch(STRIPE_API + path, {
    headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || 'Stripe rejected the request');
    err.status = res.status;
    throw err;
  }
  return data;
}

function siteUrl(req) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(req.url).origin;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const action = new URL(req.url).searchParams.get('action');
  const configured = Boolean(process.env.STRIPE_SECRET_KEY);

  if (action === 'status') {
    const live = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
    const base = {
      configured,
      mode: configured ? (live ? 'live' : 'test') : null,
      webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      message: configured
        ? 'Stripe Checkout is active in ' + (live ? 'live' : 'test') + ' mode.'
        : 'Stripe is not configured. Orders are saved as pending_payment until '
          + 'STRIPE_SECRET_KEY is set in the Netlify environment variables.',
    };

    /* The prefix only describes what the key looks like, never whether Stripe
       accepts it: a truncated key still starts with sk_live_ and this endpoint
       still reported "live" while every checkout failed. Only Stripe can
       answer that, so ask it - but for the admin alone. A public endpoint that
       calls an external API on demand is something to hammer. */
    if (!configured || !isAdmin(req)) return json(base);

    try {
      const account = await stripeGet('/account');
      return json({
        ...base,
        keyValid: true,
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        account: account.id,
      });
    } catch (err) {
      /* Say what Stripe said. The reason is the whole point of asking. */
      return json({ ...base, keyValid: false, keyError: err.message });
    }
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const found = await resolveSession(req);
  if (!found) return json({ error: 'Not authenticated' }, 401);

  if (!configured) {
    return json({
      error: 'Payments are not enabled yet',
      detail: 'Your order was saved. Set STRIPE_SECRET_KEY in the Netlify '
        + 'environment variables to start taking payment. See the header of '
        + 'netlify/functions/payments-stripe.mjs.',
    }, 501);
  }

  if (action !== 'create-checkout-session') return json({ error: 'Unknown action' }, 400);

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const reference = body && typeof body.reference === 'string' ? body.reference : '';
  if (!reference) return json({ error: 'Order reference is required' }, 400);

  const shop = getStore('hvx-shop');
  /* Strong read: the order was written milliseconds ago by /api/orders and an
     eventual read would not see it yet, turning a valid checkout into a 404. */
  const orders = (await shop.get('orders', { type: 'json', consistency: 'strong' })) || [];
  const order = orders.find((o) => o.reference === reference);

  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.customer.email !== found.user.email) return json({ error: 'Unauthorized' }, 403);
  if (order.payment && order.payment.status === 'paid') {
    return json({ error: 'This order is already paid' }, 409);
  }

  const payload = {
    mode: 'payment',
    success_url: siteUrl(req) + '/?order=' + encodeURIComponent(order.reference) + '&paid=1',
    cancel_url: siteUrl(req) + '/?order=' + encodeURIComponent(order.reference) + '&canceled=1',
    customer_email: order.customer.email,
    client_reference_id: order.reference,
    metadata: { orderRef: order.reference, fulfillment: order.fulfillment },

    /* The address is collected here rather than on our own page: Stripe
       already autocompletes and format-checks it, restricts the country
       list, and hands it back with the payment. A separate form before
       this one would mean a second place to get wrong, a mapping API key
       in the browser, and the customer typing an address twice.

       Format is all this guarantees. It does not prove a house exists, so
       an address that looks right can still bounce. */
    shipping_address_collection: { allowed_countries: ['US'] },

    /* A phone number is what a courier asks for when a delivery fails. */
    phone_number_collection: { enabled: 'true' },
  };

  /* Amounts are taken from the stored order and sent in cents. */
  order.items.forEach((item, i) => {
    payload['line_items[' + i + '][quantity]'] = item.qty;
    payload['line_items[' + i + '][price_data][currency]'] = 'usd';
    payload['line_items[' + i + '][price_data][unit_amount]'] = Math.round(item.price * 100);
    payload['line_items[' + i + '][price_data][product_data][name]'] =
      item.type === 'preorder' ? item.name + ' (Pre-order)' : item.name;
  });

  try {
    const session = await stripe('/checkout/sessions', payload);

    order.payment = {
      provider: 'stripe',
      status: 'awaiting_payment',
      reference: session.id,
    };
    await shop.setJSON('orders', orders);

    return json({ url: session.url, sessionId: session.id });
  } catch (err) {
    return json({ error: 'Could not start checkout', detail: err.message }, 502);
  }
};

export const config = { path: '/api/payments/stripe' };
