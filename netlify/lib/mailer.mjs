/* CVMILOPORRAS_SERVER */
/* Outbound notification email for the label.

   Orders and enquiries only ever appeared inside the admin panel, which means
   somebody had to think to go and look. These send a short note instead.

   Everything is configured in Netlify, so no key is ever written down here:
     RESEND_API_KEY    the key from resend.com
     HVX_NOTIFY_TO     where notices go; comma separated for several inboxes
     HVX_NOTIFY_FROM   the verified sender, e.g. HVX Music <orders@hvxmusic.com>

   With any of the three unset the helper does nothing and reports why. That
   default is deliberate: the shop has to keep taking orders whether or not a
   mail account was ever set up. */

const ENDPOINT = 'https://api.resend.com/emails';
/* A webhook has to answer Stripe quickly. If the mail API is slow the order is
   already saved, so the notice is abandoned rather than holding the response. */
const TIMEOUT_MS = 4000;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function recipients() {
  return String(process.env.HVX_NOTIFY_TO || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

/* True when Netlify holds all three variables. Not exported: nothing outside
   this file needs to ask, and notify() already answers 'not configured'. */
function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY
    && process.env.HVX_NOTIFY_FROM
    && recipients().length);
}

/* Builds both bodies from the same data. Plain text is not a courtesy here:
   a phone showing only the preview line should still convey the order. */
function render(heading, rows, message) {
  const pairs = (rows || []).filter((r) => r && r[1] !== '' && r[1] != null);

  const text = [heading, '']
    .concat(pairs.map(([k, v]) => k + ': ' + v))
    .concat(message ? ['', message] : [])
    .join('\n');

  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
    + 'font-size:15px;line-height:1.6;color:#111">'
    + '<h2 style="font-size:17px;margin:0 0 16px">' + esc(heading) + '</h2>'
    + '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">'
    + pairs.map(([k, v]) =>
        '<tr><td style="padding:3px 16px 3px 0;color:#666;vertical-align:top;'
        + 'white-space:nowrap">' + esc(k) + '</td>'
        + '<td style="padding:3px 0">' + esc(v) + '</td></tr>').join('')
    + '</table>'
    + (message
        ? '<p style="margin:18px 0 0;padding:12px 14px;background:#f5f5f7;'
          + 'border-radius:6px;white-space:pre-wrap">' + esc(message) + '</p>'
        : '')
    + '</div>';

  return { text, html };
}

/* Never throws and never rejects. A notification that fails must not take the
   order with it: a webhook answering non-2xx makes Stripe retry an event that
   was already handled, and the payment is recorded either way. Problems come
   back as a value for the caller to log, not as an exception. */
export async function notify({ subject, heading, rows, message, replyTo }) {
  if (!mailConfigured()) return { sent: false, reason: 'not configured' };

  const { text, html } = render(heading || subject, rows, message);
  const payload = {
    from: process.env.HVX_NOTIFY_FROM,
    to: recipients(),
    subject,
    text,
    html,
  };
  /* So hitting reply on an enquiry answers the person who wrote in. */
  if (replyTo) payload.reply_to = replyTo;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
    if (!res.ok) {
      /* Read the body for the reason, but never let the key or the recipient
         list reach a log line. */
      const detail = await res.text().catch(() => '');
      return { sent: false, reason: 'http ' + res.status, detail: detail.slice(0, 300) };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/* Money formatting lives here so the order mail and the enquiry mail cannot
   drift apart on it. */
export function money(n) {
  const v = Number(n);
  return Number.isFinite(v)
    ? '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : String(n);
}
