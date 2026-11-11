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
/* ---- updates: the DANI OS programs (shell, agent, apps, phone bridge) are replaced from the newest GitHub release; system packages via apt ---- */
const REPO = 'Daniel2025992/dani-os', ROOT = path.join(__dirname, '../..');
const curBuild = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'Shared/build.json'), 'utf8')).build | 0; } catch { return 0; } };
async function latestRelease() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'user-agent': 'dani-os' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('http_' + r.status); const j = await r.json(); const m = /^build-(\d+)$/.exec(j.tag_name || ''); if (!m) throw new Error('bad_tag');
  return { build: +m[1], name: j.name || j.tag_name, notes: String(j.body || '').slice(0, 600) };
}
async function selfUpdate() {
  const l = await latestRelease(), cur = curBuild(); let msg = [];
  if (l.build > cur) {
    const tmp = fs.mkdtempSync('/var/tmp/dani-upd-'), tgz = path.join(tmp, 'src.tgz'), st = path.join(tmp, 'src'); fs.mkdirSync(st);
    const r = await fetch(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/build-${l.build}`, { headers: { 'user-agent': 'dani-os' }, signal: AbortSignal.timeout(5 * 60_000) });
    if (!r.ok) throw new Error('הורדה נכשלה (' + r.status + ')'); fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
    const x = await run('tar', ['xzf', tgz, '-C', st, '--strip-components=1']); if (!x.ok) throw new Error('פריסת הארכיון נכשלה');
    for (const must of ['Computer-OS/agent/agent.js', 'Computer-OS/shell/index.html', 'Shared/pairing-server.js']) if (!fs.existsSync(path.join(st, must))) throw new Error('הגרסה שהורדה לא תקינה');
    for (const d of ['Computer-OS', 'Shared']) { const c = await run('cp', ['-a', path.join(st, d) + '/.', path.join(ROOT, d) + '/']); if (!c.ok) throw new Error('העתקה נכשלה: ' + c.out.slice(-200)); }
    fs.writeFileSync(path.join(ROOT, 'Shared/build.json'), JSON.stringify({ build: l.build }) + '\n'); fs.rmSync(tmp, { recursive: true, force: true });
    msg.push(`תוכנת DANI OS עודכנה מ-build ${cur} ל-build ${l.build}.`);
  } else msg.push('תוכנת DANI OS כבר עדכנית (build ' + cur + ').');
  const u = await run('apt-get', ['update']); if (u.ok) { const g = await run('apt-get', ['-y', 'upgrade']); msg.push(g.ok ? 'חבילות המערכת עודכנו.' : 'עדכון חבילות המערכת נכשל.'); } else msg.push('חבילות המערכת לא עודכנו (אין חיבור למאגר).');
  return { ok: true, msg: msg.join(' ') + ' הפעל מחדש כדי להחיל הכול.', needReboot: true };
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
const json = (res, c, o) => { res.writeHead(c, { 'content-type': 'application/json', 'access-control-allow-origin': res.getHeader('access-control-allow-origin') || 'null', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(JSON.stringify(o)); };

// Only the DANI shell itself may talk to this agent: websites opened in the browser (other origins) and DNS-rebinding tricks are refused.
const ORIGINS = new Set(['http://127.0.0.1:17788', 'http://localhost:17788', ...(process.env.DANI_ORIGINS || '').split(',').filter(Boolean)]);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const sysapi = require('./system-api');
http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (!HOSTS.has(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  if (origin ? !ORIGINS.has(origin) : req.method !== 'GET') { res.writeHead(403); return res.end(); }   // no Origin = plain <img>/<video> GET or a local tool; never a cross-site write
  if (origin) res.setHeader('access-control-allow-origin', origin);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'POST' && req.url.startsWith('/api/fs/upload?')) return sysapi.upload(req, res, new URL(req.url, 'http://x'), json);
  let d = ''; req.on('data', c => { d += c; if (d.length > 400_000) req.destroy(); });
  req.on('end', async () => {
    let b = {}; try { b = d ? JSON.parse(d) : {}; } catch {}
    if (await sysapi.handle(req, res, new URL(req.url, 'http://x'), b, json)) return;
    if (await require('./settings-api').handle(req, res, new URL(req.url, 'http://x'), b, json)) return;
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
    if (req.method === 'POST' && req.url === '/api/apt/status') {       // which store packages are really installed (dpkg), so the store never lies
      if (!REAL) return json(res, 200, { ok: true, real: false, installed: [] });
      const r = await run('dpkg-query', ['-W', '-f', '${Package} ${db:Status-Abbrev}\n']);
      const have = new Set(r.out.split('\n').filter(l => / ii\s*$/.test(l)).map(l => l.split(' ')[0]));
      return json(res, 200, { ok: true, real: true, installed: [...allowed].filter(p => have.has(p)) });
    }
    if (req.method === 'POST' && req.url === '/api/system/check') {      // compare this build with the newest GitHub release
      try { const l = await latestRelease(); return json(res, 200, { ok: true, current: curBuild(), latest: l.build, name: l.name, notes: l.notes, newer: l.build > curBuild() }); }
      catch (e) { return json(res, 200, { ok: false, current: curBuild(), msg: 'לא ניתן להגיע ל-GitHub (אין אינטרנט?)' }); }
    }
    if (req.method === 'POST' && req.url === '/api/system/update') {
      if (!REAL) return json(res, 200, { ok: false, msg: 'מצב פיתוח – העדכון לא הותקן (נדרש root ו-DANI_REAL=1 בתוך המערכת המותקנת).' });
      try { return json(res, 200, await selfUpdate()); } catch (e) { return json(res, 200, { ok: false, msg: 'העדכון נכשל: ' + e.message }); }
    }
    json(res, 404, { error: 'not_found' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`DANI agent :${PORT} real=${REAL}`));
