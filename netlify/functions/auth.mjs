/* CVMILOPORRAS_SERVER */
/* Customer authentication for the HVX store.

   POST /api/auth?action=register  { firstName, lastName, email, password }
   POST /api/auth?action=login     { email, password }
   POST /api/auth?action=logout    (Bearer session token)
   GET  /api/auth?action=me        (Bearer session token)

   Passwords are stored as PBKDF2-SHA256 derivations with a per-user random
   salt. Plain passwords are never written to storage and never returned.
   Sessions are opaque random tokens; only their SHA-256 digest is stored. */

import { getStore } from '@netlify/blobs';
import { cors, json, sha256Hex, bearer, resolveSession, publicUser } from '../lib/session.mjs';

const PBKDF2_ITERATIONS = 150000;
const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;

function toB64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function fromB64(str) {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

async function derive(password, saltBytes) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  return toB64(new Uint8Array(bits));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: await derive(password, salt) };
}

async function verifyPassword(password, saltB64, expectedB64) {
  const actual = await derive(password, fromB64(saltB64));
  if (actual.length !== expectedB64.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedB64.charCodeAt(i);
  }
  return diff === 0;
}

function newToken() {
  return toB64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

async function startSession(store, email) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await store.setJSON('session:' + (await sha256Hex(token)), { email, expiresAt });
  return { token, expiresAt };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const action = new URL(req.url).searchParams.get('action');
  const store = getStore('hvx-auth');

  if (action === 'me') {
    const found = await resolveSession(req);
    if (!found) return json({ error: 'Not authenticated' }, 401);
    return json({ user: publicUser(found.user) });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  if (action === 'register') {
    const firstName = clean(body.firstName, 80);
    const lastName = clean(body.lastName, 80);
    const email = clean(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    if (!firstName) return json({ error: 'First name is required' }, 400);
    if (!lastName) return json({ error: 'Last name is required' }, 400);
    if (!isEmail(email)) return json({ error: 'A valid email address is required' }, 400);
    if (password.length < MIN_PASSWORD) {
      return json({ error: 'Password must be at least ' + MIN_PASSWORD + ' characters' }, 400);
    }

    const userKey = 'user:' + (await sha256Hex(email));
    if (await store.get(userKey, { type: 'json', consistency: 'strong' })) {
      return json({ error: 'An account with that email already exists' }, 409);
    }

    const { salt, hash } = await hashPassword(password);
    const user = { firstName, lastName, email, salt, hash, createdAt: new Date().toISOString() };
    await store.setJSON(userKey, user);

    const index = (await store.get('users-index', { type: 'json' })) || [];
    index.unshift({ firstName, lastName, email, createdAt: user.createdAt });
    await store.setJSON('users-index', index.slice(0, 5000));

    const { token, expiresAt } = await startSession(store, email);
    return json({ token, expiresAt, user: publicUser(user) }, 201);
  }

  if (action === 'login') {
    const email = clean(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return json({ error: 'Email and password are required' }, 400);

    /* Strong read: a freshly registered account must be able to sign in
       immediately, not after the eventual-consistency window. */
    const user = await store.get('user:' + (await sha256Hex(email)),
      { type: 'json', consistency: 'strong' });
    /* Same response for unknown email and wrong password. */
    if (!user || !(await verifyPassword(password, user.salt, user.hash))) {
      return json({ error: 'Invalid email or password' }, 401);
    }

    const { token, expiresAt } = await startSession(store, email);
    return json({ token, expiresAt, user: publicUser(user) });
  }

  if (action === 'logout') {
    const token = bearer(req);
    if (token) await store.delete('session:' + (await sha256Hex(token)));
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
};

export const config = { path: '/api/auth' };
