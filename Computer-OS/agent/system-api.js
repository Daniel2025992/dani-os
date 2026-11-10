/* System API of the DANI agent: files + trash, task manager, terminal, system info, power, volume.
 * Everything runs as the DANI desktop user (never root) and file access is confined to that user's home folder.
 * In dev mode (not REAL) it works on the current user's DANI_HOME / home, so it is safe to test anywhere.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFile, spawn } = require('child_process');

const REAL = process.env.DANI_REAL === '1' && process.getuid && process.getuid() === 0;

function sessionUser() {
  if (!REAL) { const home = process.env.DANI_HOME || os.homedir(); return { user: os.userInfo().username, uid: process.getuid(), home }; }
  try {
    const uid = fs.readdirSync('/run/user').find(u => /^\d+$/.test(u) && +u >= 1000);
    if (uid) { const line = require('child_process').execFileSync('getent', ['passwd', uid]).toString().split(':'); return { user: line[0], uid: +uid, home: line[5] }; }
  } catch {}
  return { user: 'dani', uid: 1500, home: '/home/dani' };
}
const U = () => sessionUser();
const asUser = (u, cmd, args) => REAL ? ['runuser', ['-u', u.user, '--', cmd, ...args]] : [cmd, args];

function safe(p) {                                   // resolve a user-supplied path, must stay inside the home folder
  const home = U().home; const abs = path.resolve(home, '.' + path.sep + String(p || '').replace(/^\/+/, ''));
  let real = abs; try { real = fs.realpathSync(abs); } catch {}
  const h = fs.realpathSync(home);
  if (real !== h && !real.startsWith(h + path.sep)) throw new Error('outside_home');
  return abs;
}
const rel = abs => '/' + path.relative(U().home, abs).split(path.sep).join('/');
function chownLike(p) { if (REAL) { try { const st = fs.statSync(U().home); fs.chownSync(p, st.uid, st.gid); } catch {} } }
function ensureDirs() {
  const h = U().home;
  for (const d of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', '.dani-trash']) { const p = path.join(h, d); if (!fs.existsSync(p)) { try { fs.mkdirSync(p, { recursive: true }); chownLike(p); } catch {} } }
}
const TRASH = () => path.join(U().home, '.dani-trash'), META = () => path.join(TRASH(), '.meta.json');
const readMeta = () => { try { return JSON.parse(fs.readFileSync(META(), 'utf8')); } catch { return {}; } };
const writeMeta = m => { fs.writeFileSync(META(), JSON.stringify(m)); chownLike(META()); };

const exec = (cmd, args, opts = {}) => new Promise(r => execFile(cmd, args, { timeout: opts.timeout || 15000, maxBuffer: 1 << 20, cwd: opts.cwd, env: opts.env || process.env }, (err, out, errout) => r({ ok: !err, out: String(out || ''), err: String(errout || ''), code: err && err.code })));

async function handle(req, res, url, b, send) {
  const p = url.pathname; const m = req.method;
  try {
    if (!p.startsWith('/api/fs/') && !p.startsWith('/api/term/') && !p.startsWith('/api/ps') && !p.startsWith('/api/sys/')) return false;
    ensureDirs();

    // ---------- files ----------
    if (m === 'GET' && p === '/api/fs/list') {
      const abs = safe(url.searchParams.get('path') || '/');
      const items = fs.readdirSync(abs, { withFileTypes: true }).filter(d => !d.name.startsWith('.')).map(d => {
        let st = {}; try { st = fs.statSync(path.join(abs, d.name)); } catch {}
        return { name: d.name, dir: d.isDirectory(), size: st.size || 0, mtime: st.mtimeMs || 0 };
      }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'he'));
      return send(res, 200, { path: rel(abs), items }), true;
    }
    if (m === 'GET' && p === '/api/fs/read') {                       // text preview (also used by notes)
      const abs = safe(url.searchParams.get('path')); const st = fs.statSync(abs); if (st.size > 300_000) return send(res, 413, { error: 'too_big' }), true;
      return send(res, 200, { text: fs.readFileSync(abs, 'utf8') }), true;
    }
    if (m === 'GET' && p === '/api/fs/raw') {                        // media (images/audio/video) streamed with Range support
      const abs = safe(url.searchParams.get('path')); const st = fs.statSync(abs); if (!st.isFile()) return send(res, 400, { error: 'not_file' }), true;
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' };
      const ct = types[path.extname(abs).toLowerCase()] || 'application/octet-stream'; const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      const h = { 'content-type': ct, 'accept-ranges': 'bytes' }; if (res.getHeader('access-control-allow-origin')) h['access-control-allow-origin'] = res.getHeader('access-control-allow-origin');
      if (range) {
        const s = range[1] ? +range[1] : 0, e = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
        res.writeHead(206, { ...h, 'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1 }); fs.createReadStream(abs, { start: s, end: e }).pipe(res);
      } else { res.writeHead(200, { ...h, 'content-length': st.size }); fs.createReadStream(abs).pipe(res); }
      return true;
    }
    if (m === 'POST' && p === '/api/fs/write') {
      const abs = safe(b.path); if (Buffer.byteLength(String(b.text || '')) > 300_000) return send(res, 413, { error: 'too_big' }), true;
      fs.writeFileSync(abs, String(b.text || '')); chownLike(abs); return send(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/fs/mkdir') { const abs = safe(b.path); fs.mkdirSync(abs, { recursive: true }); chownLike(abs); return send(res, 200, { ok: true }), true; }
    if (m === 'POST' && p === '/api/fs/rename') {
      const from = safe(b.from), to = safe(b.to); if (fs.existsSync(to)) return send(res, 409, { error: 'exists' }), true; fs.renameSync(from, to); return send(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/fs/trash') {                       // "delete" = move to the recycle bin, never destroys data
      const abs = safe(b.path); if (rel(abs) === '/' || abs.startsWith(TRASH())) return send(res, 400, { error: 'not_allowed' }), true;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); fs.renameSync(abs, path.join(TRASH(), id));
      const meta = readMeta(); meta[id] = { name: path.basename(abs), from: rel(abs), ts: Date.now() }; writeMeta(meta); return send(res, 200, { ok: true }), true;
    }
    if (m === 'GET' && p === '/api/fs/trash') { const meta = readMeta(); return send(res, 200, { items: Object.entries(meta).filter(([id]) => fs.existsSync(path.join(TRASH(), id))).map(([id, v]) => ({ id, ...v })) }), true; }
    if (m === 'POST' && p === '/api/fs/trash/restore') {
      const meta = readMeta(), e = meta[b.id]; if (!e) return send(res, 404, { error: 'not_found' }), true;
      let to = safe(e.from); if (fs.existsSync(to)) to += '.restored';
      fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(path.join(TRASH(), b.id), to); delete meta[b.id]; writeMeta(meta); return send(res, 200, { ok: true, path: rel(to) }), true;
    }
    if (m === 'POST' && p === '/api/fs/trash/empty') {
      const meta = readMeta(); for (const id of Object.keys(meta)) { try { fs.rmSync(path.join(TRASH(), id), { recursive: true, force: true }); } catch {} } writeMeta({}); return send(res, 200, { ok: true }), true;
    }

    // ---------- task manager ----------
    if (m === 'GET' && p === '/api/ps') {
      const r = await exec('ps', ['-eo', 'pid,user:12,pcpu,pmem,rss,etimes,comm', '--sort=-pcpu']);
      const rows = r.out.split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(a => a.length >= 7).slice(0, 60).map(a => ({ pid: +a[0], user: a[1], cpu: +a[2], mem: +a[3], rssMB: Math.round(+a[4] / 1024), secs: +a[5], name: a.slice(6).join(' ') }));
      return send(res, 200, { processes: rows, user: U().user }), true;
    }
    if (m === 'POST' && p === '/api/ps/kill') {
      const pid = +b.pid; if (!Number.isInteger(pid) || pid < 2) return send(res, 400, { error: 'bad_pid' }), true;
      const owner = (await exec('ps', ['-o', 'user:32=', '-p', String(pid)])).out.trim();
      if (owner !== U().user) return send(res, 403, { error: 'only_your_apps' }), true;      // system processes are protected
      try { process.kill(pid, 'SIGTERM'); setTimeout(() => { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} }, 2500); return send(res, 200, { ok: true }), true; }
      catch (e) { return send(res, 200, { ok: false, msg: e.message }), true; }
    }

    // ---------- terminal (runs as the desktop user, in the home folder) ----------
    if (m === 'POST' && p === '/api/term/exec') {
      const u = U(); let cwd; try { cwd = safe(b.cwd || '/'); } catch { cwd = u.home; }
      const script = String(b.cmd || '').slice(0, 2000) + '\n__c=$?\necho "__DANI_CWD__$PWD"\nexit $__c';
      const [cmd, args] = asUser(u, 'bash', ['-c', script]);
      const r = await exec(cmd, args, { cwd, timeout: 20000, env: { ...process.env, HOME: u.home, TERM: 'dumb', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' } });
      let out = r.out, newCwd = cwd; const i = out.lastIndexOf('__DANI_CWD__'); if (i >= 0) { newCwd = out.slice(i + 12).trim(); out = out.slice(0, i); }
      const hh = u.home.replace(/\/+$/, ''); let relCwd = '/';
      try { const rc = fs.realpathSync(newCwd), rh = fs.realpathSync(hh); if (rc === rh) relCwd = '/'; else if (rc.startsWith(rh + path.sep)) relCwd = rc.slice(rh.length); } catch {}
      return send(res, 200, { out: (out + r.err).slice(0, 20000), cwd: relCwd, home: u.home, code: r.code || 0 }), true;
    }

    // ---------- system ----------
    if (m === 'GET' && p === '/api/sys/info') {
      const df = await exec('df', ['-k', '--output=size,used', U().home]); const d = df.out.trim().split('\n')[1] || ''; const [size, used] = d.trim().split(/\s+/).map(Number);
      return send(res, 200, { host: os.hostname(), user: U().user, uptime: os.uptime(), load: os.loadavg()[0], cpus: os.cpus().length, memTotalMB: Math.round(os.totalmem() / 1048576), memFreeMB: Math.round(os.freemem() / 1048576), diskGB: Math.round((size || 0) / 1048576), diskUsedGB: Math.round((used || 0) / 1048576), real: REAL }), true;
    }
    if (m === 'GET' && p === '/api/sys/volume') {
      if (!REAL) return send(res, 200, { volume: 50, muted: false, dev: true }), true;
      const r = await exec('runuser', ['-u', U().user, '--', 'env', 'XDG_RUNTIME_DIR=/run/user/' + U().uid, 'wpctl', 'get-volume', '@DEFAULT_AUDIO_SINK@']);
      const mm = /([\d.]+)/.exec(r.out); return send(res, 200, { volume: mm ? Math.round(parseFloat(mm[1]) * 100) : 50, muted: /MUTED/.test(r.out) }), true;
    }
    if (m === 'POST' && p === '/api/sys/volume') {
      const v = Math.max(0, Math.min(100, Math.round(+b.volume))); if (!REAL) return send(res, 200, { ok: true, dev: true }), true;
      await exec('runuser', ['-u', U().user, '--', 'env', 'XDG_RUNTIME_DIR=/run/user/' + U().uid, 'wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', v + '%']); return send(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/sys/power') {
      if (!['reboot', 'poweroff'].includes(b.action)) return send(res, 400, { error: 'bad_action' }), true;
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח – לא מבוצע' }), true;
      send(res, 200, { ok: true }); setTimeout(() => spawn('systemctl', [b.action], { detached: true, stdio: 'ignore' }).unref(), 500); return true;
    }
    return false;
  } catch (e) { send(res, e.message === 'outside_home' ? 403 : 400, { error: e.message }); return true; }
}

/* Binary upload (the "add" buttons in the music / video / gallery apps): POST /api/fs/upload?dir=/Music&name=song.mp3, raw body, up to 2 GB.
 * Never overwrites: an existing name gets " (2)", " (3)"... */
