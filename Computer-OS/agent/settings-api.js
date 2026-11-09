/* Settings API of the DANI agent: Wi-Fi/network, Bluetooth, sound, display, keyboard + time zone, accounts.
 * Real mode (DANI_REAL=1, root): nmcli, bluetoothctl, wpctl, wlr-randr, timedatectl, /etc/default/keyboard.
 * Dev mode: returns harmless sample data so the UI can be tested anywhere. Wi-Fi/user passwords are only passed
 * through stdin to nmcli/chpasswd (never on a command line, never written by DANI, never logged).
 * All input is validated (SSID length, MAC address, layout names, time-zone list) before reaching any command.
 */
'use strict';
const fs = require('fs'), os = require('os');
const { execFile, spawn } = require('child_process');
const REAL = process.env.DANI_REAL === '1' && process.getuid && process.getuid() === 0;

function sessionUser() {
  if (!REAL) return { user: os.userInfo().username, uid: process.getuid(), home: os.homedir() };
  try {
    const uid = fs.readdirSync('/run/user').find(u => /^\d+$/.test(u) && +u >= 1000);
    if (uid) { const l = require('child_process').execFileSync('getent', ['passwd', uid]).toString().split(':'); return { user: l[0], uid: +uid, home: l[5] }; }
  } catch {}
  return { user: 'dani', uid: 1500, home: '/home/dani' };
}
const run = (cmd, args, o = {}) => new Promise(r => {
  const c = spawn(cmd, args, { env: o.env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '', done = false;
  const fin = code => { if (done) return; done = true; clearTimeout(t); r({ ok: code === 0, code, out, err }); };
  const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} fin(124); }, o.timeout || 15000);
  c.stdout.on('data', d => { out += d; if (out.length > 1 << 20) c.kill(); }); c.stderr.on('data', d => { err += d; });
  c.on('error', () => fin(127)); c.on('close', fin);
  try { c.stdin.end(o.input || ''); } catch {}
});
const asUser = (cmd, args) => { const u = sessionUser(); const env = { ...process.env, XDG_RUNTIME_DIR: '/run/user/' + u.uid };
  return REAL ? run('runuser', ['-u', u.user, '--', 'env', 'XDG_RUNTIME_DIR=/run/user/' + u.uid, cmd, ...args]) : run(cmd, args, { env }); };

const split = l => { const o = []; let cur = ''; for (let i = 0; i < l.length; i++) { if (l[i] === '\\' && l[i + 1] === ':') { cur += ':'; i++; } else if (l[i] === ':') { o.push(cur); cur = ''; } else cur += l[i]; } o.push(cur); return o; };
const MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const KB_OK = /^[a-z]{2,10}(\([a-z0-9_]+\))?$/;            // xkb layout names: us, il, de, fr, ru, ara, gb ...
const KB_ALLOWED = ['us', 'il', 'ru', 'ara', 'de', 'fr', 'es', 'gb', 'it', 'pt', 'tr', 'ua', 'pl', 'se', 'nl'];
const TZ_OK = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/;

