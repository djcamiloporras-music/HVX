/* CVMILOPORRAS_SERVER */
/* Discount code rules, in one place.

   The cart checks a code to show the customer what it is worth, and the order
   endpoint checks it again before charging. Those two answers must never
   disagree, so both call evaluate() here rather than each doing its own
   arithmetic. The cart's answer is only ever a preview: what the customer
   pays is decided when the order is written, from the catalog price.

   Money is handled in whole cents throughout. Working in dollars means
   0.1 + 0.2 arithmetic deciding what somebody is charged. */

export function normalizeCode(raw) {
  return String(raw == null ? '' : raw)
    .toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

export function toCents(value) {
  const text = String(value == null ? '' : value);
  /* The sign is read before the strip, not after. Removing every character
     that is not a digit or a point turns -10 into 10, which here would have
     meant a negative discount arriving as a positive one: a code worth minus
     ten dollars would have taken ten dollars off. */
  const negative = /^\s*-/.test(text);
  const n = Number(text.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

export function fromCents(cents) {
  return Math.round(cents) / 100;
}

/* Today where the shop is, not where the server happens to run. A code that
   says it expires on the 31st should still work all of the 31st in New York,
   and a UTC server is already into the 1st by 7pm local. */
export function shopToday(now) {
  const d = now || new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

export function findCoupon(list, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  return (Array.isArray(list) ? list : []).find(
    (c) => c && normalizeCode(c.code) === code) || null;
}

/* Decides what a code is worth against a subtotal, both in cents.

   Returns { ok: true, discountCents, label } or { ok: false, reason }. The
   reason is written to be shown to the customer as it is. Saying "expired"
   rather than "not valid" does tell someone that a code once existed, which
   is a trade this shop can afford: a confused customer who cannot tell a typo
   from a finished promotion is the more expensive outcome. */
export function evaluate(coupon, subtotalCents, now) {
  if (!coupon) return { ok: false, reason: 'That code is not valid.' };
  if (coupon.active === false) return { ok: false, reason: 'That code is not active right now.' };

  if (coupon.expiresAt) {
    const today = shopToday(now);
    /* Compared as YYYY-MM-DD text, which sorts correctly and cannot be moved
       by a timezone. The expiry day itself still counts as valid. */
    if (String(coupon.expiresAt) < today) {
      return { ok: false, reason: 'That code has expired.' };
    }
  }

  const maxUses = Number(coupon.maxUses) || 0;
  const uses = Number(coupon.uses) || 0;
  if (maxUses > 0 && uses >= maxUses) {
    return { ok: false, reason: 'That code has reached its limit of uses.' };
  }

  const minCents = toCents(coupon.minOrder);
  if (minCents > 0 && subtotalCents < minCents) {
    return {
      ok: false,
      reason: 'That code needs an order of at least $' + fromCents(minCents).toFixed(2) + '.',
    };
  }

  let discountCents;
  let label;
  if (coupon.type === 'fixed') {
    discountCents = toCents(coupon.value);
    label = '$' + fromCents(discountCents).toFixed(2) + ' off';
  } else {
    const pct = Number(coupon.value) || 0;
    if (!(pct > 0)) return { ok: false, reason: 'That code is not valid.' };
    discountCents = Math.round(subtotalCents * Math.min(pct, 100) / 100);
    label = pct + '% off';
  }

  if (discountCents <= 0) return { ok: false, reason: 'That code is not valid.' };

  /* A fixed code worth more than the cart must not produce a negative total,
     and must not hand back the difference either. It caps at the subtotal. */
  if (discountCents > subtotalCents) discountCents = subtotalCents;

  return { ok: true, discountCents, label };
}

/* Shape coming out of the admin panel, with every field forced into the type
   the rest of the code expects. The admin is trusted to decide the values,
   not to send them as the right type. */
export function sanitize(raw) {
  const code = normalizeCode(raw && raw.code);
  if (!code) return null;
  const type = (raw && raw.type) === 'fixed' ? 'fixed' : 'percent';
  let value = Number(raw && raw.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (type === 'percent') value = Math.min(100, Math.round(value * 100) / 100);
  else value = Math.round(value * 100) / 100;

  const expires = String((raw && raw.expiresAt) || '').slice(0, 10);
  return {
    code,
    type,
    value,
    active: (raw && raw.active) !== false,
    expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(expires) ? expires : '',
    maxUses: Math.max(0, parseInt(raw && raw.maxUses, 10) || 0),
    minOrder: Math.max(0, Math.round((Number(raw && raw.minOrder) || 0) * 100) / 100),
    /* Carried over, never taken from the form: the count is the shop's record
       of what happened, not something the admin screen gets to rewrite. */
    uses: Math.max(0, parseInt(raw && raw.uses, 10) || 0),
    createdAt: (raw && raw.createdAt) || new Date().toISOString(),
  };
}
