// Integration test for the code-only pairing flow. Run: node Shared/test-pairing.js
'use strict';
process.env.DANI_DATA = require('fs').mkdtempSync(require('os').tmpdir() + '/dani-');
const assert = require('assert');
const { server } = require('./pairing-server');

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (p, { method = 'POST', body, secret, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(secret ? { 'x-pair-secret': secret } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    assert.equal((await call('/api/hello', { method: 'GET' })).dani, true);
    const st = await call('/api/pair/start');                       // loopback == the computer itself
    assert(/^\d{6}$/.test(st.code) && st.secret);
    assert.equal((await call('/api/pair/claim', { body: { code: '000000' } })).status, 404, 'wrong code');
    const cl = await call('/api/pair/claim', { body: { code: st.code, deviceName: 'Pixel' } });
    assert.equal(cl.state, 'awaiting_approval');
    assert.equal((await call('/api/pair/claim', { body: { code: st.code } })).status, 404, 'code must be single use');
    // without a secret nobody can see or change the pairing
    assert.equal((await call('/api/pair/status/' + st.pairId, { method: 'GET' })).status, 404);
    assert.equal((await call('/api/pair/approve/' + st.pairId, { secret: cl.secret })).status, 403, 'phone must not approve for the computer');
    // both sides required
    assert.equal((await call('/api/pair/approve/' + st.pairId, { secret: st.secret })).state, 'awaiting_approval');
    const s1 = await call('/api/pair/status/' + st.pairId, { method: 'GET', secret: st.secret });
    assert.equal(s1.deviceName, 'Pixel'); assert(!s1.token);
    assert.equal((await call('/api/pair/confirm/' + st.pairId, { secret: cl.secret })).state, 'paired');
    // each side receives its token exactly once
    const cTok = (await call('/api/pair/status/' + st.pairId, { method: 'GET', secret: st.secret })).token;
    const pTok = (await call('/api/pair/status/' + st.pairId, { method: 'GET', secret: cl.secret })).token;
    assert(cTok && pTok && cTok !== pTok);
    assert(!(await call('/api/pair/status/' + st.pairId, { method: 'GET', secret: cl.secret })).token, 'token handed out twice');
    // tokens are stored hashed
    const raw = require('fs').readFileSync(process.env.DANI_DATA + '/links.json', 'utf8');
    assert(!raw.includes(cTok) && !raw.includes(pTok), 'plain token on disk');
    // notifications computer -> phone
    assert.equal((await call('/api/device/status', { method: 'GET', token: pTok })).paired, true);
    await call('/api/notify', { token: cTok, body: { title: 'Hi', body: 'from PC' } });
    assert.equal((await call('/api/notifications?since=0', { method: 'GET', token: pTok })).items[0].title, 'Hi');
    assert.equal((await call('/api/notify', { token: pTok, body: { title: 'x' } })).status, 403);
    assert.equal((await call('/api/notifications', { method: 'GET' })).status, 401);
    // unlink
    await call('/api/device/unlink', { token: pTok });
    assert.equal((await call('/api/device/status', { method: 'GET', token: pTok })).status, 401);
    console.log('ALL PAIRING TESTS PASSED');
  } catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; }
  server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100);
});
