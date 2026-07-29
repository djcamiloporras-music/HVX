/* CVMILOPORRAS_SERVER */
/* Shared data API for the HVX admin panel and public pages.
   GET  /api/data?key=artists            -> returns stored JSON (public)
   POST /api/data?key=artists  + Bearer  -> replaces stored JSON (admin only)
   POST /api/data?key=contacts (no auth) -> appends one contact message  */

import { getStore } from '@netlify/blobs';

const ALLOWED_KEYS = ['artists', 'events', 'merch', 'highlights', 'contacts'];

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!ALLOWED_KEYS.includes(key)) {
    return Response.json({ error: 'Invalid key' }, { status: 400, headers: cors });
  }

  const store = getStore('hvx-data');

  if (req.method === 'GET') {
    const data = await store.get(key, { type: 'json' });
    return Response.json(data || [], {
      headers: { ...cors, 'Cache-Control': 'no-store' },
    });
  }

  if (req.method === 'POST') {
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const isAdmin = token && token === process.env.HVX_ADMIN_TOKEN;

    if (key === 'contacts' && !isAdmin) {
      let msg;
      try { msg = await req.json(); } catch (e) { msg = null; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return Response.json({ error: 'Bad body' }, { status: 400, headers: cors });
      }
      const list = (await store.get('contacts', { type: 'json' })) || [];
      list.unshift({
        name: String(msg.name || '').slice(0, 200),
        email: String(msg.email || '').slice(0, 200),
        type: String(msg.type || '').slice(0, 100),
        message: String(msg.message || '').slice(0, 2000),
        date: new Date().toISOString(),
        read: false,
        id: Date.now(),
      });
      await store.setJSON('contacts', list.slice(0, 500));
      return Response.json({ ok: true }, { headers: cors });
    }

    if (!isAdmin) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
    }

    let body;
    try { body = await req.json(); } catch (e) { body = null; }
    if (!Array.isArray(body)) {
      return Response.json({ error: 'Body must be a JSON array' }, { status: 400, headers: cors });
    }
    await store.setJSON(key, body);
    return Response.json({ ok: true }, { headers: cors });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
};

export const config = { path: '/api/data' };