async function handle(req, res, url, b, send) {
  const p = url.pathname, m = req.method;
  if (!/^\/api\/(net|bt|snd|disp|loc|acct)(\/|$)/.test(p)) return false;
  try {
    // ---------------- network ----------------
    if (m === 'GET' && p === '/api/net/status') {
      if (!REAL) return send(res, 200, { dev: true, wifiEnabled: true, wifiDevice: true, connections: [{ type: 'ethernet', name: 'Ethernet (dev)', device: 'eth0' }], ip: '192.168.1.20' }), true;
      const dev = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']);
      const rows = dev.out.split('\n').filter(Boolean).map(split).map(a => ({ device: a[0], type: a[1], state: a[2], name: a[3] }));
      const radio = await run('nmcli', ['radio', 'wifi']);
      const ip = (await run('hostname', ['-I'])).out.trim().split(/\s+/)[0] || '';
      return send(res, 200, { wifiEnabled: /enabled/.test(radio.out), wifiDevice: rows.some(r => r.type === 'wifi'), connections: rows.filter(r => r.state === 'connected' && r.type !== 'loopback'), ip }), true;
    }
    if (m === 'GET' && p === '/api/net/wifi') {
      if (!REAL) return send(res, 200, { dev: true, networks: [{ ssid: 'Home-WiFi', signal: 82, secure: true, active: true }, { ssid: 'Guest', signal: 54, secure: false, active: false }] }), true;
      if (url.searchParams.get('rescan')) await run('nmcli', ['device', 'wifi', 'rescan'], { timeout: 8000 });
      const r = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list']);
      const seen = new Map();
      for (const l of r.out.split('\n').filter(Boolean)) { const a = split(l); if (!a[1]) continue; const n = { ssid: a[1], signal: +a[2] || 0, secure: !!a[3] && a[3] !== '--', active: a[0] === '*' }; const o = seen.get(n.ssid); if (!o || n.active || n.signal > o.signal) seen.set(n.ssid, n); }
      return send(res, 200, { networks: [...seen.values()].sort((x, y) => (y.active - x.active) || (y.signal - x.signal)) }), true;
    }
    if (m === 'POST' && p === '/api/net/wifi/connect') {
      const ssid = String(b.ssid || ''); const pw = String(b.password || '');
      if (!ssid || ssid.length > 32 || /[\0\n]/.test(ssid) || pw.length > 128 || /\0/.test(pw)) return send(res, 400, { error: 'bad_input' }), true;
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח – לא מבוצע' }), true;
      // --ask makes nmcli read the password from stdin, so it is never visible in the process list
      const r = await run('nmcli', pw ? ['--ask', 'device', 'wifi', 'connect', ssid] : ['device', 'wifi', 'connect', ssid], { input: pw ? pw + '\n' : '', timeout: 30000 });
      return send(res, 200, { ok: r.ok, msg: r.ok ? 'מחובר' : (/Secrets|password|802-11/i.test(r.err + r.out) ? 'סיסמה שגויה' : 'החיבור נכשל') }), true;
    }
    if (m === 'POST' && p === '/api/net/wifi/disconnect') {
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח' }), true;
      const d = (await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device'])).out.split('\n').map(split).find(a => a[1] === 'wifi' && a[2] === 'connected');
      if (!d) return send(res, 200, { ok: false, msg: 'אין חיבור Wi-Fi' }), true;
      const r = await run('nmcli', ['device', 'disconnect', d[0]]); return send(res, 200, { ok: r.ok }), true;
    }
    if (m === 'POST' && p === '/api/net/wifi/power') {
      if (!REAL) return send(res, 200, { ok: true, dev: true }), true;
      const r = await run('nmcli', ['radio', 'wifi', b.on ? 'on' : 'off']); return send(res, 200, { ok: r.ok }), true;
    }
    if (m === 'POST' && p === '/api/net/wifi/forget') {
      const ssid = String(b.ssid || ''); if (!ssid || ssid.length > 32 || /[\0\n]/.test(ssid)) return send(res, 400, { error: 'bad_input' }), true;
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח' }), true;
      const r = await run('nmcli', ['connection', 'delete', 'id', ssid]); return send(res, 200, { ok: r.ok }), true;
    }

    // ---------------- bluetooth ----------------
    if (m === 'GET' && p === '/api/bt') {
      if (!REAL) return send(res, 200, { dev: true, available: true, powered: true, devices: [{ mac: '00:11:22:33:44:55', name: 'אוזניות (דוגמה)', paired: true, connected: false, kind: 'audio' }] }), true;
      const show = await run('bluetoothctl', ['show']);
      if (!show.ok || !/Controller/.test(show.out)) return send(res, 200, { available: false, powered: false, devices: [] }), true;
      const devs = (await run('bluetoothctl', ['devices'])).out.split('\n').map(l => /^Device ([0-9A-F:]{17}) (.*)$/i.exec(l)).filter(Boolean).slice(0, 40);
      const list = [];
      for (const d of devs) {
        const i = (await run('bluetoothctl', ['info', d[1]], { timeout: 4000 })).out;
        list.push({ mac: d[1], name: d[2], paired: /Paired: yes/.test(i), connected: /Connected: yes/.test(i), kind: (/Icon: ([\w-]+)/.exec(i) || [, ''])[1] });
      }
      return send(res, 200, { available: true, powered: /Powered: yes/.test(show.out), devices: list }), true;
    }
    if (m === 'POST' && p === '/api/bt/power') {
      if (!REAL) return send(res, 200, { ok: true, dev: true }), true;
      await run('rfkill', ['unblock', 'bluetooth']); const r = await run('bluetoothctl', ['power', b.on ? 'on' : 'off']); return send(res, 200, { ok: r.ok }), true;
    }
    if (m === 'POST' && p === '/api/bt/scan') {
      if (!REAL) return send(res, 200, { ok: true, dev: true }), true;
      run('bluetoothctl', ['--timeout', '10', 'scan', 'on'], { timeout: 14000 }); return send(res, 200, { ok: true }), true;    // results appear in GET /api/bt
    }
    if (m === 'POST' && ['/api/bt/pair', '/api/bt/connect', '/api/bt/disconnect', '/api/bt/remove'].includes(p)) {
      const mac = String(b.mac || ''); if (!MAC.test(mac)) return send(res, 400, { error: 'bad_mac' }), true;
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח' }), true;
      let r;
      if (p.endsWith('/pair')) { await run('bluetoothctl', ['agent', 'NoInputNoOutput']); r = await run('bluetoothctl', ['pair', mac], { timeout: 30000 }); if (r.ok) { await run('bluetoothctl', ['trust', mac]); r = await run('bluetoothctl', ['connect', mac], { timeout: 20000 }); } }
      else if (p.endsWith('/connect')) r = await run('bluetoothctl', ['connect', mac], { timeout: 20000 });
      else if (p.endsWith('/disconnect')) r = await run('bluetoothctl', ['disconnect', mac]);
      else r = await run('bluetoothctl', ['remove', mac]);
      return send(res, 200, { ok: r.ok, msg: r.ok ? 'בוצע' : 'הפעולה נכשלה (אולי המכשיר צריך אישור או קוד)' }), true;
    }

    // ---------------- sound (volume itself lives in /api/sys/volume) ----------------
    if (m === 'GET' && p === '/api/snd/state') {
      if (!REAL) return send(res, 200, { dev: true, volume: 50, muted: false, mic: 70, micMuted: false }), true;
      const o = await asUser('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@']), i = await asUser('wpctl', ['get-volume', '@DEFAULT_AUDIO_SOURCE@']);
      const n = s => { const x = /([\d.]+)/.exec(s); return x ? Math.round(parseFloat(x[1]) * 100) : 0; };
      return send(res, 200, { volume: n(o.out), muted: /MUTED/.test(o.out), mic: n(i.out), micMuted: /MUTED/.test(i.out) }), true;
    }
    if (m === 'POST' && p === '/api/snd/set') {
      if (!REAL) return send(res, 200, { ok: true, dev: true }), true;
      if (typeof b.mute === 'boolean') await asUser('wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', b.mute ? '1' : '0']);
      if (b.mic != null) await asUser('wpctl', ['set-volume', '@DEFAULT_AUDIO_SOURCE@', Math.max(0, Math.min(100, Math.round(+b.mic))) + '%']);
      if (typeof b.micMute === 'boolean') await asUser('wpctl', ['set-mute', '@DEFAULT_AUDIO_SOURCE@', b.micMute ? '1' : '0']);
      return send(res, 200, { ok: true }), true;
    }

    // ---------------- display ----------------
    const wl = () => { const u = sessionUser(); let d = 'wayland-0'; try { d = fs.readdirSync('/run/user/' + u.uid).find(f => /^wayland-\d+$/.test(f)) || d; } catch {} return d; };
    const wlr = args => REAL ? run('runuser', ['-u', sessionUser().user, '--', 'env', 'XDG_RUNTIME_DIR=/run/user/' + sessionUser().uid, 'WAYLAND_DISPLAY=' + wl(), 'wlr-randr', ...args]) : Promise.resolve({ ok: false, out: '', err: 'dev' });
    if (m === 'GET' && p === '/api/disp/modes') {
      const r = await wlr([]);
      if (!r.ok) return send(res, 200, { available: false, modes: [], output: '' }), true;
      const out = (/^(\S+)/m.exec(r.out) || [, ''])[1]; const modes = []; let cur = null;
      for (const l of r.out.split('\n')) { const x = /^\s+(\d+)x(\d+) px, ([\d.]+) Hz(.*)$/.exec(l); if (x) { const mo = { w: +x[1], h: +x[2], hz: Math.round(+x[3]), current: /current/.test(x[4]) }; modes.push(mo); if (mo.current) cur = mo; } }
      const uniq = []; for (const mo of modes) if (!uniq.some(u => u.w === mo.w && u.h === mo.h)) uniq.push(mo);
      return send(res, 200, { available: true, output: out, modes: uniq.slice(0, 20), current: cur }), true;
    }
    if (m === 'POST' && p === '/api/disp/mode') {
      const w = +b.w, h = +b.h; if (!Number.isInteger(w) || !Number.isInteger(h) || w < 640 || h < 480 || w > 8000 || h > 8000) return send(res, 400, { error: 'bad_mode' }), true;
      const cur = await wlr([]); const out = (/^(\S+)/m.exec(cur.out) || [, ''])[1]; if (!/^[\w.-]+$/.test(out)) return send(res, 200, { ok: false, msg: 'אין מסך זמין' }), true;
      const r = await wlr(['--output', out, '--mode', `${w}x${h}`]); return send(res, 200, { ok: r.ok, msg: r.ok ? 'עודכן' : 'לא נתמך' }), true;
    }
    if (m === 'GET' && p === '/api/disp/brightness') {
      if (!REAL) return send(res, 200, { available: false }), true;
      const r = await run('brightnessctl', ['-m']); const x = r.ok && /,(\d+)%,/.exec(r.out); return send(res, 200, x ? { available: true, percent: +x[1] } : { available: false }), true;
    }
    if (m === 'POST' && p === '/api/disp/brightness') {
      const v = Math.max(5, Math.min(100, Math.round(+b.percent))); if (!REAL) return send(res, 200, { ok: false }), true;
      const r = await run('brightnessctl', ['set', v + '%']); return send(res, 200, { ok: r.ok }), true;
    }

    // ---------------- language / keyboard / time ----------------
    if (m === 'GET' && p === '/api/loc/state') {
      let layouts = ['us'], tz = Intl.DateTimeFormat().resolvedOptions().timeZone, zones = [];
      try { const k = fs.readFileSync('/etc/default/keyboard', 'utf8'); const x = /XKBLAYOUT="?([^"\n]+)"?/.exec(k); if (x) layouts = x[1].split(','); } catch {}
      if (REAL) { const t = await run('timedatectl', ['show', '-p', 'Timezone', '--value']); if (t.out.trim()) tz = t.out.trim(); const z = await run('timedatectl', ['list-timezones']); zones = z.out.split('\n').filter(Boolean); }
      else zones = ['Asia/Jerusalem', 'Europe/London', 'America/New_York', 'UTC'];
      return send(res, 200, { layouts, allowed: KB_ALLOWED, timezone: tz, zones }), true;
    }
    if (m === 'POST' && p === '/api/loc/timezone') {
      const tz = String(b.timezone || ''); if (!TZ_OK.test(tz)) return send(res, 400, { error: 'bad_tz' }), true;
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח' }), true;
      const list = (await run('timedatectl', ['list-timezones'])).out.split('\n'); if (!list.includes(tz)) return send(res, 400, { error: 'bad_tz' }), true;
      const r = await run('timedatectl', ['set-timezone', tz]); return send(res, 200, { ok: r.ok }), true;
    }
    if (m === 'POST' && p === '/api/loc/keyboard') {
      const l = Array.isArray(b.layouts) ? b.layouts.map(String) : []; if (!l.length || l.length > 4 || !l.every(x => KB_OK.test(x) && KB_ALLOWED.includes(x))) return send(res, 400, { error: 'bad_layout' }), true;
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח' }), true;
      fs.writeFileSync('/etc/default/keyboard', `XKBMODEL="pc105"\nXKBLAYOUT="${l.join(',')}"\nXKBVARIANT=""\nXKBOPTIONS="grp:alt_shift_toggle"\nBACKSPACE="guess"\n`);
      return send(res, 200, { ok: true, msg: 'נשמר – יחול אחרי הפעלה מחדש (Alt+Shift מחליף שפה)' }), true;
    }

    // ---------------- accounts ----------------
    if (m === 'GET' && p === '/api/acct/list') {
      const u = sessionUser(); let users = [];
      try { users = fs.readFileSync('/etc/passwd', 'utf8').split('\n').map(l => l.split(':')).filter(a => a.length > 6 && +a[2] >= 1000 && +a[2] < 60000 && !/nologin|false/.test(a[6])).map(a => ({ name: a[0], uid: +a[2], current: a[0] === u.user })); } catch {}
      return send(res, 200, { users, current: u.user }), true;
    }
    if (m === 'POST' && p === '/api/acct/password') {          // keeps the Linux login password in step with the DANI lock-screen password
      const pw = String(b.password || ''); if (pw.length > 128 || /[\0\n:]/.test(pw)) return send(res, 400, { error: 'bad_password' }), true;
      if (!REAL) return send(res, 200, { ok: false, msg: 'מצב פיתוח' }), true;
      const u = sessionUser(); if (!pw) { const r = await run('passwd', ['-d', u.user]); return send(res, 200, { ok: r.ok }), true; }
      const r = await run('chpasswd', [], { input: `${u.user}:${pw}\n` }); return send(res, 200, { ok: r.ok }), true;
    }
    return false;
  } catch (e) { send(res, 400, { error: String(e.message || e) }); return true; }
}
module.exports = { handle };
