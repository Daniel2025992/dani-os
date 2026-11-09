/* DANI OS phone relay client: pair with the computer using only the 6-digit code, no shared Wi-Fi.
 * Speaks the protocol described in Shared/relay-bridge.js. Works in the Android WebView and in Node (tests). */
(function (root) {
  'use strict';
  const subtle = (root.crypto && root.crypto.subtle) || require('crypto').webcrypto.subtle;
  const rand = n => (root.crypto || require('crypto').webcrypto).getRandomValues(new Uint8Array(n));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const DEFAULT_RELAY = 'https://ntfy.sh';

  async function hkdf(z, info, len) {
    const k = await subtle.importKey('raw', z, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('dani-relay-v1'), info: enc.encode(info) }, k, len * 8));
  }
  async function topicP(code) { return 'dani-p-' + hex(new Uint8Array(await subtle.digest('SHA-256', enc.encode('dani-pair-v1:' + code)))).slice(0, 32); }

  async function publish(relay, topic, text) {
    const r = await fetch(relay + '/' + topic, { method: 'POST', body: text }); if (!r.ok) throw new Error('relay_publish_' + r.status);
  }
  function subscribe(relay, topic, onMessage) {            // returns stop()
    let stopped = false, ctl = null, since = String(Math.floor(Date.now() / 1000) - 2);
    (async () => {
      while (!stopped) {
        try {
          ctl = new AbortController();
          const r = await fetch(relay + '/' + topic + '/json?since=' + since, { signal: ctl.signal });
          const reader = r.body.getReader(), d = new TextDecoder(); let buf = '';
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            buf += d.decode(value, { stream: true }); let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
              try { const m = JSON.parse(line); if (m.id) since = m.id; if (m.event === 'message' && typeof m.message === 'string') onMessage(m.message); } catch (e) {}
            }
          }
        } catch (e) { if (stopped) return; }
        if (!stopped) await sleep(3000);
      }
    })();
    return () => { stopped = true; try { ctl && ctl.abort(); } catch (e) {} };
  }

  async function seal(key, dir, obj) {
    const n = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: n, additionalData: enc.encode(dir) }, key, enc.encode(JSON.stringify(obj))));
    return JSON.stringify({ v: 1, n: b64(n), c: b64(ct) });
  }
  async function open(key, dir, text) {
    try {
      const f = JSON.parse(text);
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.n), additionalData: enc.encode(dir) }, key, unb64(f.c));
      return JSON.parse(dec.decode(pt));
    } catch (e) { return null; }
  }

  function makeSession(relay, keyBytes, topic, key) {
    const waiting = new Map(); let pushCb = null;
    const stop = subscribe(relay, topic, async text => {
      const m = await open(key, 'c2p', text); if (!m) return;                    // own messages / garbage fail to open and are ignored
      if (m.push) { if (pushCb) pushCb(m.note); return; }
      const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); }
    });
    return {
      topic,
      onPush(cb) { pushCb = cb; },
      async call(method, path, body, headers, timeoutMs) {
        const id = hex(rand(8));
        const p = new Promise((res, rej) => { waiting.set(id, res); setTimeout(() => { if (waiting.delete(id)) rej(new Error('relay_timeout')); }, timeoutMs || 25000); });
        await publish(relay, topic, await seal(key, 'p2c', { id, method, path, headers: headers || {}, body: body ? JSON.stringify(body) : '' }));
        const r = await p; let j = {}; try { j = JSON.parse(r.body); } catch (e) {}
        if (r.status >= 400) { const e = new Error(j.error || ('http_' + r.status)); e.status = r.status; throw e; }
        return j;
      },
      // encrypted file attachment (ntfy PUT). Layout matches Shared/relay-bridge.js: 4-byte length + data, padded to >= 4.2 KB, AES-GCM, AAD "file"
      async putFile(bytes) {
        const n = rand(12); const plain = new Uint8Array(Math.max(4200, 4 + bytes.length)); new DataView(plain.buffer).setUint32(0, bytes.length); plain.set(bytes, 4);
        const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: n, additionalData: enc.encode('file') }, key, plain));
        const r = await fetch(relay + '/' + topic, { method: 'PUT', body: ct, headers: { Filename: 'dani.bin' } }); const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.attachment || !j.attachment.url) throw new Error('blob_upload_failed'); return { url: j.attachment.url, nonce: b64(n) };
      },
      async getFile(f) {
        if (!String(f.url).startsWith(relay + '/')) throw new Error('blob_url_not_allowed');
        const r = await fetch(f.url); if (!r.ok) throw new Error('blob_download_failed');
        const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.nonce), additionalData: enc.encode('file') }, key, await r.arrayBuffer()));
        return pt.subarray(4, 4 + new DataView(pt.buffer, pt.byteOffset).getUint32(0));
      },
      export() { return { relay, topic, key: b64(keyBytes) }; },
      close() { stop(); },
    };
  }
  async function importKey(bytes) { return subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }

  // pair: find the computer that is showing `code` and open an encrypted channel to it
  async function connect(opts) {
    const relay = (opts.relay || DEFAULT_RELAY).replace(/\/+$/, ''); const code = String(opts.code);
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    const tp = await topicP(code); let welcome = null;
    const stop = subscribe(relay, tp, text => { try { const m = JSON.parse(text); if (m.t === 'welcome' && !welcome) welcome = m; } catch (e) {} });
    try {
      await sleep(600);                                      // let the subscription open first
      await publish(relay, tp, JSON.stringify({ v: 1, t: 'hello', pk: b64(pub) }));
      for (let i = 0; i < 40 && !welcome; i++) await sleep(300);
      if (!welcome) throw new Error('no_computer');
      const peer = await subtle.importKey('raw', unb64(welcome.pk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const z = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, kp.privateKey, 256));
      const keyBytes = await hkdf(z, 'key:' + welcome.sid, 32), topic = 'dani-l-' + hex(await hkdf(z, 'topic:' + welcome.sid, 16));
      return makeSession(relay, keyBytes, topic, await importKey(keyBytes));
    } finally { stop(); }
  }
  async function resume(saved) { const kb = unb64(saved.key); return makeSession(saved.relay, kb, saved.topic, await importKey(kb)); }

  const api = { connect, resume, DEFAULT_RELAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DaniRelay = api;
})(typeof window !== 'undefined' ? window : globalThis);
