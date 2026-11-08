#!/usr/bin/env node
/*
 * DANI OS pairing server — code only, NO accounts, NO sign-up (no dependencies, Node >= 18).
 *
 * Flow:  computer shows a 6-digit code  ->  phone (same Wi-Fi) enters it  ->  computer approves AND phone confirms  ->  linked.
 *
 * Security:
 *  - Only the computer itself (loopback) can create a code, so nobody on the network can start a pairing.
 *  - Code: 6 random digits (crypto.randomInt), valid 120 s, single use (burned on first successful claim).
 *  - Guessing is limited: per-IP rate limit + a global lock after too many wrong codes.
 *  - Even a correct code does nothing until the person at the computer sees the device name and approves.
 *  - After pairing each side gets a random 256-bit token; only SHA-256 hashes are stored on disk.
 *
 * Both devices must be able to reach each other (e.g. same Wi-Fi). Run with HOST=0.0.0.0 to accept the phone.
 * The traffic is plain HTTP on the local network; put it behind HTTPS if you expose it beyond your own LAN.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 7799;
const DATA = process.env.DANI_DATA || path.join(__dirname, 'data');
const LINKS_FILE = path.join(DATA, 'links.json');
const CODE_TTL_MS = 120_000;
fs.mkdirSync(DATA, { recursive: true });

let links = {};                                   // linkId -> {name, computerTokenHash, deviceTokenHash, paired}
try { links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8')); } catch {}
const saveLinks = () => { fs.writeFileSync(LINKS_FILE + '.tmp', JSON.stringify(links, null, 1), { mode: 0o600 }); fs.renameSync(LINKS_FILE + '.tmp', LINKS_FILE); };

const pairs = new Map();                          // pairId -> record
const codes = new Map();                          // code -> pairId
const inbox = new Map();                          // linkId -> [{id,title,body,ts}]
const hits = new Map();
let failures = [];                                // timestamps of wrong codes (global)
let lockedUntil = 0;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rnd = () => crypto.randomBytes(32).toString('base64url');
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const isLoopback = a => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

function limited(key, max, windowMs) {
  const now = Date.now(); const a = (hits.get(key) || []).filter(t => now - t < windowMs);
  a.push(now); hits.set(key, a); return a.length > max;
}
function newCode() { for (;;) { const c = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); if (!codes.has(c)) return c; } }
function expire(p) { if (!['paired', 'rejected', 'expired'].includes(p.state) && Date.now() > p.exp) { p.state = 'expired'; codes.delete(p.code); } return p; }
function pairRole(p, secret) {                    // which side is calling, based on its pairing secret
  if (!secret) return null; const h = sha(secret);
  if (eq(h, p.computerSecretHash)) return 'computer';
  if (p.phoneSecretHash && eq(h, p.phoneSecretHash)) return 'phone';
  return null;
}
function bearer(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) return null; const h = sha(m[1]);
  for (const [id, l] of Object.entries(links)) {
    if (eq(h, l.computerTokenHash)) return { id, role: 'computer' };
    if (eq(h, l.deviceTokenHash)) return { id, role: 'phone' };
  }
  return null;
}
function body(req) {
  return new Promise((res, rej) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 20_000) { rej(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch { rej(new Error('bad json')); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-pair-secret', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const ip = req.socket.remoteAddress; const url = new URL(req.url, 'http://x'); const p = url.pathname;
  try {
    if (limited('all:' + ip, 300, 60_000)) return send(res, 429, { error: 'rate_limited' });

    // used by the phone to find the computer on the local network
    if (req.method === 'GET' && p === '/api/hello') return send(res, 200, { dani: true, name: 'DANI OS' });

    // --- computer creates a code (loopback only) ---
    if (req.method === 'POST' && p === '/api/pair/start') {
      if (!isLoopback(ip)) return send(res, 403, { error: 'computer_only' });
      for (const q of pairs.values()) if (['waiting', 'awaiting_approval'].includes(q.state)) { q.state = 'expired'; codes.delete(q.code); }
      const code = newCode(), pairId = crypto.randomBytes(12).toString('hex'), secret = rnd();
      pairs.set(pairId, { pairId, code, state: 'waiting', exp: Date.now() + CODE_TTL_MS, computerSecretHash: sha(secret), phoneSecretHash: null, deviceName: '', computerOk: false, phoneOk: false, link: null, delivered: {} });
      codes.set(code, pairId);
      return send(res, 200, { pairId, code, secret, expiresIn: CODE_TTL_MS / 1000 });
    }

    // --- phone submits the code ---
    if (req.method === 'POST' && p === '/api/pair/claim') {
      const now = Date.now();
      if (now < lockedUntil) return send(res, 429, { error: 'locked_try_later' });
      if (limited('claim:' + ip, 10, 60_000)) return send(res, 429, { error: 'rate_limited' });
      const { code, deviceName } = await body(req);
      const id = codes.get(String(code || '')); const q = id && expire(pairs.get(id));
      if (!q || q.state !== 'waiting') {
        failures = failures.filter(t => now - t < 60_000); failures.push(now);
        if (failures.length >= 20) { lockedUntil = now + 60_000; failures = []; }
        return send(res, 404, { error: 'invalid_or_expired_code' });
      }
      const secret = rnd(); q.phoneSecretHash = sha(secret); q.deviceName = String(deviceName || 'Android').slice(0, 40);
      q.state = 'awaiting_approval'; codes.delete(q.code);              // single use
      return send(res, 200, { pairId: q.pairId, secret, state: q.state });
    }

    let m;
    // --- both sides poll their pairing ---
    if (req.method === 'GET' && (m = /^\/api\/pair\/status\/(\w+)$/.exec(p))) {
      const q = pairs.get(m[1]); const role = q && pairRole(q, req.headers['x-pair-secret']);
      if (!role) return send(res, 404, { error: 'not_found' }); expire(q);
      const out = { state: q.state, deviceName: q.deviceName, computerOk: q.computerOk, phoneOk: q.phoneOk };
      if (q.state === 'paired' && !q.delivered[role]) { q.delivered[role] = true; out.token = role === 'computer' ? q.link.computerToken : q.link.deviceToken; } // each token is handed out once
      return send(res, 200, out);
    }
    if (req.method === 'POST' && (m = /^\/api\/pair\/(approve|reject|confirm)\/(\w+)$/.exec(p))) {
      const q = pairs.get(m[2]); const role = q && pairRole(q, req.headers['x-pair-secret']);
      if (!role) return send(res, 404, { error: 'not_found' }); expire(q);
      if (q.state !== 'awaiting_approval') return send(res, 409, { error: 'bad_state', state: q.state });
      if (m[1] === 'reject') { q.state = 'rejected'; return send(res, 200, { state: q.state }); }
      if (m[1] === 'approve') { if (role !== 'computer') return send(res, 403, { error: 'computer_only' }); q.computerOk = true; }
      if (m[1] === 'confirm') { if (role !== 'phone') return send(res, 403, { error: 'phone_only' }); q.phoneOk = true; }
      if (q.computerOk && q.phoneOk) {
        const linkId = crypto.randomBytes(8).toString('hex'), ct = rnd(), dt = rnd();
        links[linkId] = { name: q.deviceName, computerTokenHash: sha(ct), deviceTokenHash: sha(dt), paired: Date.now() }; saveLinks();
        q.link = { computerToken: ct, deviceToken: dt }; q.state = 'paired';
      }
      return send(res, 200, { state: q.state });
    }

    // --- after pairing: token based ---
    const a = bearer(req); if (!a) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && p === '/api/device/status') return send(res, 200, { paired: true, name: links[a.id].name, role: a.role });
    if (req.method === 'POST' && p === '/api/device/unlink') { delete links[a.id]; inbox.delete(a.id); saveLinks(); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && p === '/api/notify') {
      if (a.role !== 'computer') return send(res, 403, { error: 'computer_only' });
      const { title, body: b } = await body(req); const arr = inbox.get(a.id) || [];
      arr.push({ id: crypto.randomUUID(), title: String(title || '').slice(0, 100), body: String(b || '').slice(0, 500), ts: Date.now() });
      inbox.set(a.id, arr.slice(-100)); return send(res, 201, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/notifications') {
      if (a.role !== 'phone') return send(res, 403, { error: 'phone_only' });
      const since = +url.searchParams.get('since') || 0;
      return send(res, 200, { items: (inbox.get(a.id) || []).filter(n => n.ts > since) });
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) { return send(res, 400, { error: e.message }); }
});

if (require.main === module) server.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`DANI pairing server on ${process.env.HOST || '127.0.0.1'}:${PORT}`));
module.exports = { server };
