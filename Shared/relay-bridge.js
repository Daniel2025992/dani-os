/*
 * DANI OS relay bridge — lets the phone pair with the computer using ONLY the 6-digit code, with no shared Wi-Fi
 * (works from inside VMware / VirtualBox NAT too). No accounts, no server of ours.
 *
 * How it works: both devices talk to a public "mailbox" (ntfy.sh by default, or your own ntfy via DANI_RELAY).
 *  1. The computer shows a code C. The mailbox topic  P = "dani-p-" + sha256("dani-pair-v1:"+C)[0:32]  is only known to someone who has C.
 *  2. The phone publishes its ECDH P-256 public key on P, the computer answers with its own. Both derive a secret key
 *     (HKDF-SHA256) and a private topic L that nobody else knows.
 *  3. From then on every message is AES-256-GCM encrypted. The phone sends the SAME http requests it would send over Wi-Fi;
 *     the bridge forwards only a small allow-list of them to the local pairing server and returns the reply.
 *     So the normal rules still apply: 6-digit code, 120 s, single use, approval on the computer AND on the phone.
 *  4. Later the computer pushes notifications to the phone over L (encrypted).
 * The mailbox only ever sees encrypted data. Paired sessions are kept in DANI_DATA/relay-sessions.json (mode 600).
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');

const RELAY = (process.env.DANI_RELAY || 'https://ntfy.sh').replace(/\/+$/, '');
const DATA = process.env.DANI_DATA || path.join(__dirname, 'data');
const FILE = path.join(DATA, 'relay-sessions.json');
const UNLINKED_TTL = 15 * 60_000;
const SALT = Buffer.from('dani-relay-v1');
// the only requests a remote phone may make (code creation / approval stay local to the computer)
const ALLOWED = [
  ['POST', /^\/api\/pair\/claim$/], ['GET', /^\/api\/pair\/status\/\w+$/], ['POST', /^\/api\/pair\/(reject|confirm)\/\w+$/],
  ['GET', /^\/api\/device\/status$/], ['POST', /^\/api\/device\/unlink$/], ['GET', /^\/api\/notifications$/],
];

const b64 = b => Buffer.from(b).toString('base64');
const hkdf = (z, info, len) => Buffer.from(crypto.hkdfSync('sha256', z, SALT, info, len));
const topicP = code => 'dani-p-' + crypto.createHash('sha256').update('dani-pair-v1:' + code).digest('hex').slice(0, 32);

function seal(key, dir, obj) {
  const n = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, n); c.setAAD(Buffer.from(dir));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return JSON.stringify({ v: 1, n: b64(n), c: b64(ct) });
}
function open(key, dir, text) {
  try {
    const f = JSON.parse(text); const raw = Buffer.from(f.c, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(f.n, 'base64'));
    d.setAAD(Buffer.from(dir)); d.setAuthTag(raw.subarray(raw.length - 16));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'));
  } catch { return null; }
}

// ---- mailbox transport (ntfy compatible) ----
async function publish(topic, text) {
  try { await fetch(`${RELAY}/${topic}`, { method: 'POST', body: text, signal: AbortSignal.timeout(15_000) }); } catch (e) { log('publish failed: ' + e.message); }
}
function subscribe(topic, onMessage) {          // returns stop()
  let stopped = false, ctl = null, since = String(Math.floor(Date.now() / 1000) - 2);
  (async () => {
    while (!stopped) {
      try {
        ctl = new AbortController();
        const r = await fetch(`${RELAY}/${topic}/json?since=${since}`, { signal: ctl.signal });
        const dec = new TextDecoder(); let buf = '';
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true }); let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
            try { const m = JSON.parse(line); if (m.id) since = m.id; if (m.event === 'message' && typeof m.message === 'string') onMessage(m.message); } catch {}
          }
        }
      } catch (e) { if (stopped) return; }
      if (!stopped) await new Promise(r => setTimeout(r, 3000));
    }
  })();
  return () => { stopped = true; try { ctl && ctl.abort(); } catch {} };
}

let PORT = 7799, linkIdForToken = () => null, logger = console.log;
const log = m => { try { logger('[relay] ' + m); } catch {} };
const sessions = new Map();                      // topic -> {key, topic, created, linkId, stop, seen:Set}
const handled = new Set();                       // codes already answered

function persist() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const out = [...sessions.values()].filter(s => s.linkId).map(s => ({ topic: s.topic, key: s.key.toString('base64'), linkId: s.linkId }));
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(out), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { log('persist failed: ' + e.message); }
}
function localRequest(method, p, headers, bodyText) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: { 'content-type': 'application/json', ...headers } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', () => resolve({ status: 502, body: '{"error":"local_server_unreachable"}' }));
    req.setTimeout(10_000, () => req.destroy());
    if (bodyText) req.write(bodyText); req.end();
  });
}
function addSession(key, topic, linkId) {
  const s = { key, topic, created: Date.now(), linkId: linkId || null, seen: new Set(), stop: null };
  s.stop = subscribe(topic, text => onFrame(s, text)); sessions.set(topic, s); return s;
}
function dropSession(s) { try { s.stop && s.stop(); } catch {} sessions.delete(s.topic); persist(); }

async function onFrame(s, text) {
  const req = open(s.key, 'p2c', text); if (!req || !req.id || s.seen.has(req.id)) return;   // not for us / replay
  s.seen.add(req.id); if (s.seen.size > 500) s.seen = new Set([...s.seen].slice(-200));
  const url = new URL(String(req.path || ''), 'http://x'); const method = String(req.method || 'GET').toUpperCase();
  let out;
  if (!ALLOWED.some(([m, rx]) => m === method && rx.test(url.pathname))) out = { id: req.id, status: 403, body: '{"error":"not_allowed_remotely"}' };
  else {
    const h = {}; for (const k of ['authorization', 'x-pair-secret']) if (req.headers && req.headers[k]) h[k] = String(req.headers[k]);
    const r = await localRequest(method, url.pathname + url.search, h, req.body ? String(req.body) : '');
    out = { id: req.id, status: r.status, body: r.body };
    if (method === 'GET' && /^\/api\/pair\/status\//.test(url.pathname) && r.status === 200) {      // pairing finished -> remember this link
      try { const j = JSON.parse(r.body); if (j.token) { const id = linkIdForToken(j.token); if (id) { s.linkId = id; persist(); } } } catch {}
    }
    if (url.pathname === '/api/device/unlink' && r.status === 200) setTimeout(() => dropSession(s), 1000);
  }
  await publish(s.topic, seal(s.key, 'c2p', out));
}

function announceCode(code, expMs) {             // called by the pairing server when a code is created
  const topic = topicP(code); let stop = null;
  const done = () => { try { stop && stop(); } catch {} handled.delete(code); };
  stop = subscribe(topic, async text => {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || m.t !== 'hello' || handled.has(code)) return;
    const peer = Buffer.from(String(m.pk || ''), 'base64'); if (peer.length !== 65 || peer[0] !== 4) return;
    handled.add(code);
    try {
      const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); const z = ecdh.computeSecret(peer);
      const sid = crypto.randomBytes(8).toString('hex');
      const key = hkdf(z, 'key:' + sid, 32), lt = 'dani-l-' + hkdf(z, 'topic:' + sid, 16).toString('hex');
      addSession(key, lt, null);
      await publish(topic, JSON.stringify({ v: 1, t: 'welcome', pk: b64(ecdh.getPublicKey()), sid }));
    } catch (e) { log('handshake failed: ' + e.message); }
  });
  setTimeout(done, Math.max(1000, expMs - Date.now() + 5000));
}
function push(linkId, note) {                    // computer -> phone notification
  for (const s of sessions.values()) if (s.linkId === linkId) publish(s.topic, seal(s.key, 'c2p', { push: true, note }));
}
function dropLink(linkId) { for (const s of [...sessions.values()]) if (s.linkId === linkId) dropSession(s); }

function start(opts) {
  PORT = opts.port || PORT; linkIdForToken = opts.linkIdForToken || linkIdForToken; if (opts.log) logger = opts.log;
  try { for (const x of JSON.parse(fs.readFileSync(FILE, 'utf8'))) addSession(Buffer.from(x.key, 'base64'), x.topic, x.linkId); } catch {}
  setInterval(() => { for (const s of [...sessions.values()]) if (!s.linkId && Date.now() - s.created > UNLINKED_TTL) dropSession(s); }, 60_000).unref();
  log(`relay ${RELAY}, ${sessions.size} saved session(s)`);
}
module.exports = { start, announceCode, push, dropLink, _test: { seal, open, topicP } };
