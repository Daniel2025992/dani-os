/* DANI OS Settings: Wi-Fi/network, Bluetooth, sound, display, wallpaper + accent, language/keyboard/time, users, updates, about.
 * Talks to Computer-OS/agent/settings-api.js. Also owns the appearance (wallpaper, accent colour, interface size) applied at start-up.
 */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ag = async (p, body) => {
    const r = await fetch(AGENT + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('http_' + r.status)); return j;
  };

  /* ---------- appearance (applied immediately, also at boot) ---------- */
  const WALLS = [
    { id: 'red', name: 'DANI אדום', css: 'radial-gradient(900px 600px at 15% 20%,#ff6b78 0,transparent 60%),radial-gradient(800px 700px at 85% 80%,#b3101f 0,transparent 55%),radial-gradient(700px 500px at 70% 15%,#ffd9dd 0,transparent 60%),linear-gradient(135deg,#fff5f6,#ffc7cd 45%,#e11d2e)' },
    { id: 'sky', name: 'שמיים', css: 'linear-gradient(160deg,#e8f4ff,#8cc4ff 50%,#3a6fd8)' },
    { id: 'sunset', name: 'שקיעה', css: 'linear-gradient(160deg,#ffe8c9,#ff9a8b 45%,#7b3fa0)' },
    { id: 'forest', name: 'יער', css: 'linear-gradient(160deg,#e6f7e1,#79c58b 50%,#1c5d46)' },
    { id: 'night', name: 'לילה', css: 'radial-gradient(800px 600px at 20% 20%,#3b3f87 0,transparent 60%),linear-gradient(160deg,#171a3a,#0b0d1f)' },
    { id: 'graphite', name: 'גרפיט', css: 'linear-gradient(160deg,#f2f2f4,#b9bcc4 50%,#575a63)' }
  ];
  const ACCENTS = [['#e11d2e', '#ff4d5e', 'אדום'], ['#2563eb', '#5b8cff', 'כחול'], ['#16a34a', '#4ade80', 'ירוק'], ['#9333ea', '#c084fc', 'סגול'], ['#ea580c', '#fb923c', 'כתום'], ['#0f172a', '#475569', 'כהה']];
  const rawUrl = p => AGENT + '/api/fs/raw?path=' + encodeURIComponent(p);
  function applyAppearance() {
    const w = store.get('wall', { kind: 'preset', id: 'red' }), el = document.getElementById('wall'); if (!el) return;
    if (w.kind === 'img' && w.path) { el.style.background = `center/cover no-repeat url("${rawUrl(w.path)}")`; }
    else { const x = WALLS.find(a => a.id === w.id) || WALLS[0]; el.style.background = x.css; }
    const ac = store.get('accent', 0), a = ACCENTS[ac] || ACCENTS[0];
    document.documentElement.style.setProperty('--red', a[0]); document.documentElement.style.setProperty('--red2', a[1]);
    document.documentElement.style.zoom = String(store.get('uiScale', 1));
    const wm = document.getElementById('wm'); if (wm) wm.style.display = store.get('wm', true) ? '' : 'none';
  }
  window.DaniApplyAppearance = applyAppearance;

  /* ---------- UI helpers ---------- */
  const css = document.createElement('style');
  css.textContent = `
.st{display:flex;height:100%;direction:rtl;font-size:13.5px}.st .nav{width:176px;background:#f7f1f2;border-left:1px solid var(--line);padding:10px 6px;overflow:auto;flex:none}
.st .nav div{padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;gap:9px;align-items:center}.st .nav div:hover{background:#ffe9ec}.st .nav div.on{background:var(--red);color:#fff;font-weight:600}
.st .nav svg{width:18px;height:18px;flex:none}.st .sp{flex:1;overflow:auto;padding:18px 22px;min-width:0}.st h3{margin:0 0 14px;font-size:18px}
.st .sc{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:14px;overflow:hidden}.st .row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #f1f1f1}.st .row:last-child{border:0}
.st .row .g{flex:1;min-width:0}.st .row small{color:#888;display:block}.st .row.cl{cursor:pointer}.st .row.cl:hover{background:#fff4f5}
.st .sw{width:42px;height:24px;border-radius:12px;background:#d4d4d8;position:relative;cursor:pointer;flex:none;transition:.15s}.st .sw::after{content:"";position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:.15s}.st .sw.on{background:var(--red)}.st .sw.on::after{right:20px}
.st input[type=range]{flex:1;accent-color:var(--red)}.st select,.st .in{border:1px solid #ddd;border-radius:8px;padding:6px 8px;font:inherit;background:#fff;max-width:100%}
.st .walls{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px}.st .walls div{height:72px;border-radius:10px;cursor:pointer;border:3px solid transparent;position:relative;background-size:cover!important}.st .walls div.on{border-color:var(--red)}.st .walls span{position:absolute;bottom:3px;right:6px;font-size:11px;color:#fff;text-shadow:0 1px 3px #000}
.st .acc{display:flex;gap:10px;padding:12px}.st .acc i{width:30px;height:30px;border-radius:50%;cursor:pointer;border:3px solid #fff;box-shadow:0 0 0 1px #ccc}.st .acc i.on{box-shadow:0 0 0 3px var(--red)}
.st .bars{display:inline-flex;gap:2px;align-items:flex-end;height:14px}.st .bars i{width:3px;background:#ccc;border-radius:1px}.st .bars i.f{background:var(--red)}
.st .pill{font-size:11px;padding:2px 8px;border-radius:10px;background:#e8f7ec;color:#14803c}.st .btns{display:flex;gap:6px}.st .msg{padding:8px 14px;color:#b3101f;font-size:12.5px}.st .dim{color:#999;padding:14px;text-align:center}
`;
  document.head.appendChild(css);

  const ic = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const PAGES = [
    ['wifi', 'רשת ו-Wi-Fi', ic('<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>')],
    ['bt', 'בלוטוס', ic('<path d="M7 7l10 10-5 4V3l5 4L7 17"/>')],
    ['sound', 'צליל', ic('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>')],
    ['display', 'תצוגה', ic('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>')],
    ['wall', 'רקע ועיצוב', ic('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 16l-5-5L5 21"/>')],
    ['lang', 'שפה ומקלדת', ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>')],
    ['users', 'משתמשים', ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>')],
    ['upd', 'עדכונים', ic('<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>')],
    ['about', 'אודות', ic('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>')]
  ];
  const sw = (on, id) => `<div class="sw ${on ? 'on' : ''}" data-sw="${id}"></div>`;
  const bars = s => `<span class="bars">${[25, 50, 75, 100].map((t, i) => `<i style="height:${5 + i * 3}px" class="${s >= t - 12 ? 'f' : ''}"></i>`).join('')}</span>`;

  /* ---------- pages ---------- */
  const P = {};

  P.wifi = async (pg, tick) => {
    const draw = async (rescan) => {
      const [st, w] = await Promise.all([ag('/api/net/status'), ag('/api/net/wifi' + (rescan ? '?rescan=1' : '')).catch(() => ({ networks: [] }))]);
      if (!pg.isConnected || tick.dead) return;
      const eth = st.connections.filter(c => c.type === 'ethernet');
      pg.innerHTML = `<h3>רשת ו-Wi-Fi</h3>
      <div class="sc"><div class="row"><div class="g"><b>סטטוס</b><small>${st.connections.length ? st.connections.map(c => E(c.name) + ' (' + (c.type === 'wifi' ? 'Wi-Fi' : c.type === 'ethernet' ? 'כבל' : E(c.type)) + ')').join(' · ') : 'לא מחובר'}${st.ip ? ' · IP ' + E(st.ip) : ''}</small></div><span class="pill" style="${st.connections.length ? '' : 'background:#fde8ea;color:#b3101f'}">${st.connections.length ? 'מחובר' : 'מנותק'}</span></div>
      ${eth.length ? '<div class="row"><div class="g">חיבור כבל (Ethernet)<small>במכונה וירטואלית החיבור לאינטרנט מגיע בדרך כלל מכאן ולא מ-Wi-Fi</small></div></div>' : ''}</div>
      ${st.wifiDevice ? `<div class="sc"><div class="row"><div class="g"><b>Wi-Fi</b></div>${sw(st.wifiEnabled, 'wifi')}</div>
      ${st.wifiEnabled ? (w.networks.map(n => `<div class="row cl" data-ssid="${E(n.ssid)}" data-sec="${n.secure ? 1 : 0}"><div class="g">${E(n.ssid)}<small>${n.secure ? 'מוגן בסיסמה' : 'פתוחה'}${n.active ? ' · מחובר' : ''}</small></div>${bars(n.signal)}${n.active ? '<div class="btns"><button class="b s" data-disc>נתק</button></div>' : ''}</div>`).join('') || '<div class="dim">לא נמצאו רשתות</div>') + '<div class="row"><button class="b s" data-rescan>סרוק שוב</button></div>' : ''}</div>`
        : '<div class="sc"><div class="dim">לא נמצא מתאם Wi-Fi במחשב הזה. במכונה וירטואלית זה תקין: האינטרנט מגיע מהמחשב המארח דרך חיבור הכבל.</div></div>'}
      <div id="wmsg" class="msg"></div>`;
    };
    await draw(false);
    pg.onclick = async e => {
      const msg = t => { const m = $('#wmsg', pg); if (m) m.textContent = t; };
      if (e.target.dataset.sw === 'wifi') { await ag('/api/net/wifi/power', { on: !e.target.classList.contains('on') }).catch(() => { }); return setTimeout(() => draw(false), 800); }
      if (e.target.dataset.rescan !== undefined) { msg('סורק…'); return draw(true); }
      if (e.target.dataset.disc !== undefined) { await ag('/api/net/wifi/disconnect', {}).catch(() => { }); return draw(false); }
      const row = e.target.closest('[data-ssid]'); if (!row || e.target.closest('button')) return;
      const ssid = row.dataset.ssid; let pw = '';
      if (row.dataset.sec === '1') { pw = prompt('סיסמת Wi-Fi עבור ' + ssid + ':'); if (pw === null) return; }
      msg('מתחבר…'); const r = await ag('/api/net/wifi/connect', { ssid, password: pw }).catch(() => ({ ok: false, msg: 'שגיאה' }));
      msg(r.msg || ''); if (r.ok) draw(false);
    };
  };

  P.bt = async (pg, tick) => {
    let scanning = false;
    const kindName = k => ({ 'audio-headset': 'אוזניות', 'audio-headphones': 'אוזניות', 'audio-card': 'רמקול', 'input-keyboard': 'מקלדת', 'input-mouse': 'עכבר', 'input-gaming': 'שלט משחק', phone: 'טלפון', computer: 'מחשב' }[k] || '');
    const draw = async () => {
      const s = await ag('/api/bt'); if (!pg.isConnected || tick.dead) return;
      if (!s.available) { pg.innerHTML = '<h3>בלוטוס</h3><div class="sc"><div class="dim">לא נמצא מתאם בלוטוס במחשב הזה.<br>במכונה וירטואלית צריך לחבר מתאם USB בלוטוס למכונה (VMware: VM → Removable Devices).</div></div>'; return; }
      const paired = s.devices.filter(d => d.paired), other = s.devices.filter(d => !d.paired);
      const rowH = d => `<div class="row"><div class="g">${E(d.name)}<small>${kindName(d.kind)}${d.connected ? ' · מחובר' : ''}</small></div><div class="btns">${d.paired ? (d.connected ? `<button class="b s" data-act="disconnect" data-mac="${d.mac}">נתק</button>` : `<button class="b s" data-act="connect" data-mac="${d.mac}">התחבר</button>`) + `<button class="b s" data-act="remove" data-mac="${d.mac}">הסר</button>` : `<button class="b" data-act="pair" data-mac="${d.mac}">חבר</button>`}</div></div>`;
      pg.innerHTML = `<h3>בלוטוס</h3><div class="sc"><div class="row"><div class="g"><b>בלוטוס</b><small>${s.powered ? 'פעיל · המחשב נראה למכשירים קרובים' : 'כבוי'}</small></div>${sw(s.powered, 'bt')}</div></div>
      ${s.powered ? `<div class="sc"><div class="row"><div class="g"><b>מכשירים מחוברים</b></div></div>${paired.map(rowH).join('') || '<div class="dim">אין מכשירים מוצמדים</div>'}</div>
      <div class="sc"><div class="row"><div class="g"><b>מכשירים בסביבה</b></div><button class="b s" data-scan>${scanning ? 'סורק…' : 'חפש מכשירים'}</button></div>${other.map(rowH).join('') || '<div class="dim">לחץ "חפש מכשירים" וודא שהמכשיר במצב צימוד</div>'}</div>` : ''}<div id="bmsg" class="msg"></div>`;
    };
    await draw();
    pg.onclick = async e => {
      const msg = t => { const m = $('#bmsg', pg); if (m) m.textContent = t; };
      if (e.target.dataset.sw === 'bt') { await ag('/api/bt/power', { on: !e.target.classList.contains('on') }).catch(() => { }); return setTimeout(draw, 600); }
      if (e.target.dataset.scan !== undefined) { scanning = true; await ag('/api/bt/scan', {}).catch(() => { }); draw(); let n = 0; const iv = setInterval(async () => { if (!pg.isConnected || tick.dead || ++n > 6) { clearInterval(iv); scanning = false; if (pg.isConnected) draw(); return; } draw(); }, 2000); return; }
      const a = e.target.dataset.act; if (!a) return; msg('מבצע…');
      const r = await ag('/api/bt/' + a, { mac: e.target.dataset.mac }).catch(() => ({ ok: false, msg: 'שגיאה' })); await draw(); msg(r.msg || '');
    };
  };

  P.sound = async (pg) => {
    const s = await ag('/api/snd/state'); if (!pg.isConnected) return;
    pg.innerHTML = `<h3>צליל</h3><div class="sc">
      <div class="row"><div class="g"><b>עוצמת צליל</b></div><input type="range" min="0" max="100" value="${s.volume}" id="v"><span id="vv" style="width:34px">${s.volume}</span></div>
      <div class="row"><div class="g">השתק</div>${sw(s.muted, 'mute')}</div></div>
      <div class="sc"><div class="row"><div class="g"><b>מיקרופון</b></div><input type="range" min="0" max="100" value="${s.mic}" id="mic"><span id="mv" style="width:34px">${s.mic}</span></div>
      <div class="row"><div class="g">השתק מיקרופון</div>${sw(s.micMuted, 'micmute')}</div></div>
      <div class="sc"><div class="row"><button class="b s" id="beep">בדיקת צליל</button><small>${s.dev ? 'מצב פיתוח' : ''}</small></div></div>`;
    let t1, t2;
    $('#v', pg).oninput = e => { $('#vv', pg).textContent = e.target.value; clearTimeout(t1); t1 = setTimeout(() => ag('/api/sys/volume', { volume: +e.target.value }).catch(() => { }), 120); };
    $('#mic', pg).oninput = e => { $('#mv', pg).textContent = e.target.value; clearTimeout(t2); t2 = setTimeout(() => ag('/api/snd/set', { mic: +e.target.value }).catch(() => { }), 120); };
    $('#beep', pg).onclick = () => { try { const c = new (window.AudioContext || webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 660; g.gain.value = .15; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .35); } catch { } };
    pg.onclick = async e => { const k = e.target.dataset.sw; if (!k) return; const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); await ag('/api/snd/set', k === 'mute' ? { mute: on } : { micMute: on }).catch(() => { }); };
  };

  P.display = async (pg) => {
    const [md, br] = await Promise.all([ag('/api/disp/modes').catch(() => ({ available: false })), ag('/api/disp/brightness').catch(() => ({ available: false }))]); if (!pg.isConnected) return;
    const scale = store.get('uiScale', 1);
    pg.innerHTML = `<h3>תצוגה</h3><div class="sc">
      <div class="row"><div class="g"><b>רזולוציה</b>${md.available ? '' : '<small>לא זמין כרגע (נתמך רק כשהמערכת רצה על המחשב עצמו)</small>'}</div>${md.available ? `<select id="res">${md.modes.map(m => `<option value="${m.w}x${m.h}" ${m.current ? 'selected' : ''}>${m.w} × ${m.h}</option>`).join('')}</select>` : ''}</div>
      <div class="row"><div class="g"><b>בהירות</b>${br.available ? '' : '<small>אין בקרת בהירות במכשיר הזה (מחשב נייח או מכונה וירטואלית)</small>'}</div>${br.available ? `<input type="range" min="5" max="100" value="${br.percent}" id="br">` : ''}</div>
      <div class="row"><div class="g"><b>גודל הממשק</b><small>מגדיל או מקטין טקסט וחלונות</small></div><select id="sc">${[[.85, 'קטן'], [1, 'רגיל'], [1.15, 'גדול'], [1.3, 'גדול מאוד']].map(a => `<option value="${a[0]}" ${a[0] === scale ? 'selected' : ''}>${a[1]}</option>`).join('')}</select></div></div><div id="dmsg" class="msg"></div>`;
    const res = $('#res', pg); if (res) res.onchange = async e => { const [w, h] = e.target.value.split('x').map(Number); const r = await ag('/api/disp/mode', { w, h }).catch(() => ({ ok: false, msg: 'שגיאה' })); $('#dmsg', pg).textContent = r.msg || ''; };
    const b = $('#br', pg); if (b) { let t; b.oninput = e => { clearTimeout(t); t = setTimeout(() => ag('/api/disp/brightness', { percent: +e.target.value }).catch(() => { }), 150); }; }
    $('#sc', pg).onchange = e => { store.set('uiScale', +e.target.value); applyAppearance(); };
  };

  P.wall = async (pg) => {
    const w = store.get('wall', { kind: 'preset', id: 'red' }), ac = store.get('accent', 0);
    let pics = [];
    for (const d of ['/Pictures', '/Pictures/DANI-Phone']) { try { const l = await ag('/api/fs/list?path=' + encodeURIComponent(d)); pics.push(...(l.items || l.entries || []).filter(f => !f.dir && /\.(png|jpe?g|webp|gif)$/i.test(f.name)).map(f => ({ ...f, rel: d + '/' + f.name }))); } catch { } }
    pics = pics.slice(0, 18);
    if (!pg.isConnected) return;
    pg.innerHTML = `<h3>רקע ועיצוב</h3><div class="sc"><div class="row"><b>רקע שולחן העבודה</b></div><div class="walls">${WALLS.map(x => `<div style="background:${x.css}" data-w="${x.id}" class="${w.kind === 'preset' && w.id === x.id ? 'on' : ''}"><span>${x.name}</span></div>`).join('')}</div></div>
    ${pics.length ? `<div class="sc"><div class="row"><div class="g"><b>התמונות שלך</b><small>מהתיקייה תמונות</small></div></div><div class="walls">${pics.map(f => `<div style="background:center/cover url('${rawUrl(f.rel)}')" data-p="${E(f.rel)}" class="${w.kind === 'img' && w.path === f.rel ? 'on' : ''}"></div>`).join('')}</div></div>` : '<div class="sc"><div class="dim">הוסף תמונות לתיקייה "תמונות" (בתוכנת הקבצים) והן יופיעו כאן כרקע.</div></div>'}
    <div class="sc"><div class="row"><b>צבע ראשי</b></div><div class="acc">${ACCENTS.map((a, i) => `<i style="background:${a[0]}" data-a="${i}" title="${a[2]}" class="${i === ac ? 'on' : ''}"></i>`).join('')}</div></div>
    <div class="sc"><div class="row"><div class="g">הצג את הלוגו על שולחן העבודה</div>${sw(store.get('wm', true), 'wm')}</div></div>`;
    pg.onclick = e => {
      if (e.target.closest('[data-w]')) { store.set('wall', { kind: 'preset', id: e.target.closest('[data-w]').dataset.w }); }
      else if (e.target.closest('[data-p]')) { store.set('wall', { kind: 'img', path: e.target.closest('[data-p]').dataset.p }); }
      else if (e.target.dataset.a != null) { store.set('accent', +e.target.dataset.a); }
      else if (e.target.dataset.sw === 'wm') { store.set('wm', !store.get('wm', true)); }
      else return;
      applyAppearance(); P.wall(pg);
    };
  };

  P.lang = async (pg) => {
    const s = await ag('/api/loc/state'); if (!pg.isConnected) return;
    const NAMES = { us: 'English (US)', il: 'עברית', ru: 'Русский', ara: 'العربية', de: 'Deutsch', fr: 'Français', es: 'Español', gb: 'English (UK)', it: 'Italiano', pt: 'Português', tr: 'Türkçe', ua: 'Українська', pl: 'Polski', se: 'Svenska', nl: 'Nederlands' };
    pg.innerHTML = `<h3>שפה ומקלדת</h3><div class="sc"><div class="row"><div class="g"><b>שפת המערכת</b><small>עברית. שפות נוספות לממשק יתווספו בעתיד</small></div></div>
    <div class="row"><div class="g"><b>פורמט שעון</b></div><select id="clk"><option value="24" ${store.get('clk24', true) ? 'selected' : ''}>24 שעות</option><option value="12" ${store.get('clk24', true) ? '' : 'selected'}>12 שעות</option></select></div></div>
    <div class="sc"><div class="row"><div class="g"><b>שפות מקלדת</b><small>החלפה בין שפות: Alt + Shift. שינוי נכנס לתוקף אחרי הפעלה מחדש</small></div></div>
    ${s.allowed.map(k => `<div class="row"><div class="g">${NAMES[k] || k}</div>${sw(s.layouts.includes(k), 'kb:' + k)}</div>`).join('')}<div class="row"><button class="b" id="kbs">שמור מקלדת</button></div><div id="kmsg" class="msg"></div></div>
    <div class="sc"><div class="row"><div class="g"><b>אזור זמן</b></div><select id="tz" style="max-width:240px">${s.zones.map(z => `<option ${z === s.timezone ? 'selected' : ''}>${E(z)}</option>`).join('')}</select></div></div>`;
    const sel = new Set(s.layouts);
    pg.onclick = async e => {
      const k = e.target.dataset.sw; if (k && k.startsWith('kb:')) { const l = k.slice(3); if (sel.has(l)) { if (sel.size > 1) sel.delete(l); } else if (sel.size < 4) sel.add(l); e.target.classList.toggle('on', sel.has(l)); }
      if (e.target.id === 'kbs') { const r = await ag('/api/loc/keyboard', { layouts: [...sel] }).catch(() => ({ msg: 'שגיאה' })); $('#kmsg', pg).textContent = r.msg || ''; }
    };
    $('#tz', pg).onchange = async e => { const r = await ag('/api/loc/timezone', { timezone: e.target.value }).catch(() => ({ ok: false })); toast(r.ok ? 'אזור הזמן עודכן' : (r.msg || 'לא ניתן לשנות')); };
    $('#clk', pg).onchange = e => { store.set('clk24', e.target.value === '24'); toast('נשמר'); };
  };

  P.users = async (pg) => {
    const u = store.get('user', { name: '', avatar: '😀' }); const l = await ag('/api/acct/list').catch(() => ({ users: [] })); if (!pg.isConnected) return;
    pg.innerHTML = `<h3>משתמשים</h3><div class="sc"><div class="row" style="padding:16px"><div style="font-size:42px">${E(u.avatar || '👤')}</div><div class="g"><b style="font-size:16px">${E(u.name)}</b><small>${u.hash ? 'מוגן בסיסמה' : 'בלי סיסמה'}</small></div></div></div>
    <div class="sc"><div class="row"><div class="g"><b>שם</b></div><input class="in" id="un" value="${E(u.name)}"></div>
    <div class="row"><div class="g"><b>תמונה</b></div><div>${['😀', '🦊', '🐼', '🚀', '🎮', '🎨', '🐱', '⚡'].map(e => `<span data-e="${e}" style="font-size:24px;cursor:pointer;padding:2px 4px;border-radius:8px;${e === u.avatar ? 'background:#ffd9dd' : ''}">${e}</span>`).join('')}</div></div>
    <div class="row"><div class="g"><b>סיסמה חדשה</b><small>ריק = בלי סיסמה. הסיסמה מוצפנת (PBKDF2) ולא נשמרת כטקסט</small></div><input class="in" id="up" type="password" autocomplete="new-password"></div>
    <div class="row"><button class="b" id="us">שמור</button></div><div id="umsg" class="msg"></div></div>
    <div class="sc"><div class="row"><div class="g"><b>חשבונות במחשב</b><small>הוספת משתמשים נוספים תגיע בעתיד</small></div></div>${(l.users || []).map(x => `<div class="row"><div class="g">${E(x.name)}</div>${x.current ? '<span class="pill">פעיל</span>' : ''}</div>`).join('') || '<div class="dim">—</div>'}</div>`;
    let av = u.avatar || '😀';
    pg.onclick = async e => {
      if (e.target.dataset.e) { av = e.target.dataset.e; pg.querySelectorAll('[data-e]').forEach(s => s.style.background = s.dataset.e === av ? '#ffd9dd' : ''); }
      if (e.target.id === 'us') {
        const cur = store.get('user'), nu = { ...cur, name: $('#un', pg).value.trim() || cur.name, avatar: av }, pw = $('#up', pg).value;
        if (pw) { const salt = crypto.getRandomValues(new Uint8Array(16)); nu.salt = b64(salt); nu.hash = await pwHash(pw, salt); }
        else if (cur.hash) { if (!confirm('להסיר את הסיסמה? כל אחד יוכל להיכנס.')) return; nu.salt = null; nu.hash = null; }
        store.set('user', nu); $('#who').textContent = nu.avatar + ' ' + nu.name;
        ag('/api/acct/password', { password: pw }).catch(() => { });        // keep the Linux login password in step
        toast('נשמר'); P.users(pg);
      }
    };
  };

  P.upd = async (pg) => { pg.innerHTML = '<h3>עדכונים</h3><div class="sc"><div class="row"><div class="g">גרסה: <b>DANI OS ' + OS_VERSION + '</b></div><button class="b" id="uo">פתח עדכונים</button></div></div>'; $('#uo', pg).onclick = () => openApp('updates'); };

  P.about = async (pg) => {
    const i = await ag('/api/sys/info').catch(() => ({})); if (!pg.isConnected) return;
    const gb = n => n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB';
    pg.innerHTML = `<div style="text-align:center"><img src="../../Shared/branding/logo.png" alt="DANI OS" style="width:min(260px,80%)"><h3 style="margin:6px 0">DANI OS ${OS_VERSION}</h3><small style="color:#888">מבוסס Debian GNU/Linux 13</small></div>
    <div class="sc" style="margin-top:14px">${[['שם המחשב', i.host], ['משתמש', i.user], ['מעבדים', i.cpus], ['זיכרון', i.memTotalMB ? gb(i.memTotalMB) : ''], ['דיסק', i.diskGB ? i.diskUsedGB + ' / ' + i.diskGB + ' GB' : ''], ['זמן פעילות', i.uptime ? Math.floor(i.uptime / 3600) + ' שעות ' + Math.floor(i.uptime % 3600 / 60) + ' דקות' : '']].map(a => `<div class="row"><div class="g">${a[0]}</div><span>${E(a[1] || '—')}</span></div>`).join('')}</div>`;
  };

  /* ---------- the app ---------- */
  function settingsApp(root, w, startPage) {
    root.innerHTML = `<div class="st"><div class="nav">${PAGES.map(p => `<div data-p="${p[0]}">${p[2]}${p[1]}</div>`).join('')}</div><div class="sp"></div></div>`;
    const pg = $(".sp", root); let tick = { dead: false };
    const go = async id => {
      tick.dead = true; tick = { dead: false };
      root.querySelectorAll('.nav div').forEach(d => d.classList.toggle('on', d.dataset.p === id));
      pg.onclick = null; pg.innerHTML = '<div class="dim">טוען…</div>';
      try { await P[id](pg, tick); } catch (e) { pg.innerHTML = '<h3>' + PAGES.find(p => p[0] === id)[1] + '</h3><div class="sc"><div class="dim">לא ניתן להתחבר לשירות המערכת (' + E(e.message) + ').</div></div>'; }
    };
    root.querySelector('.nav').onclick = e => { const d = e.target.closest('[data-p]'); if (d) { window.__settingsPage = d.dataset.p; go(d.dataset.p); } };
    go(window.__settingsPage || startPage || 'wifi'); window.__settingsPage = null;
  }
  window.DaniSettings = function (APPS) {
    applyAppearance();
    APPS.settings = { title: 'הגדרות', icon: APPS.settings.icon, w: 800, h: 540, render: settingsApp };
    window.openSettings = page => { window.__settingsPage = page; if (typeof wins!=='undefined' && wins.settings) { wins.settings.el.remove(); delete wins.settings; } openApp('settings'); };
  };
})();
