/* DANI OS stage 2: Gallery, Video player, Music player, Desktop widgets, custom Lock screen, Smart (snapping) windows. */
window.DaniMediaApps = function (APPS, ICONS) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ag = async p => { const r = await fetch(AGENT + p); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const rawUrl = p => AGENT + '/api/fs/raw?path=' + encodeURIComponent(p);
  const IMG = /\.(png|jpe?g|webp|gif|bmp|svg)$/i, VID = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i, AUD = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i;
  async function scan(dirs, rx) {
    const out = [];
    for (const d of dirs) { try { const l = await ag('/api/fs/list?path=' + encodeURIComponent(d)); for (const f of (l.items || [])) if (!f.dir && rx.test(f.name)) out.push({ name: f.name, path: (d === '/' ? '' : d) + '/' + f.name, size: f.size, mtime: f.mtime }); } catch { } }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  const sq = (id, a, b, inner) => `<svg viewBox="0 0 56 56"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="56" height="56" rx="13" fill="url(#${id})"/>${inner}</svg>`;
  ICONS.gallery = sq('gl', '#ff9aa4', '#c2101f', '<rect x="12" y="14" width="32" height="28" rx="4" fill="#fff"/><circle cx="22" cy="23" r="3.5" fill="#e11d2e"/><path d="M14 40l9-10 6 6 5-5 8 9z" fill="#ff7a86"/>');
  ICONS.video = sq('vd', '#ff7a86', '#8f0b17', '<rect x="11" y="16" width="26" height="24" rx="4" fill="#fff"/><path d="M39 24l8-5v18l-8-5z" fill="#fff"/>');
  ICONS.music = sq('mu', '#ffb36b', '#d0121f', '<path d="M24 38V18l16-4v20" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="38" r="5" fill="#fff"/><circle cx="36" cy="34" r="5" fill="#fff"/>');

  const css = document.createElement('style'); css.textContent = `
.md{display:flex;height:100%;direction:rtl;font-size:13.5px}.md .side{width:230px;border-left:1px solid var(--line);overflow:auto;background:#faf6f7;flex:none}
.md .side .it{padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0e9ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.md .side .it:hover{background:#ffeef0}.md .side .it.on{background:var(--red);color:#fff}
.md .main{flex:1;display:flex;flex-direction:column;min-width:0;background:#111;color:#fff}.md .empty{padding:30px;text-align:center;color:#999;line-height:1.8}
.md video{width:100%;flex:1;min-height:0;background:#000}.gl{height:100%;overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;align-content:start;direction:rtl}
.gl img{width:100%;height:110px;object-fit:cover;border-radius:8px;cursor:pointer;background:#eee}.gv{position:absolute;inset:0;background:rgba(0,0,0,.92);display:flex;flex-direction:column;z-index:5}
.gv .top{display:flex;gap:8px;padding:10px;justify-content:space-between;color:#fff;direction:rtl;align-items:center}.gv img{flex:1;min-height:0;object-fit:contain;width:100%}
.gv button,.mp button{border:0;border-radius:8px;background:rgba(255,255,255,.18);color:#fff;padding:6px 12px;cursor:pointer;font:inherit}.gv button:hover,.mp button:hover{background:var(--red)}
.mp{height:100%;display:flex;flex-direction:column;background:linear-gradient(160deg,#3a0a10,#12060a);color:#fff;direction:rtl}.mp .np{padding:20px;text-align:center}.mp .art{width:120px;height:120px;border-radius:24px;margin:0 auto 12px;background:linear-gradient(135deg,var(--red),#ffb36b);display:grid;place-items:center;font-size:54px}
.mp .ctl{display:flex;gap:8px;justify-content:center;align-items:center;padding:4px 14px}.mp input[type=range]{width:100%;accent-color:var(--red)}.mp .list{flex:1;overflow:auto;border-top:1px solid rgba(255,255,255,.1)}.mp .list div{padding:8px 16px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mp .list div:hover{background:rgba(255,255,255,.08)}.mp .list div.on{color:#ff7a86;font-weight:700}
#widgets{position:absolute;inset:0;pointer-events:none;z-index:1}.wg{position:absolute;pointer-events:auto;background:var(--glass);backdrop-filter:blur(22px);border:1px solid rgba(255,255,255,.55);border-radius:20px;padding:14px 16px;box-shadow:0 10px 36px rgba(60,0,10,.25);cursor:grab;user-select:none;direction:rtl;color:var(--ink)}
.wg .big{font-size:42px;font-weight:700;line-height:1}.wg small{color:#777}.wg textarea{width:200px;height:110px;border:0;background:transparent;resize:none;font:inherit;outline:none}.wg table{border-collapse:collapse;font-size:12px;text-align:center}.wg td,.wg th{padding:3px 6px}.wg td.t{background:var(--red);color:#fff;border-radius:50%}
.wg .bar{height:7px;border-radius:4px;background:#eee;overflow:hidden;margin:3px 0 8px;width:170px}.wg .bar i{display:block;height:100%;background:var(--red)}
#snapprev{position:fixed;background:rgba(225,29,46,.18);border:2px solid var(--red);border-radius:12px;z-index:9000;pointer-events:none;display:none}`;
  document.head.appendChild(css);

  /* ---------- Gallery ---------- */
  function galleryApp(root) {
    root.style.position = 'relative'; root.innerHTML = '<div class="gl"><div class="empty" style="grid-column:1/-1;color:#999;padding:30px">טוען…</div></div>';
    scan(['/Pictures', '/Pictures/DANI-Phone', '/Downloads', '/Downloads/DANI-Phone', '/Desktop'], IMG).then(list => {
      const g = $('.gl', root); if (!list.length) { g.innerHTML = '<div class="empty" style="grid-column:1/-1;color:#999;padding:30px;text-align:center">אין תמונות. שים תמונות בתיקייה "תמונות", או שלח מהטלפון.</div>'; return; }
      g.innerHTML = list.map((f, i) => `<img loading="lazy" data-i="${i}" src="${rawUrl(f.path)}" alt="${E(f.name)}" title="${E(f.name)}">`).join('');
      let cur = 0, v = null;
      const view = i => {
        cur = (i + list.length) % list.length; const f = list[cur]; if (!v) { v = document.createElement('div'); v.className = 'gv'; root.appendChild(v); }
        v.innerHTML = `<div class="top"><span>${E(f.name)} (${cur + 1}/${list.length})</span><span><button data-a="wall">הגדר כרקע</button> <button data-a="prev">›</button> <button data-a="next">‹</button> <button data-a="close">✕</button></span></div><img src="${rawUrl(f.path)}" alt="">`;
      };
      g.onclick = e => { if (e.target.dataset.i != null) view(+e.target.dataset.i); };
      root.onclick = e => { const a = e.target.dataset.a; if (!a || !v) return; if (a === 'close') { v.remove(); v = null; } else if (a === 'next') view(cur + 1); else if (a === 'prev') view(cur - 1); else if (a === 'wall') { store.set('wall', { kind: 'img', path: list[cur].path }); DaniApplyAppearance(); toast('הוגדר כרקע'); } };
      root.tabIndex = 0; root.onkeydown = e => { if (!v) return; if (e.key === 'ArrowLeft') view(cur + 1); if (e.key === 'ArrowRight') view(cur - 1); if (e.key === 'Escape') { v.remove(); v = null; } };
    });
  }

  /* ---------- Video ---------- */
  function videoApp(root) {
    root.innerHTML = '<div class="md"><div class="side"><div class="empty" style="color:#999">טוען…</div></div><div class="main"><div class="empty">בחר סרטון מהרשימה</div></div></div>';
    scan(['/Videos', '/Downloads', '/Downloads/DANI-Phone', '/Desktop'], VID).then(list => {
      const side = $('.side', root); side.innerHTML = list.map((f, i) => `<div class="it" data-i="${i}" title="${E(f.name)}">${E(f.name)}</div>`).join('') || '<div class="empty" style="color:#999">אין סרטונים בתיקיות סרטונים והורדות</div>';
      const play = i => { side.querySelectorAll('.it').forEach(d => d.classList.toggle('on', +d.dataset.i === i)); const m = $('.main', root); m.innerHTML = `<video controls autoplay src="${rawUrl(list[i].path)}"></video>`; const vv = $('video', m); vv.onended = () => { if (i + 1 < list.length) play(i + 1); }; vv.onerror = () => { m.innerHTML = '<div class="empty">אי אפשר לנגן את הקובץ הזה (פורמט לא נתמך)</div>'; }; };
      side.onclick = e => { if (e.target.dataset.i != null) play(+e.target.dataset.i); };
    });
  }

  /* ---------- Music ---------- */
  function musicApp(root) {
    const au = window.__daniAudio || (window.__daniAudio = new Audio());
    root.innerHTML = `<div class="mp"><div class="np"><div class="art">♪</div><b id="nt">לא מנגן</b><div><small id="ns" style="color:#bbb"></small></div></div>
    <div class="ctl"><span id="tc" style="width:40px;direction:ltr">0:00</span><input type="range" id="sk" min="0" max="1000" value="0"><span id="td" style="width:40px;direction:ltr">0:00</span></div>
    <div class="ctl"><button id="sh" title="ערבוב">🔀</button><button id="pv">⏮</button><button id="pp" style="min-width:54px">▶</button><button id="nx">⏭</button><button id="rp" title="חזרה">🔁</button><input type="range" id="vl" min="0" max="100" value="${Math.round(au.volume * 100)}" style="width:90px"></div>
    <div class="list"><div style="color:#999">טוען…</div></div></div>`;
    let list = [], cur = -1, shuffle = false, repeat = false; const fmt = t => isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00';
    const draw = () => { $('.list', root).innerHTML = list.map((f, i) => `<div data-i="${i}" class="${i === cur ? 'on' : ''}">${i === cur ? '▶ ' : ''}${E(f.name.replace(/\.[^.]+$/, ''))}</div>`).join('') || '<div style="color:#999;text-align:center">אין מוזיקה. שים קבצים בתיקייה "מוזיקה" או "הורדות".</div>'; };
    const play = i => { if (!list.length) return; cur = (i + list.length) % list.length; au.src = rawUrl(list[cur].path); au.play().catch(() => { }); $('#nt', root).textContent = list[cur].name.replace(/\.[^.]+$/, ''); $('#ns', root).textContent = (cur + 1) + ' מתוך ' + list.length; draw(); };
    const next = () => play(shuffle ? Math.floor(Math.random() * list.length) : cur + 1);
    scan(['/Music', '/Downloads', '/Downloads/DANI-Phone'], AUD).then(l => { list = l.sort((a, b) => a.name.localeCompare(b.name)); draw(); });
    $('.list', root).onclick = e => { if (e.target.dataset.i != null) play(+e.target.dataset.i); };
    $('#pp', root).onclick = () => { if (cur < 0) play(0); else au.paused ? au.play() : au.pause(); };
    $('#nx', root).onclick = next; $('#pv', root).onclick = () => play(cur - 1);
    $('#sh', root).onclick = e => { shuffle = !shuffle; e.target.style.background = shuffle ? 'var(--red)' : ''; };
    $('#rp', root).onclick = e => { repeat = !repeat; e.target.style.background = repeat ? 'var(--red)' : ''; };
    $('#vl', root).oninput = e => { au.volume = e.target.value / 100; };
    $('#sk', root).oninput = e => { if (au.duration) au.currentTime = au.duration * e.target.value / 1000; };
    au.onplay = () => { const b = $('#pp', root); if (b) b.textContent = '⏸'; }; au.onpause = () => { const b = $('#pp', root); if (b) b.textContent = '▶'; };
    au.ontimeupdate = () => { if (!root.isConnected) return; $('#tc', root).textContent = fmt(au.currentTime); $('#td', root).textContent = fmt(au.duration); if (au.duration) $('#sk', root).value = Math.round(au.currentTime / au.duration * 1000); };
    au.onended = () => { if (repeat) play(cur); else next(); };
  }

  APPS.gallery = { title: 'גלריה', icon: ICONS.gallery, w: 780, h: 520, hidden: true, render: galleryApp };
  APPS.video = { title: 'נגן סרטונים', icon: ICONS.video, w: 820, h: 520, hidden: true, render: videoApp };
  APPS.music = { title: 'נגן מוזיקה', icon: ICONS.music, w: 420, h: 560, hidden: true, render: musicApp, onClose() { try { window.__daniAudio.pause(); } catch { } } };

  /* ---------- Desktop widgets ---------- */
  const WIDGETS = {
    clock: { name: 'שעון', w: 190, draw(el) { const t = new Date(); el.innerHTML = `<div class="big">${t.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: !store.get('clk24', true) })}</div><small>${t.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</small>`; }, tick: 15000 },
    calendar: { name: 'לוח שנה', w: 210, draw(el) {
      const t = new Date(), y = t.getFullYear(), m = t.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(); let h = `<b>${t.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</b><table><tr>${['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].map(d => `<th>${d}</th>`).join('')}</tr><tr>`;
      for (let i = 0; i < first; i++) h += '<td></td>'; for (let d = 1; d <= days; d++) { if ((first + d - 1) % 7 === 0 && d > 1) h += '</tr><tr>'; h += `<td class="${d === t.getDate() ? 't' : ''}">${d}</td>`; } el.innerHTML = h + '</tr></table>'; }, tick: 3600000 },
    notes: { name: 'פתקים', w: 230, draw(el) { el.innerHTML = `<b>פתקים</b><br><textarea placeholder="כתוב כאן…">${E(store.get('widgetNote', ''))}</textarea>`; $('textarea', el).oninput = e => store.set('widgetNote', e.target.value); $('textarea', el).onpointerdown = e => e.stopPropagation(); } },
    system: { name: 'מערכת', w: 210, async draw(el) {
      try { const i = await ag('/api/sys/info'); const mem = i.memTotalMB ? Math.round((1 - i.memFreeMB / i.memTotalMB) * 100) : 0, dk = i.diskGB ? Math.round(i.diskUsedGB / i.diskGB * 100) : 0, cpu = Math.min(100, Math.round((i.load || 0) / (i.cpus || 1) * 100));
        el.innerHTML = `<b>המערכת</b><br><small>מעבד ${cpu}%</small><div class="bar"><i style="width:${cpu}%"></i></div><small>זיכרון ${mem}%</small><div class="bar"><i style="width:${mem}%"></i></div><small>דיסק ${dk}%</small><div class="bar"><i style="width:${dk}%"></i></div>`; } catch { el.innerHTML = '<b>המערכת</b><br><small>לא זמין</small>'; } }, tick: 5000 }
  };
  const timers = {};
  function widgets() {
    let layer = $('#widgets'); if (!layer) { layer = document.createElement('div'); layer.id = 'widgets'; $('#desk').before(layer); }
    const on = store.get('widgets', ['clock']), pos = store.get('widgetPos', {});
    for (const id of Object.keys(WIDGETS)) {
      let el = $('#wg-' + id, layer);
      if (!on.includes(id)) { if (el) el.remove(); clearInterval(timers[id]); continue; }
      if (el) continue;
      const W = WIDGETS[id]; el = document.createElement('div'); el.className = 'wg'; el.id = 'wg-' + id; el.style.width = W.w + 'px';
      const slot = Object.keys(WIDGETS).indexOf(id), p = pos[id] || { x: innerWidth - W.w - 60, y: 46 + slot * 150 }; el.style.left = Math.min(p.x, innerWidth - 60) + 'px'; el.style.top = Math.min(p.y, innerHeight - 100) + 'px';
      layer.appendChild(el); W.draw(el); if (W.tick) timers[id] = setInterval(() => W.draw(el), W.tick);
      el.addEventListener('pointerdown', e => { if (e.target.closest('textarea')) return; const sx = e.clientX, sy = e.clientY, l = el.offsetLeft, t = el.offsetTop; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing';
        const mv = ev => { el.style.left = Math.max(0, l + ev.clientX - sx) + 'px'; el.style.top = Math.max(28, t + ev.clientY - sy) + 'px'; };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.style.cursor = ''; const pp = store.get('widgetPos', {}); pp[id] = { x: el.offsetLeft, y: el.offsetTop }; store.set('widgetPos', pp); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); });
    }
  }
  window.DaniWidgets = { list: WIDGETS, refresh: widgets };
  widgets();

  /* ---------- Lock screen (customisable: clock, message, background) ---------- */
  window.lockScreen = function (u) {
    return new Promise(res => {
      const cfg = store.get('lock', { clock: true, msg: '', blur: true }), w = store.get('wall', { kind: 'preset', id: 'red' }), wallEl = $('#wall');
      const o = overlay(`<div id="lk" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.5);direction:rtl">
        ${cfg.clock ? '<div id="lkc" style="font-size:86px;font-weight:700;line-height:1"></div><div id="lkd" style="font-size:20px;margin-bottom:18px"></div>' : ''}
        <div class="boxm" style="text-shadow:none;color:var(--ink);padding:24px 30px"><div class="av">${u.avatar || '👤'}</div><h2 style="margin:4px 0">${E(u.name)}</h2>
        ${cfg.msg ? `<div style="color:#777;margin-bottom:6px">${E(cfg.msg)}</div>` : ''}<input class="i" id="lp" type="password" placeholder="הזן סיסמה" autofocus><div class="err" id="er"></div><button class="b" id="un">פתח</button></div></div>`);
      o.style.background = (wallEl && wallEl.style.background) || ''; o.style.backgroundSize = 'cover';
      if (cfg.blur) { const bl = document.createElement('div'); bl.style.cssText = 'position:absolute;inset:0;backdrop-filter:blur(26px);background:rgba(0,0,0,.28);z-index:0'; o.prepend(bl); const lk = $('#lk', o); lk.style.zIndex = 1; }
      const tick = () => { const t = new Date(), c = $('#lkc', o); if (!c) return; c.textContent = t.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: !store.get('clk24', true) }); $('#lkd', o).textContent = t.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }); };
      tick(); const iv = setInterval(tick, 5000);
      const tryUnlock = async () => { const h = await pwHash($('#lp', o).value, unb64(u.salt)); if (h === u.hash) { clearInterval(iv); o.remove(); res(); } else { $('#er', o).textContent = 'סיסמה שגויה'; $('#lp', o).value = ''; } };
      $('#un', o).onclick = tryUnlock; $('#lp', o).addEventListener('keydown', e => e.key === 'Enter' && tryUnlock()); setTimeout(() => $('#lp', o).focus(), 50);
    });
  };

  /* ---------- Smart windows: drag to an edge to snap, Ctrl+Alt+arrows ---------- */
  const prev = document.createElement('div'); prev.id = 'snapprev'; document.body.appendChild(prev);
  const area = () => ({ x: 0, y: 28, w: innerWidth, h: innerHeight - 28 });
  const zone = (x, y) => { const T = 10; if (y <= 30 + T && y < 60) return 'max'; if (x <= T) return 'left'; if (x >= innerWidth - T) return 'right'; return null; };
  const rect = z => { const a = area(); return z === 'left' ? { x: 0, y: a.y, w: a.w / 2, h: a.h } : z === 'right' ? { x: a.w / 2, y: a.y, w: a.w / 2, h: a.h } : z === 'top' ? { x: 0, y: a.y, w: a.w, h: a.h / 2 } : z === 'bottom' ? { x: 0, y: a.y + a.h / 2, w: a.w, h: a.h / 2 } : a; };
  function snap(el, z) {
    if (z === 'max') { el.classList.add('max'); return; }
    if (!el.dataset.pw) { el.dataset.pw = el.offsetWidth; el.dataset.ph = el.offsetHeight; }
    el.classList.remove('max'); const r = rect(z); Object.assign(el.style, { left: r.x + 'px', top: (r.y - 28) + 'px', width: r.w + 'px', height: r.h + 'px' }); el.dataset.snap = z;
  }
  const deskTop = () => { const d = $('#desk'); return d ? d.getBoundingClientRect().top : 28; };
  document.addEventListener('pointerdown', e => {
    const tb = e.target.closest && e.target.closest('.win .tb'); if (!tb || e.target.closest('.dots')) return; const el = tb.parentElement;
    if (el.dataset.snap && el.dataset.pw) { const ow = +el.dataset.pw, oh = +el.dataset.ph, rx = (e.clientX - el.offsetLeft) / el.offsetWidth; el.style.width = ow + 'px'; el.style.height = oh + 'px'; el.style.left = (e.clientX - rx * ow) + 'px'; delete el.dataset.snap; delete el.dataset.pw; }
    let z = null;
    const mv = ev => { z = zone(ev.clientX, ev.clientY); if (z) { const r = rect(z); Object.assign(prev.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); } else prev.style.display = 'none'; };
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); prev.style.display = 'none'; if (z) snap(el, z); };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }, true);
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey && e.altKey)) return; const w = Object.values(wins).find(x => x.el.classList.contains('act')); if (!w) return;
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'max', ArrowDown: 'bottom' }; const z = map[e.key]; if (!z) return; e.preventDefault(); snap(w.el, z);
  });
};
