/* DANI OS system apps (stage 1): Files + Trash, Task Manager, Terminal, Control Center, Notification Center.
 * Loaded before the main shell script; the shell calls DaniSystemApps(APPS, ICONS) once APPS exists.
 * Talks to the local agent (Computer-OS/agent/system-api.js), which only accepts requests from this shell. */
window.DaniSystemApps = function (APPS, ICONS) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const E = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ag = async (p, body) => {
    const r = await fetch(AGENT + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('http_' + r.status)); return j;
  };
  const alive = el => el && el.isConnected;
  const size = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(1) + ' GB';
  const ext = n => (/\.([^.]+)$/.exec(n) || [, ''])[1].toLowerCase();
  const KIND = { png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', svg: 'img', mp3: 'aud', wav: 'aud', ogg: 'aud', m4a: 'aud', flac: 'aud', mp4: 'vid', webm: 'vid', mkv: 'vid', mov: 'vid', txt: 'txt', md: 'txt', json: 'txt', js: 'txt', py: 'txt', html: 'txt', css: 'txt', csv: 'txt', log: 'txt', sh: 'txt' };
  const raw = p => AGENT + '/api/fs/raw?path=' + encodeURIComponent(p);

  const css = document.createElement('style');
  css.textContent = `
.fm{display:flex;height:100%;direction:rtl}.fm .sb{width:150px;background:#f7f1f2;border-left:1px solid var(--line);padding:10px 6px;overflow:auto}
.fm .sb div{padding:7px 10px;border-radius:8px;cursor:pointer;font-size:13px;display:flex;gap:8px;align-items:center}.fm .sb div.on{background:#ffd9dd;color:#b3101f;font-weight:600}.fm .sb div:hover{background:#ffe9ec}
.fm .mn{flex:1;display:flex;flex-direction:column;min-width:0}.fm .tl{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--line);align-items:center}.fm .tl .path{flex:1;font-size:13px;color:#555;direction:ltr;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fm .ls{flex:1;overflow:auto}.fm .row{display:flex;gap:10px;align-items:center;padding:7px 12px;border-bottom:1px solid #f3f3f3;cursor:default;font-size:13px}.fm .row:hover{background:#fff4f5}
.fm .row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.fm .row small{color:#888;min-width:70px;text-align:left;direction:ltr}.fm .row .ac{opacity:0;display:flex;gap:4px}.fm .row:hover .ac{opacity:1}
.fm .ac button{border:0;background:#eee;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:12px}
.mod{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:5}.mod>div{background:#fff;border-radius:14px;padding:16px;max-width:92%;max-height:92%;display:flex;flex-direction:column;gap:10px;min-width:280px}
.mod textarea{width:min(560px,80vw);height:300px;font:13px/1.5 monospace;direction:auto;border:1px solid #ddd;border-radius:8px;padding:8px}
.tm table{width:100%;border-collapse:collapse;font-size:12.5px}.tm th{position:sticky;top:0;background:#f4eaec;text-align:right;padding:6px 8px}.tm td{padding:5px 8px;border-bottom:1px solid #f3f3f3}
.tm .sum{display:flex;gap:10px;padding:10px;flex-wrap:wrap}.tm .sum .c{flex:1;min-width:130px;background:#fff4f5;border-radius:10px;padding:8px 10px;font-size:12px}.tm .bar2{height:6px;background:#eee;border-radius:3px;margin-top:5px}.tm .bar2 i{display:block;height:100%;background:#e11d2e;border-radius:3px}
.term{background:#14080a;color:#f6e9ea;height:100%;overflow:auto;padding:10px;font:13px/1.45 ui-monospace,Menlo,monospace;direction:ltr;text-align:left}.term pre{margin:0;white-space:pre-wrap;word-break:break-word}.term .pr{color:#ff7a86}.term input{background:transparent;border:0;outline:0;color:inherit;font:inherit;width:70%}
#sysbar{display:flex;gap:6px;align-items:center;margin-inline-end:10px}#sysbar b{cursor:pointer;display:grid;place-items:center;width:26px;height:22px;border-radius:6px;position:relative}#sysbar b:hover{background:rgba(255,255,255,.55)}#sysbar svg{width:16px;height:16px}
#sysbar .dot{position:absolute;top:1px;right:3px;width:7px;height:7px;border-radius:50%;background:#e11d2e}
.panel{position:fixed;top:32px;right:10px;width:330px;max-height:calc(100vh - 110px);overflow:auto;background:var(--glass);backdrop-filter:blur(26px);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.35);z-index:900;padding:14px;direction:rtl}
.panel h4{margin:0 0 10px}.panel .tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.panel .tile{background:#fff;border-radius:14px;padding:10px;font-size:13px;cursor:pointer;border:1px solid var(--line)}.panel .tile.on{background:#e11d2e;color:#fff}.panel .tile small{display:block;opacity:.75}
.panel .apps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.panel .apps .di{width:44px;height:44px}.panel input[type=range]{width:100%;accent-color:#e11d2e}
.panel .nt{background:#fff;border-radius:12px;padding:9px 11px;margin-bottom:8px;font-size:13px;border:1px solid var(--line)}.panel .nt small{color:#999}`;
  document.head.appendChild(css);

  /* ---------- drawn icons ---------- */
  ICONS.files = sq('fm', '#ffa07a', '#d0121f', '<path d="M12 20h12l4 4h16v18H12z" fill="#fff"/><path d="M12 28h32v14H12z" fill="#fff" opacity=".7"/>');
  ICONS.tasks = sq('tk', '#ff7a86', '#a50f1c', '<rect x="14" y="30" width="6" height="12" rx="2" fill="#fff"/><rect x="25" y="20" width="6" height="22" rx="2" fill="#fff"/><rect x="36" y="25" width="6" height="17" rx="2" fill="#fff"/>');
  ICONS.terminal = sq('tm', '#5b5b66', '#17171c', '<path d="M16 20l10 8-10 8" fill="none" stroke="#ff6b78" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M29 38h12" stroke="#fff" stroke-width="4" stroke-linecap="round"/>');
  ICONS.trash = sq('tr', '#ff9a9f', '#c8101f', '<path d="M18 22h20l-2 20H20z" fill="#fff"/><rect x="16" y="17" width="24" height="4" rx="2" fill="#fff"/><path d="M24 14h8v3h-8z" fill="#fff"/>');
  const fico = (k, dir) => dir ? '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z" fill="#e11d2e"/></svg>'
    : ({ img: '#ff7a86', aud: '#b3101f', vid: '#7a0c16', txt: '#999' }[k] ? `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M5 2h10l5 5v15H5z" fill="${{ img: '#ff7a86', aud: '#b3101f', vid: '#7a0c16', txt: '#999' }[k]}"/><path d="M15 2v5h5" fill="#fff" opacity=".5"/></svg>` : '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M5 2h10l5 5v15H5z" fill="#c9c9c9"/></svg>');

  function ask(root, title, val) {                                   // inline text prompt (window.prompt does not exist in Electron)
    return new Promise(res => {
      const m = document.createElement('div'); m.className = 'mod';
      m.innerHTML = `<div><b>${E(title)}</b><input class="i" value="${E(val || '')}" style="direction:auto"><div style="display:flex;gap:8px;justify-content:flex-end"><button class="b s" data-n>ביטול</button><button class="b" data-y>אישור</button></div></div>`;
      root.appendChild(m); const inp = $('input', m); inp.focus(); inp.select();
      const done = v => { m.remove(); res(v); };
      m.onclick = e => { if (e.target.dataset.n !== undefined || e.target === m) done(null); if (e.target.dataset.y !== undefined) done(inp.value.trim() || null); };
      inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
    });
  }
  function modal(root, html) { const m = document.createElement('div'); m.className = 'mod'; m.innerHTML = `<div>${html}<div style="text-align:left"><button class="b s" data-close>סגור</button></div></div>`; root.appendChild(m); m.onclick = e => { if (e.target === m || e.target.dataset.close !== undefined) m.remove(); }; return m; }

  /* ---------- Files + Trash ---------- */
  function filesApp(root, w) {
    let cwd = window.__filesStart || '/', trash = false; window.__filesStart = null;
    root.innerHTML = '<div class="fm"><div class="sb"></div><div class="mn"><div class="tl"></div><div class="ls"></div></div></div>';
    const sb = $('.sb', root), tl = $('.tl', root), ls = $('.ls', root);
    const places = [['/', 'בית'], ['/Desktop', 'שולחן עבודה'], ['/Documents', 'מסמכים'], ['/Downloads', 'הורדות'], ['/Pictures', 'תמונות'], ['/Music', 'מוזיקה'], ['/Videos', 'סרטונים']];
    const drawSb = () => { sb.innerHTML = places.map(([p, n]) => `<div data-p="${p}" class="${!trash && cwd === p ? 'on' : ''}">${fico('', true)} ${n}</div>`).join('') + `<div data-trash class="${trash ? 'on' : ''}" style="margin-top:8px">${ICONS.trash.replace('<svg ', '<svg width="20" height="20" ')} פח מחזור</div>`; };
    sb.onclick = e => { const d = e.target.closest('div[data-p],div[data-trash]'); if (!d) return; if (d.dataset.trash !== undefined) { trash = true; showTrash(); } else { trash = false; go(d.dataset.p); } };
    async function go(p) {
      cwd = p; trash = false; drawSb();
      try {
        const r = await ag('/api/fs/list?path=' + encodeURIComponent(p)); cwd = r.path;
        tl.innerHTML = `<button class="b s" data-a="up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:middle"><path d="M6 15l6-6 6 6"/></svg></button><span class="path">${E(cwd)}</span><button class="b s" data-a="mk">תיקייה חדשה</button><button class="b s" data-a="new">קובץ טקסט חדש</button>`;
        ls.innerHTML = r.items.map(it => `<div class="row" data-n="${E(it.name)}" data-d="${it.dir ? 1 : ''}">${fico(KIND[ext(it.name)], it.dir)}<span class="nm">${E(it.name)}</span><small>${it.dir ? '' : size(it.size)}</small><small>${new Date(it.mtime).toLocaleDateString('he-IL')}</small><span class="ac">${it.dir ? '' : '<button data-a="ph">לטלפון</button>'}<button data-a="rn">שנה שם</button><button data-a="rm">למחזור</button></span></div>`).join('') || '<div class="pad"><small>התיקייה ריקה</small></div>';
      } catch (e) { ls.innerHTML = `<div class="pad">שירות הקבצים לא זמין (${E(e.message)}).</div>`; }
    }
    const join = n => (cwd === '/' ? '' : cwd) + '/' + n;
    tl.onclick = async e => {
      const a = e.target.dataset.a; if (!a || trash) return;
      if (a === 'up') go(cwd.replace(/\/[^/]+$/, '') || '/');
      if (a === 'mk') { const n = await ask(root, 'שם התיקייה', ''); if (n) { await ag('/api/fs/mkdir', { path: join(n) }).catch(x => toast('נכשל: ' + x.message)); go(cwd); } }
      if (a === 'new') { const n = await ask(root, 'שם הקובץ', 'מסמך.txt'); if (n) { await ag('/api/fs/write', { path: join(n), text: '' }).catch(x => toast('נכשל: ' + x.message)); go(cwd); } }
    };
    ls.onclick = async e => {
      const row = e.target.closest('.row'); if (!row) return; const n = row.dataset.n, a = e.target.dataset.a;
      if (trash) {
        if (a === 'rs') { await ag('/api/fs/trash/restore', { id: row.dataset.id }).catch(x => toast('נכשל')); toast('שוחזר'); showTrash(); }
        return;
      }
      if (a === 'ph') {
        const l = store.get('phoneLink', null); if (!l) return toast('הטלפון לא מחובר – פתח "חיבור טלפון"');
        try {
          const blob = await fetch(AGENT + '/api/fs/raw?path=' + encodeURIComponent(join(n))).then(r => { if (!r.ok) throw new Error('read'); return r.blob(); });
          if (blob.size > 12 * 1024 * 1024) return toast('הקובץ גדול מדי לשליחה (עד 12 MB)');
          const r = await fetch(PAIR + '/api/remote/send?name=' + encodeURIComponent(n), { method: 'POST', headers: { authorization: 'Bearer ' + l.token, 'content-type': 'application/octet-stream' }, body: blob });
          toast(r.ok ? 'נשלח לטלפון: ' + n : 'השליחה נכשלה');
        } catch { toast('השליחה נכשלה'); }
        return;
      }
      if (a === 'rm') { await ag('/api/fs/trash', { path: join(n) }).catch(x => toast('נכשל: ' + x.message)); toast('הועבר לפח המחזור'); return go(cwd); }
      if (a === 'rn') { const v = await ask(root, 'שם חדש', n); if (v && v !== n) { await ag('/api/fs/rename', { from: join(n), to: join(v) }).catch(x => toast('השם כבר קיים')); go(cwd); } return; }
      if (!e.target.classList.contains('nm')) return;
      if (row.dataset.d) return go(join(n));
      const k = KIND[ext(n)], p = join(n);
      if (k === 'img') modal(root, `<img src="${raw(p)}" style="max-width:80vw;max-height:60vh;border-radius:8px">`);
      else if (k === 'aud') modal(root, `<b>${E(n)}</b><audio src="${raw(p)}" controls autoplay style="width:300px"></audio>`);
      else if (k === 'vid') modal(root, `<video src="${raw(p)}" controls autoplay style="max-width:80vw;max-height:60vh;border-radius:8px"></video>`);
      else if (k === 'txt') {
        try {
          const r = await ag('/api/fs/read?path=' + encodeURIComponent(p)); const m = modal(root, `<b>${E(n)}</b><textarea></textarea><button class="b" data-save>שמור</button>`);
          $('textarea', m).value = r.text; $('[data-save]', m).onclick = async () => { await ag('/api/fs/write', { path: p, text: $('textarea', m).value }).then(() => { toast('נשמר'); m.remove(); go(cwd); }).catch(x => toast('השמירה נכשלה')); };
        } catch (x) { toast('אי אפשר לפתוח (גדול מדי?)'); }
      } else toast('אין תצוגה מקדימה לסוג הקובץ הזה');
    };
    async function showTrash() {
      drawSb(); tl.innerHTML = '<span class="path" style="direction:rtl;text-align:right">פח מחזור – הקבצים נשמרים עד שמרוקנים</span><button class="b s" data-e>רוקן פח</button>';
      const btn = $('[data-e]', tl); let armed = false;
      btn.onclick = async () => { if (!armed) { armed = true; btn.textContent = 'לחץ שוב כדי למחוק לצמיתות'; btn.className = 'b'; setTimeout(() => { armed = false; btn.textContent = 'רוקן פח'; btn.className = 'b s'; }, 4000); return; } await ag('/api/fs/trash/empty', {}).catch(() => { }); showTrash(); };
      try { const r = await ag('/api/fs/trash'); ls.innerHTML = r.items.map(it => `<div class="row" data-id="${it.id}">${fico('', false)}<span class="nm" style="cursor:default">${E(it.name)}</span><small>${E(it.from)}</small><span class="ac" style="opacity:1"><button data-a="rs">שחזר</button></span></div>`).join('') || '<div class="pad"><small>פח המחזור ריק</small></div>'; }
      catch (e) { ls.innerHTML = '<div class="pad">שירות הקבצים לא זמין.</div>'; }
    }
    w.goTrash = () => { trash = true; showTrash(); };
    go('/');
  }

  /* ---------- Task Manager ---------- */
  function tasksApp(root, w) {
    root.innerHTML = '<div class="tm"><div class="sum"></div><div style="padding:0 10px 10px"><table><thead><tr><th>תהליך</th><th>משתמש</th><th>CPU %</th><th>זיכרון</th><th></th></tr></thead><tbody></tbody></table></div></div>';
    const sum = $('.sum', root), tb = $('tbody', root); let me = '';
    async function tick() {
      if (!alive(root)) return clearInterval(w.timer);
      try {
        const [p, s] = await Promise.all([ag('/api/ps'), ag('/api/sys/info')]); me = p.user;
        const memUsed = s.memTotalMB - s.memFreeMB, mp = Math.round(memUsed / s.memTotalMB * 100), dp = s.diskGB ? Math.round(s.diskUsedGB / s.diskGB * 100) : 0, cp = Math.min(100, Math.round(s.load / s.cpus * 100));
        sum.innerHTML = `<div class="c">מעבד<b style="float:left">${cp}%</b><div class="bar2"><i style="width:${cp}%"></i></div></div><div class="c">זיכרון<b style="float:left">${memUsed}/${s.memTotalMB} MB</b><div class="bar2"><i style="width:${mp}%"></i></div></div><div class="c">דיסק<b style="float:left">${s.diskUsedGB}/${s.diskGB} GB</b><div class="bar2"><i style="width:${dp}%"></i></div></div><div class="c">פעיל ${Math.floor(s.uptime / 3600)} שעות ${Math.floor(s.uptime / 60) % 60} דק׳</div>`;
        tb.innerHTML = p.processes.map(r => `<tr><td>${E(r.name)}</td><td>${E(r.user)}</td><td>${r.cpu.toFixed(1)}</td><td>${r.rssMB} MB</td><td>${r.user === me ? `<button class="b s" data-k="${r.pid}">סיים</button>` : '<small style="color:#aaa">מערכת</small>'}</td></tr>`).join('');
      } catch (e) { sum.innerHTML = '<div class="c">שירות המערכת לא זמין</div>'; }
    }
    root.onclick = async e => { const k = e.target.dataset.k; if (k) { const r = await ag('/api/ps/kill', { pid: +k }).catch(x => ({ ok: false })); toast(r.ok ? 'התהליך הופסק' : 'לא ניתן להפסיק'); tick(); } };
    tick(); w.timer = setInterval(tick, 2500);
  }

  /* ---------- Terminal ---------- */
  function terminalApp(root) {
    let cwd = '/'; const hist = []; let hi = 0;
    root.innerHTML = '<div class="term"><pre>DANI OS Terminal – הפקודות רצות כמשתמש שלך. כתוב help לעזרה.\n</pre><div><span class="pr"></span> <input autocomplete="off" spellcheck="false"></div></div>';
    const box = $('.term', root), pre = $('pre', root), pr = $('.pr', root), inp = $('input', root);
    const prompt = () => { pr.textContent = 'dani@dani-os:' + (cwd === '/' ? '~' : '~' + cwd) + '$'; };
    prompt(); inp.focus(); root.onclick = () => inp.focus();
    inp.onkeydown = async e => {
      if (e.key === 'ArrowUp') { if (hi > 0) inp.value = hist[--hi]; e.preventDefault(); return; }
      if (e.key === 'ArrowDown') { inp.value = hi < hist.length - 1 ? hist[++hi] : ''; hi = Math.min(hi + 1, hist.length); e.preventDefault(); return; }
      if (e.key !== 'Enter') return;
      const c = inp.value; inp.value = ''; pre.textContent += pr.textContent + ' ' + c + '\n'; if (!c.trim()) return; hist.push(c); hi = hist.length;
      if (c.trim() === 'clear') { pre.textContent = ''; return; }
      if (c.trim() === 'help') { pre.textContent += 'פקודות רגילות של לינוקס (ls, cd, cat, nano לא נתמך, ping, df, free …). clear מנקה את המסך.\n'; box.scrollTop = 1e9; return; }
      inp.disabled = true;
      try { const r = await ag('/api/term/exec', { cmd: c, cwd }); cwd = r.cwd; pre.textContent += r.out + (r.out && !r.out.endsWith('\n') ? '\n' : ''); }
      catch (x) { pre.textContent += 'שגיאה: ' + x.message + '\n'; }
      inp.disabled = false; prompt(); inp.focus(); box.scrollTop = 1e9;
    };
  }

  APPS.files = { title: 'קבצים', icon: ICONS.files, w: 760, h: 500, render: filesApp };
  APPS.tasks = { title: 'מנהל משימות', icon: ICONS.tasks, w: 640, h: 480, render: tasksApp };
  APPS.terminal = { title: 'טרמינל', icon: ICONS.terminal, w: 640, h: 400, render: terminalApp };
  APPS.trash = { title: 'פח מחזור', icon: ICONS.trash, w: 760, h: 500, render: (r, w) => { filesApp(r, w); w.goTrash(); } };

  /* ---------- Notification center + Control center (menubar) ---------- */
  const notes = () => store.get('notifs', []);
  let dnd = !!store.get('dnd', false), unread = 0, open = null;
  const origToast = window.toast;
  window.toast = function (msg, ms) { const n = notes(); n.unshift({ m: String(msg), t: Date.now() }); store.set('notifs', n.slice(0, 60)); unread++; drawBar(); if (!dnd) origToast(msg, ms); };

  const bell = '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0z" fill="#b3101f"/></svg>';
  const sliders = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="3" rx="1.5" fill="#b3101f"/><circle cx="9" cy="7.5" r="3" fill="#e11d2e"/><rect x="3" y="15" width="18" height="3" rx="1.5" fill="#b3101f"/><circle cx="15" cy="16.5" r="3" fill="#e11d2e"/></svg>';
  const bar = document.createElement('div'); bar.id = 'sysbar';
  const who = $('#who'); who.parentNode.insertBefore(bar, who);
  function drawBar() { bar.innerHTML = `<b data-p="n" title="התראות">${bell}${unread && !dnd ? '<i class="dot"></i>' : ''}</b><b data-p="c" title="מרכז בקרה">${sliders}</b>`; }
  drawBar();
  function closePanel() { if (open) { open.remove(); open = null; } }
  document.addEventListener('pointerdown', e => { if (open && !open.contains(e.target) && !bar.contains(e.target)) closePanel(); });
  bar.onclick = e => { const b = e.target.closest('b'); if (!b) return; const k = b.dataset.p; const was = open && open.dataset.k === k; closePanel(); if (was) return; k === 'n' ? notifPanel() : controlPanel(); };

  function notifPanel() {
    unread = 0; drawBar(); const p = open = document.createElement('div'); p.className = 'panel'; p.dataset.k = 'n';
    const n = notes();
    p.innerHTML = `<h4>התראות <button class="b s" style="float:left" data-clr>נקה</button></h4>${n.map(x => `<div class="nt">${E(x.m)}<br><small>${new Date(x.t).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}</small></div>`).join('') || '<small>אין התראות</small>'}`;
    document.body.appendChild(p); $('[data-clr]', p).onclick = () => { store.set('notifs', []); closePanel(); };
  }
  function controlPanel() {
    const p = open = document.createElement('div'); p.className = 'panel'; p.dataset.k = 'c'; const u = store.get('user', {}) || {};
    p.innerHTML = `<h4>מרכז בקרה</h4>
    <div class="tiles"><div class="tile ${navigator.onLine ? 'on' : ''}" data-t="net">רשת<small>${navigator.onLine ? 'מחובר' : 'לא מחובר'}</small></div><div class="tile" data-t="bt">בלוטוס<small>הגדרות</small></div><div class="tile ${dnd ? 'on' : ''}" data-t="dnd">נא לא להפריע<small>${dnd ? 'פעיל' : 'כבוי'}</small></div></div>
    <div style="margin-bottom:12px"><small>עוצמת קול</small><input type="range" min="0" max="100" value="50" id="vol"></div>
    <div class="apps">${['files', 'terminal', 'tasks', 'settings', 'phone', 'updates'].map(id => `<div class="di" data-o="${id}" title="${APPS[id].title}">${APPS[id].icon}</div>`).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b s" data-t="lock">נעל מסך</button><button class="b s" data-t="reboot">הפעל מחדש</button><button class="b" data-t="off">כיבוי</button></div><div id="pmsg" style="margin-top:8px;font-size:12px;color:#b3101f"></div>`;
    document.body.appendChild(p);
    ag('/api/sys/volume').then(v => { $('#vol', p).value = v.volume; }).catch(() => { });
    let vt; $('#vol', p).oninput = e => { clearTimeout(vt); vt = setTimeout(() => ag('/api/sys/volume', { volume: +e.target.value }).catch(() => { }), 150); };
    let armed = null;
    p.onclick = async e => {
      const o = e.target.closest('[data-o]'); if (o) { closePanel(); openApp(o.dataset.o); return; }
      const t = e.target.dataset.t || (e.target.closest('.tile') || {}).dataset?.t; if (!t) return;
      if (t === 'net') { closePanel(); openSettings('wifi'); return; }
      if (t === 'bt') { closePanel(); openSettings('bt'); return; }
      if (t === 'dnd') { dnd = !dnd; store.set('dnd', dnd); drawBar(); closePanel(); controlPanel(); }
      if (t === 'lock') { closePanel(); if (u.hash && u.salt) lockScreen(u); else toast('כדי לנעול את המסך הגדר סיסמה בהגדרות'); }
      if (t === 'reboot' || t === 'off') {
        if (armed !== t) { armed = t; $('#pmsg', p).textContent = 'לחץ שוב לאישור'; return; }
        const r = await ag('/api/sys/power', { action: t === 'off' ? 'poweroff' : 'reboot' }).catch(() => ({ ok: false })); $('#pmsg', p).textContent = r.ok ? 'מבצע…' : (r.msg || 'לא זמין');
      }
    };
  }
};
