/* CVMILOPORRAS_SERVER */
/* Image hosting for artist photos and merch products.

   POST /api/media        (Bearer admin token)  body: the raw image bytes
                          -> { url: "/api/media?id=..." }
   GET  /api/media?id=..  public, serves the stored image

   Uploading beats pasting a link: a Google Drive or Dropbox share URL is a
   web page, not an image file, so the browser cannot render it. Files kept
   here are served straight from the site instead.

   The stored type is decided by inspecting the file's own leading bytes,
   never by trusting the header the browser sent, so nothing but a real
   image can be stored and later served back. */

import { getStore } from '@netlify/blobs';
import { cors, json, isAdmin } from '../lib/session.mjs';

const MAX_BYTES = 5 * 1024 * 1024;

/* Magic numbers: the first bytes every file of that format begins with. */
function sniff(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return { type: 'image/png', ext: 'png' };
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { type: 'image/gif', ext: 'gif' };
  }
  /* RIFF....WEBP */
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const store = getStore('hvx-media');

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return json({ error: 'id is required' }, 400);

    const found = await store.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!found || !found.data) return new Response('Not found', { status: 404 });

    return new Response(found.data, {
      headers: {
        'Content-Type': (found.metadata && found.metadata.type) || 'application/octet-stream',
        /* Ids are unique per upload, so a stored image never changes. */
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401);

  const buffer = await req.arrayBuffer();
  if (!buffer.byteLength) return json({ error: 'The file is empty' }, 400);
  if (buffer.byteLength > MAX_BYTES) {
    return json({ error: 'Image must be smaller than 5 MB' }, 413);
  }

  const kind = sniff(new Uint8Array(buffer.slice(0, 12)));
  if (!kind) {
    return json({ error: 'That file is not a JPG, PNG, WebP or GIF image' }, 415);
  }

  const id = Date.now().toString(36) + '-'
    + Math.random().toString(36).slice(2, 8) + '.' + kind.ext;

  await store.set(id, buffer, { metadata: { type: kind.type } });

  return json({ url: '/api/media?id=' + encodeURIComponent(id), id }, 201);
};

export const config = { path: '/api/media' };
