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
const os = require('os');
const { execFileSync } = require('child_process');
let bridge = null;                                // internet relay (code-only pairing without shared Wi-Fi); optional
try { if (process.env.DANI_RELAY_OFF !== '1') bridge = require('./relay-bridge'); } catch (e) { console.error('relay disabled:', e.message); }

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
// ---------- remote control + file transfer (phone <-> computer) ----------
const MAX_FILE = 25 * 1024 * 1024;
const cmds = new Map();                           // linkId -> commands waiting for the computer's shell (lock, notify, theme, received…)
const outbox = new Map();                         // linkId -> [{id,name,size,ts,file}] files the computer offered to the phone (LAN download)
const THEME_WALLS = ['red', 'sky', 'sunset', 'forest', 'night', 'graphite'];
function rawBody(req, max) {
  return new Promise((res, rej) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { rej(new Error('too_big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej);
  });
}
function desktopUser() {                          // the person who owns the desktop session: received files go into THEIR folders
  if (process.env.DANI_RECEIVE_HOME) return { home: process.env.DANI_RECEIVE_HOME, uid: null, gid: null };
  try {
    const uid = fs.readdirSync('/run/user').find(u => /^\d+$/.test(u) && +u >= 1000);
    if (uid) { const l = execFileSync('getent', ['passwd', uid]).toString().split(':'); return { home: l[5], uid: +l[2], gid: +l[3] }; }
  } catch {}
  try { const l = fs.readFileSync('/etc/passwd', 'utf8').split('\n').map(x => x.split(':')).find(a => +a[2] >= 1000 && +a[2] < 60000 && !/nologin|false/.test(a[6] || '')); if (l) return { home: l[5], uid: +l[2], gid: +l[3] }; } catch {}
  return { home: os.homedir(), uid: null, gid: null };
}
function safeName(n) { n = path.basename(String(n || 'file').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 100); return n || 'file'; }
function saveReceived(buf, name, kind) {
  const u = desktopUser(); name = safeName(name);
  if (kind === 'wallpaper' && !/\.(png|jpe?g|webp|gif)$/i.test(name)) throw new Error('not_an_image');
  const sub = kind === 'wallpaper' ? 'Pictures' : 'Downloads'; const dir = path.join(u.home, sub, 'DANI-Phone');
  fs.mkdirSync(dir, { recursive: true });
  let target = path.join(dir, name), i = 1; const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  while (fs.existsSync(target)) target = path.join(dir, `${stem} (${i++})${ext}`);
  fs.writeFileSync(target, buf, { mode: 0o644 });
  if (u.uid != null && process.getuid && process.getuid() === 0) { try { fs.chownSync(dir, u.uid, u.gid); fs.chownSync(path.dirname(dir), u.uid, u.gid); fs.chownSync(target, u.uid, u.gid); } catch {} }
  return '/' + sub + '/DANI-Phone/' + path.basename(target);       // path relative to the desktop user's home (what the shell/agent use)
}
function queueCmd(linkId, c) { const a = cmds.get(linkId) || []; a.push({ id: crypto.randomUUID(), ts: Date.now(), ...c }); cmds.set(linkId, a.slice(-50)); }
const OUTBOX_DIR = () => path.join(DATA, 'outbox');

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-pair-secret,filename', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

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
      if (bridge) bridge.announceCode(code, Date.now() + CODE_TTL_MS);
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
    if (req.method === 'POST' && p === '/api/device/unlink') { delete links[a.id]; inbox.delete(a.id); cmds.delete(a.id); outbox.delete(a.id); saveLinks(); if (bridge) bridge.dropLink(a.id); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && p === '/api/notify') {
      if (a.role !== 'computer') return send(res, 403, { error: 'computer_only' });
      const { title, body: b, ring } = await body(req); const arr = inbox.get(a.id) || [];
      arr.push({ id: crypto.randomUUID(), title: String(title || '').slice(0, 100), body: String(b || '').slice(0, 500), ts: Date.now(), ...(ring === true ? { ring: true } : {}) });
      inbox.set(a.id, arr.slice(-100)); if (bridge) bridge.push(a.id, arr[arr.length - 1]); return send(res, 201, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/notifications') {
      if (a.role !== 'phone') return send(res, 403, { error: 'phone_only' });
      const since = +url.searchParams.get('since') || 0;
      return send(res, 200, { items: (inbox.get(a.id) || []).filter(n => n.ts > since) });
    }

    // ---------- remote control ----------
    if (req.method === 'POST' && p === '/api/remote/command') {                      // phone -> computer
      if (a.role !== 'phone') return send(res, 403, { error: 'phone_only' });
      if (limited('cmd:' + a.id, 30, 60_000)) return send(res, 429, { error: 'rate_limited' });
      const c = await body(req); const t = String(c.type || '');
      if (t === 'lock') queueCmd(a.id, { type: 'lock' });
      else if (t === 'ring') queueCmd(a.id, { type: 'ring', from: String(c.from || '').slice(0, 40) });
      else if (t === 'notify') queueCmd(a.id, { type: 'notify', title: String(c.title || 'הודעה מהטלפון').slice(0, 80), body: String(c.body || '').slice(0, 400) });
      else if (t === 'theme') {
        const th = { type: 'theme' };
        if (c.accent != null) { const n = +c.accent; if (!Number.isInteger(n) || n < 0 || n > 5) return send(res, 400, { error: 'bad_accent' }); th.accent = n; }
        if (c.wall != null) { if (!THEME_WALLS.includes(c.wall)) return send(res, 400, { error: 'bad_wall' }); th.wall = c.wall; }
        if (th.accent == null && th.wall == null) return send(res, 400, { error: 'empty_theme' });
        queueCmd(a.id, th);
      } else return send(res, 400, { error: 'unknown_command' });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/remote/commands') {                      // the computer's shell collects them (never reachable through the relay)
      if (a.role !== 'computer') return send(res, 403, { error: 'computer_only' });
      const list = cmds.get(a.id) || []; cmds.set(a.id, []); return send(res, 200, { commands: list });
    }
    if (req.method === 'POST' && p === '/api/remote/upload') {                       // phone -> computer file (LAN, raw body)
      if (a.role !== 'phone') return send(res, 403, { error: 'phone_only' });
      if (limited('up:' + a.id, 20, 60_000)) return send(res, 429, { error: 'rate_limited' });
      const kind = url.searchParams.get('kind') === 'wallpaper' ? 'wallpaper' : 'file', name = url.searchParams.get('name') || 'file';
      const buf = await rawBody(req, MAX_FILE); if (!buf.length) return send(res, 400, { error: 'empty' });
      const saved = saveReceived(buf, name, kind); queueCmd(a.id, { type: 'received', kind, path: saved, name: path.basename(saved), size: buf.length });
      return send(res, 201, { ok: true, path: saved });
    }
    // ---------- computer -> phone files ----------
    if (req.method === 'POST' && p === '/api/remote/send') {
      if (a.role !== 'computer') return send(res, 403, { error: 'computer_only' });
      const name = safeName(url.searchParams.get('name')); const buf = await rawBody(req, MAX_FILE); if (!buf.length) return send(res, 400, { error: 'empty' });
      const id = crypto.randomBytes(8).toString('hex'); fs.mkdirSync(path.join(OUTBOX_DIR(), a.id), { recursive: true, mode: 0o700 });
      const file = path.join(OUTBOX_DIR(), a.id, id); fs.writeFileSync(file, buf, { mode: 0o600 });
      const arr = outbox.get(a.id) || []; arr.push({ id, name, size: buf.length, ts: Date.now(), file }); while (arr.length > 20) { const o = arr.shift(); try { fs.unlinkSync(o.file); } catch {} } outbox.set(a.id, arr);
      const note = { id: crypto.randomUUID(), title: 'קובץ מהמחשב', body: name, ts: Date.now(), fileId: id, fileName: name, fileSize: buf.length };
      const ib = inbox.get(a.id) || []; ib.push(note); inbox.set(a.id, ib.slice(-100));
      if (bridge && bridge.pushFile) bridge.pushFile(a.id, buf, name, note);
      return send(res, 201, { ok: true, id });
    }
    if (req.method === 'GET' && p === '/api/remote/outbox') {
      if (a.role !== 'phone') return send(res, 403, { error: 'phone_only' });
      return send(res, 200, { items: (outbox.get(a.id) || []).map(({ id, name, size, ts }) => ({ id, name, size, ts })) });
    }
    if (req.method === 'GET' && (m = /^\/api\/remote\/outbox\/(\w+)$/.exec(p))) {
      if (a.role !== 'phone') return send(res, 403, { error: 'phone_only' });
      const o = (outbox.get(a.id) || []).find(x => x.id === m[1]); if (!o) return send(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': o.size, 'access-control-allow-origin': '*', 'x-file-name': encodeURIComponent(o.name) }); return res.end(fs.readFileSync(o.file));
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) { return send(res, 400, { error: e.message }); }
});

function linkIdForToken(t) { const h = sha(String(t)); for (const [id, l] of Object.entries(links)) if (eq(h, l.deviceTokenHash)) return id; return null; }
if (require.main === module) server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`DANI pairing server on ${process.env.HOST || '127.0.0.1'}:${PORT}`);
  if (bridge) bridge.start({ port: PORT, linkIdForToken });
});
module.exports = { server };
