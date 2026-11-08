#!/usr/bin/env node
/*
 * DANI OS system agent — local privileged helper for the shell (127.0.0.1 only).
 * - POST /api/apt/install {package}   : only packages that appear as "native" in Shared/catalog.json
 * - POST /api/system/update           : apt update + upgrade
 * Real changes happen only when run as root with DANI_REAL=1 (inside an installed DANI OS).
 * Anywhere else (dev machine) it answers in dev mode and changes nothing.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { execFile } = require('child_process');
const PORT = +process.env.AGENT_PORT || 7788;
const REAL = process.env.DANI_REAL === '1' && process.getuid && process.getuid() === 0;
const catalog = JSON.parse(fs.readFileSync(process.env.DANI_CATALOG || path.join(__dirname, '../../Shared/catalog.json'), 'utf8'));
const allowed = new Set(catalog.apps.filter(a => a.type === 'native').map(a => a.package));

const run = (cmd, args) => new Promise(r => execFile(cmd, args, { timeout: 15 * 60_000, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } }, (err, out, errout) => r({ ok: !err, out: (out + errout).slice(-4000) })));
const fs2 = require('fs');
let listsFresh = false;
async function prepareApt(pkg) {            // live-build images ship with empty package lists, so refresh them once before installing
  if (pkg === 'steam-installer') { await run('dpkg', ['--add-architecture', 'i386']); listsFresh = false; }
  if (!listsFresh) { const u = await run('apt-get', ['update']); if (!u.ok) return u; listsFresh = true; }
  return { ok: true, out: '' };
}
function launch(cmd) {
  try {
    const base = '/run/user'; const uid = fs2.readdirSync(base).find(u => /^\d+$/.test(u) && +u >= 1000 && fs2.readdirSync(base + '/' + u).some(f => /^wayland-\d+$/.test(f)));
    if (!uid) return { ok: false, msg: 'לא נמצא שולחן עבודה פעיל' };
    const sock = fs2.readdirSync(base + '/' + uid).find(f => /^wayland-\d+$/.test(f));
    const user = require('child_process').execFileSync('getent', ['passwd', uid]).toString().split(':')[0];
    const p = require('child_process').spawn('runuser', ['-u', user, '--', 'env', 'XDG_RUNTIME_DIR=' + base + '/' + uid, 'WAYLAND_DISPLAY=' + sock, 'DISPLAY=:0', cmd], { detached: true, stdio: 'ignore' });
    p.unref(); return { ok: true, msg: 'נפתח' };
  } catch (e) { return { ok: false, msg: 'הפתיחה נכשלה: ' + e.message }; }
}
const json = (res, c, o) => { res.writeHead(c, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(JSON.stringify(o)); };

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  let d = ''; req.on('data', c => { d += c; if (d.length > 5000) req.destroy(); });
  req.on('end', async () => {
    let b = {}; try { b = d ? JSON.parse(d) : {}; } catch {}
    if (req.method === 'GET' && req.url === '/api/netinfo') {   // LAN addresses, shown as a manual fallback for phone pairing
      const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
      return json(res, 200, { ips });
    }
    if (req.method === 'POST' && req.url === '/api/apt/install') {
      if (!allowed.has(b.package)) return json(res, 403, { ok: false, msg: 'חבילה לא מורשית' });
      if (!REAL) return json(res, 200, { ok: false, msg: `מצב פיתוח – לא הותקן apt:${b.package}` });
      const pre = await prepareApt(b.package); if (!pre.ok) return json(res, 200, { ok: false, msg: 'אין חיבור לאינטרנט או שמאגר החבילות לא זמין: ' + pre.out.slice(-300) });
      const r = await run('apt-get', ['install', '-y', '--no-install-recommends', b.package]); return json(res, 200, { ok: r.ok, msg: r.ok ? 'הותקן' : r.out.slice(-400) });
    }
    if (req.method === 'POST' && req.url === '/api/apt/remove') {
      if (!allowed.has(b.package)) return json(res, 403, { ok: false, msg: 'חבילה לא מורשית' });
      if (!REAL) return json(res, 200, { ok: true, msg: 'מצב פיתוח' });
      const r = await run('apt-get', ['remove', '-y', b.package]); return json(res, 200, { ok: r.ok, msg: r.ok ? 'הוסר' : r.out.slice(-400) });
    }
    if (req.method === 'POST' && req.url === '/api/app/launch') {       // open an installed native app on the DANI desktop session
      const a = catalog.apps.find(x => x.type === 'native' && x.package === b.package);
      if (!a || !a.exec) return json(res, 403, { ok: false, msg: 'אפליקציה לא מורשית' });
      if (!REAL) return json(res, 200, { ok: false, msg: 'מצב פיתוח – לא נפתח' });
      return json(res, 200, launch(a.exec));
    }
    if (req.method === 'POST' && req.url === '/api/system/update') {
      if (!REAL) return json(res, 200, { ok: false, msg: 'מצב פיתוח – העדכון לא הותקן (נדרש root ו-DANI_REAL=1 בתוך המערכת המותקנת).' });
      const u = await run('apt-get', ['update']); if (!u.ok) return json(res, 200, { ok: false, msg: u.out });
      const g = await run('apt-get', ['-y', 'upgrade']); return json(res, 200, { ok: g.ok, msg: g.ok ? 'העדכון הותקן. מומלץ להפעיל מחדש.' : g.out });
    }
    json(res, 404, { error: 'not_found' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`DANI agent :${PORT} real=${REAL}`));