function upload(req, res, url, json) {
  let abs, dir, name;
  try {
    dir = safe(url.searchParams.get('dir') || '/Downloads'); name = path.basename(String(url.searchParams.get('name') || '')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
    if (!name || name.startsWith('.')) throw new Error('bad_name');
    fs.mkdirSync(dir, { recursive: true }); chownLike(dir);
  } catch (e) { req.resume(); return json(res, 400, { ok: false, error: e.message }); }
  const ext = path.extname(name), stem = path.basename(name, ext); let n = 1, out = path.join(dir, name);
  while (fs.existsSync(out)) out = path.join(dir, `${stem} (${++n})${ext}`);
  const ws = fs.createWriteStream(out, { flags: 'wx' }); let size = 0, dead = false; const MAX = 2 * 1024 ** 3;
  req.on('data', c => { size += c.length; if (size > MAX && !dead) { dead = true; req.unpipe(ws); ws.destroy(); try { fs.unlinkSync(out); } catch { } json(res, 413, { ok: false, error: 'too_big' }); req.destroy(); } });
  req.pipe(ws);
  ws.on('finish', () => { if (dead) return; chownLike(out); json(res, 200, { ok: true, path: rel(out), name: path.basename(out), size }); });
  ws.on('error', e => { if (!dead) { dead = true; json(res, 500, { ok: false, error: e.code || 'write_failed' }); } });
}

module.exports = { handle, upload };
