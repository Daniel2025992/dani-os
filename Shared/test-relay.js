// End-to-end test of code-only pairing over the relay (no shared network): mock ntfy + real pairing server + real phone client code.
'use strict';
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');

// ---- minimal ntfy-compatible mock ----
const topics = new Map(); let seq = 0;
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const m = /^\/([\w-]+)(\/json)?$/.exec(u.pathname);
  if (!m) { res.writeHead(404); return res.end(); }
  const t = topics.get(m[1]) || { msgs: [], subs: new Set() }; topics.set(m[1], t);
  if (req.method === 'POST') {
    let d = ''; req.on('data', c => d += c); req.on('end', () => {
      const msg = { id: 'm' + (++seq), time: Math.floor(Date.now() / 1000), event: 'message', topic: m[1], message: d };
      t.msgs.push(msg); for (const s of t.subs) s.write(JSON.stringify(msg) + '\n'); res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(msg));
    }); return;
  }
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'access-control-allow-origin': '*' });
  const since = u.searchParams.get('since') || 'all'; res.write(JSON.stringify({ id: 'o' + (++seq), event: 'open' }) + '\n');
  for (const msg of t.msgs) { if (/^m\d+$/.test(since) ? +msg.id.slice(1) > +since.slice(1) : (/^\d+$/.test(since) ? msg.time >= +since : true)) res.write(JSON.stringify(msg) + '\n'); }
  t.subs.add(res); req.on('close', () => t.subs.delete(res));
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = (port, method, p, body, headers) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'content-type': 'application/json', ...(headers || {}) } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, json: d ? JSON.parse(d) : {} })); });
  r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
});

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r)); const relay = 'http://127.0.0.1:' + mock.address().port;
  process.env.DANI_RELAY = relay;
  const PORT = 17990, DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dani-relay-'));
  const srv = spawn(process.execPath, [path.join(__dirname, 'pairing-server.js')], { env: { ...process.env, PORT, DANI_DATA: DATA, DANI_RELAY: relay }, stdio: ['ignore', 'pipe', 'inherit'] });
  await sleep(1200);
  const phone = require('../Mobile-App/app/src/main/assets/relay-client.js');
  try {
    // 1. computer shows a code
    const start = (await call(PORT, 'POST', '/api/pair/start')).json; assert(/^\d{6}$/.test(start.code)); console.log('code', start.code);

    // 2. a wrong code finds nobody
    await assert.rejects(phone.connect({ relay, code: '000000' === start.code ? '111111' : '000000' }).then(s => { s.close(); }), /no_computer/);
    // (the rejected attempt waits ~12 s; fine)

    // 3. the phone connects with the real code, no network in common
    const s = await phone.connect({ relay, code: start.code }); console.log('encrypted channel open');

    // 4. things a remote phone must NOT be able to do
    await assert.rejects(s.call('POST', '/api/pair/start'), e => e.status === 403);
    await assert.rejects(s.call('POST', '/api/pair/approve/' + start.pairId, null, { 'x-pair-secret': start.secret }), e => e.status === 403);

    // 5. normal pairing flow, tunnelled
    const claim = await s.call('POST', '/api/pair/claim', { code: start.code, deviceName: 'Test phone' }); assert.strictEqual(claim.state, 'awaiting_approval');
    assert.strictEqual((await call(PORT, 'POST', '/api/pair/approve/' + start.pairId, null, { 'x-pair-secret': start.secret })).json.state, 'awaiting_approval');   // computer approves
    assert.strictEqual((await s.call('POST', '/api/pair/confirm/' + claim.pairId, null, { 'x-pair-secret': claim.secret })).state, 'paired');                       // phone confirms
    const st = await s.call('GET', '/api/pair/status/' + claim.pairId, null, { 'x-pair-secret': claim.secret }); assert(st.token); console.log('paired, phone token received');
    const info = await s.call('GET', '/api/device/status', null, { authorization: 'Bearer ' + st.token }); assert.strictEqual(info.name, 'Test phone');

    // 6. computer -> phone push
    const got = new Promise(r => s.onPush(r));
    const cst = (await call(PORT, 'GET', '/api/pair/status/' + start.pairId, null, { 'x-pair-secret': start.secret })).json; assert(cst.token);
    await call(PORT, 'POST', '/api/notify', { title: 'Hej', body: 'from computer' }, { authorization: 'Bearer ' + cst.token });
    const note = await Promise.race([got, sleep(8000).then(() => null)]); assert(note && note.title === 'Hej'); console.log('push received:', note.title);

    // 7. the link survives a restart of the bridge (saved session)
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'relay-sessions.json'), 'utf8')); assert.strictEqual(saved.length, 1);
    s.close(); const s2 = await phone.resume(s.export()); await sleep(600);
    assert.strictEqual((await s2.call('GET', '/api/device/status', null, { authorization: 'Bearer ' + st.token })).paired, true); s2.close();
    console.log('ALL RELAY TESTS PASSED');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; }
  srv.kill(); mock.close(); setTimeout(() => process.exit(), 300);
})();
