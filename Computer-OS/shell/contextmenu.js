/* DANI OS: right-click menus (also long-press), desktop icons from ~/Desktop with drag-selection, browser page menu, text prompt dialog. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ag = async (p, body) => { const r = await fetch(AGENT + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };

  const css = document.createElement('style'); css.textContent = `
.cm{position:fixed;z-index:99990;min-width:200px;background:var(--glass);backdrop-filter:blur(26px);border:1px solid rgba(255,255,255,.6);border-radius:12px;padding:5px;box-shadow:0 14px 44px rgba(40,0,10,.35);direction:rtl;font-size:13.5px;color:var(--ink);user-select:none}
.cm div{padding:7px 12px;border-radius:7px;cursor:pointer;white-space:nowrap}.cm div:hover{background:var(--red);color:#fff}.cm div.dis{opacity:.4;pointer-events:none}.cm hr{border:0;border-top:1px solid rgba(0,0,0,.1);margin:4px 6px}
#desk{pointer-events:none}#desk .win{pointer-events:auto}
#dicons{position:absolute;inset:28px 0 0 0;z-index:1;pointer-events:none}
.dic{position:absolute;width:84px;padding:6px 4px;border-radius:10px;text-align:center;pointer-events:auto;cursor:default;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.65);font-size:12px;line-height:1.25}
.dic svg,.dic img{width:52px;height:52px;display:block;margin:0 auto 4px;object-fit:cover;border-radius:8px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}.dic span{display:block;overflow:hidden;text-overflow:ellipsis;max-height:30px;word-break:break-word}
.dic.sel{background:rgba(255,255,255,.28);outline:1px solid rgba(255,255,255,.7)}
#marq{position:fixed;z-index:50;border:1px solid #2b7be4;background:rgba(43,123,228,.22);pointer-events:none;display:none}
#askm{position:fixed;inset:0;z-index:99995;background:rgba(0,0,0,.3);display:grid;place-items:center}#askm .bx{background:#fff;border-radius:16px;padding:20px;width:min(360px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.4);direction:rtl}
#askm input{width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font:inherit;margin:10px 0}#askm .r{display:flex;gap:8px;justify-content:flex-start}`;
  document.head.appendChild(css);

  /* ---------- text prompt (window.prompt does not exist in Electron) ---------- */
  window.DaniAsk = (title, val = '', opt = {}) => new Promise(res => {
    const o = document.createElement('div'); o.id = 'askm'; o.innerHTML = `<div class="bx"><b>${E(title)}</b><input type="${opt.password ? 'password' : 'text'}" value="${E(val)}"><div class="r"><button class="b" data-ok>אישור</button><button class="b s" data-no>ביטול</button></div></div>`;
    document.body.appendChild(o); const i = $('input', o); i.focus(); i.select();
    const done = v => { o.remove(); res(v); };
    o.onclick = e => { if (e.target.dataset.ok !== undefined) done(i.value); else if (e.target.dataset.no !== undefined || e.target === o) done(null); };
    i.onkeydown = e => { if (e.key === 'Enter') done(i.value); if (e.key === 'Escape') done(null); };
  });

  /* ---------- menu engine ---------- */
  function close() { document.querySelectorAll('.cm').forEach(m => m.remove()); }
  function show(x, y, items) {
    close(); const m = document.createElement('div'); m.className = 'cm';
    m.innerHTML = items.filter(Boolean).map((it, i) => it.sep ? '<hr>' : `<div data-i="${i}" class="${it.dis ? 'dis' : ''}">${E(it.label)}</div>`).join('');
    document.body.appendChild(m); const r = m.getBoundingClientRect(); m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px'; m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
    const list = items.filter(Boolean);
    m.onclick = e => { const d = e.target.closest('[data-i]'); if (!d) return; const it = list[+d.dataset.i]; close(); try { it.fn && it.fn(); } catch (er) { } };
    m.oncontextmenu = e => e.preventDefault();
  }
  window.DaniMenu = { show, close };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.cm')) close(); }, true);
  addEventListener('blur', close); document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  const openFiles = path => { window.__filesStart = path; if (wins.files) { wins.files.el.remove(); delete wins.files; } openApp('files'); };
  const sendPhone = async path => {
    const l = store.get('phoneLink', null); if (!l) return toast('הטלפון לא מחובר – פתח "חיבור טלפון"');
    try { const blob = await fetch(AGENT + '/api/fs/raw?path=' + encodeURIComponent(path)).then(r => { if (!r.ok) throw 0; return r.blob(); }); if (blob.size > 12 * 1024 * 1024) return toast('הקובץ גדול מדי (עד 12 MB)');
      const r = await fetch(PAIR + '/api/remote/send?name=' + encodeURIComponent(path.split('/').pop()), { method: 'POST', headers: { authorization: 'Bearer ' + l.token, 'content-type': 'application/octet-stream' }, body: blob }); toast(r.ok ? 'נשלח לטלפון' : 'השליחה נכשלה'); } catch { toast('השליחה נכשלה'); }
  };
  const IMG = /\.(png|jpe?g|webp|gif|bmp|svg)$/i, VID = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i, AUD = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i;

  /* ---------- desktop icons (the ~/Desktop folder) ---------- */
  let icons = [];
  const layer = document.createElement('div'); layer.id = 'dicons'; $('#desk').before(layer);
  const marq = document.createElement('div'); marq.id = 'marq'; document.body.appendChild(marq);
  const folderSvg = '<svg viewBox="0 0 56 56"><path d="M6 14h16l4 5h24v27H6z" fill="#ffb4bb"/><path d="M6 22h44v24H6z" fill="#ff6b78"/></svg>';
  const fileSvg = k => `<svg viewBox="0 0 56 56"><path d="M12 6h22l12 12v32H12z" fill="#fff"/><path d="M34 6v12h12" fill="#ffd0d4"/><text x="28" y="42" text-anchor="middle" font-size="11" font-weight="700" fill="#e11d2e">${E(k)}</text></svg>`;
  async function loadIcons() {
    let l; try { l = await ag('/api/fs/list?path=' + encodeURIComponent('/Desktop')); } catch { l = { items: [] }; }
    const next = (l.items || []).filter(f => !f.name.startsWith('.')).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    const sig = JSON.stringify(next.map(f => [f.name, f.mtime, innerWidth, innerHeight])); if (sig === loadIcons.sig) return; loadIcons.sig = sig; icons = next;
    const sel = new Set([...layer.querySelectorAll('.dic.sel')].map(d => d.dataset.n)); layer.innerHTML = '';
    const rows = Math.max(1, Math.floor((innerHeight - 28 - 110) / 96));
    icons.forEach((f, i) => {
      const d = document.createElement('div'); d.className = 'dic' + (sel.has(f.name) ? ' sel' : ''); d.dataset.n = f.name; d.dataset.d = f.dir ? 1 : '';
      d.style.left = (innerWidth - 16 - (Math.floor(i / rows) + 1) * 90) + 'px'; d.style.top = (12 + (i % rows) * 96) + 'px';
      const ext = (f.name.split('.').pop() || '').toUpperCase().slice(0, 4);
      d.innerHTML = (f.dir ? folderSvg : IMG.test(f.name) ? `<img loading="lazy" src="${AGENT}/api/fs/raw?path=${encodeURIComponent('/Desktop/' + f.name)}" alt="">` : fileSvg(ext)) + `<span>${E(f.name)}</span>`;
      layer.appendChild(d);
    });
  }
  window.DaniDesktopRefresh = loadIcons;
  const openIcon = n => { const f = icons.find(x => x.name === n); if (!f) return; const p = '/Desktop/' + n; if (f.dir) openFiles(p); else if (IMG.test(n)) openApp('gallery'); else if (VID.test(n)) openApp('video'); else if (AUD.test(n)) openApp('music'); else openFiles('/Desktop'); };
  layer.addEventListener('dblclick', e => { const d = e.target.closest('.dic'); if (d) openIcon(d.dataset.n); });
  layer.addEventListener('pointerdown', e => { const d = e.target.closest('.dic'); if (!d) return; e.stopPropagation(); if (e.ctrlKey || e.shiftKey) d.classList.toggle('sel'); else if (!d.classList.contains('sel')) { layer.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); } });
  function iconMenu(x, y, d) {
    if (!d.classList.contains('sel')) { layer.querySelectorAll('.sel').forEach(s => s.classList.remove('sel')); d.classList.add('sel'); }
    const names = [...layer.querySelectorAll('.dic.sel')].map(s => s.dataset.n), n = d.dataset.n, one = names.length === 1;
    show(x, y, [{ label: 'פתח', fn: () => openIcon(n), dis: !one }, { label: 'שנה שם', dis: !one, fn: async () => { const v = await DaniAsk('שם חדש', n); if (v && v !== n) { await ag('/api/fs/rename', { from: '/Desktop/' + n, to: '/Desktop/' + v }).catch(() => toast('השם כבר קיים')); loadIcons(); } } },
      { label: 'שלח לטלפון', dis: !one || !!d.dataset.d, fn: () => sendPhone('/Desktop/' + n) }, { sep: 1 },
      { label: names.length > 1 ? `העבר ${names.length} פריטים לפח המחזור` : 'העבר לפח המחזור', fn: async () => { for (const k of names) await ag('/api/fs/trash', { path: '/Desktop/' + k }).catch(() => { }); toast('הועבר לפח המחזור'); loadIcons(); } }]);
  }
  /* drag-selection rectangle on the empty desktop */
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !(e.target.id === 'desk' || e.target.id === 'wall' || e.target.id === 'dicons' || e.target.id === 'widgets')) return;
    const sx = e.clientX, sy = e.clientY; layer.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); let moved = false;
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return; moved = true;
      const l = Math.min(sx, ev.clientX), t = Math.min(sy, ev.clientY), w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
      Object.assign(marq.style, { display: 'block', left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
      layer.querySelectorAll('.dic').forEach(d => { const r = d.getBoundingClientRect(); d.classList.toggle('sel', !(r.right < l || r.left > l + w || r.bottom < t || r.top > t + h)); });
    };
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); marq.style.display = 'none'; };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  });

  /* ---------- what gets which menu ---------- */
  function desktopMenu(x, y) {
    show(x, y, [
      { label: 'תיקייה חדשה', fn: async () => { const v = await DaniAsk('שם התיקייה', 'תיקייה חדשה'); if (v) { await ag('/api/fs/mkdir', { path: '/Desktop/' + v.replace(/[\/\\]/g, '_') }).catch(() => toast('לא ניתן ליצור')); loadIcons(); } } },
      { label: 'קובץ טקסט חדש', fn: async () => { const v = await DaniAsk('שם הקובץ', 'מסמך חדש.txt'); if (v) { await ag('/api/fs/write', { path: '/Desktop/' + v.replace(/[\/\\]/g, '_'), text: '' }).catch(() => toast('לא ניתן ליצור')); loadIcons(); } } }, { sep: 1 },
      { label: 'שנה רקע…', fn: () => openSettings('wall') }, { label: 'ערכות עיצוב…', fn: () => openSettings('kits') }, { label: 'ווידג\'טים…', fn: () => openSettings('widgets') }, { label: 'הגדרות תצוגה…', fn: () => openSettings('display') }, { sep: 1 },
      { label: 'פתח קבצים', fn: () => openApp('files') }, { label: 'פתח טרמינל', fn: () => openApp('terminal') }, { label: 'רענן', fn: loadIcons }, { sep: 1 },
      { label: 'נעל מסך', fn: () => { const u = store.get('user'); if (u && u.hash) lockScreen(u); else toast('לא הוגדרה סיסמה (הגדרות › משתמשים)'); } }]);
  }
  function filesRowMenu(x, y, row) {
    const items = [{ label: 'פתח', fn: () => { const nm = $('.nm', row); nm && nm.dispatchEvent(new MouseEvent('click', { bubbles: true })); } }];
    row.querySelectorAll('.ac button').forEach(b => items.push({ label: b.textContent, fn: () => b.click() })); show(x, y, items);
  }
  function textMenu(x, y, el) {
    const has = (el.selectionStart != null ? el.selectionStart !== el.selectionEnd : false);
    show(x, y, [{ label: 'גזור', dis: !has, fn: () => { el.focus(); document.execCommand('cut'); } }, { label: 'העתק', dis: !has, fn: () => { el.focus(); document.execCommand('copy'); } },
      { label: 'הדבק', fn: async () => { el.focus(); try { const t = await navigator.clipboard.readText(); document.execCommand('insertText', false, t); } catch { document.execCommand('paste'); } } }, { label: 'בחר הכול', fn: () => { el.focus(); el.select && el.select(); } }]);
  }
  function titleMenu(x, y, win) {
    const w = Object.values(wins).find(k => k.el === win); if (!w) return;
    show(x, y, [{ label: 'מזער', fn: () => { win.classList.add('min'); refreshDock(); } }, { label: win.classList.contains('max') ? 'שחזר גודל' : 'הגדל', fn: () => win.classList.toggle('max') }, { label: 'הצמד לשמאל', fn: () => $('.tb', win) && snapWin(win, 'left') }, { label: 'הצמד לימין', fn: () => snapWin(win, 'right') }, { sep: 1 }, { label: 'סגור', fn: () => $('.c', win).click() }]);
  }
  function snapWin(el, z) { const a = { w: innerWidth, h: innerHeight - 28 }; el.classList.remove('max'); const half = a.w / 2; Object.assign(el.style, { left: (z === 'left' ? 0 : half) + 'px', top: '0px', width: half + 'px', height: a.h + 'px' }); }
  function dockMenu(x, y, di) {
    const idx = [...di.parentElement.children].indexOf(di), id = Object.keys(APPS).filter(k => !APPS[k].hidden || wins[k])[idx];
    show(x, y, [{ label: 'פתח', fn: () => openApp(id) }, { label: 'סגור את החלון', dis: !wins[id], fn: () => wins[id] && $('.c', wins[id].el).click() }]);
  }

  document.addEventListener('contextmenu', e => {
    const t = e.target; if (t.closest('.cm') || t.closest('#askm')) return;
    e.preventDefault(); const x = e.clientX, y = e.clientY;
    const ic = t.closest('.dic'); if (ic) return iconMenu(x, y, ic);
    const di = t.closest('.di'); if (di) return dockMenu(x, y, di);
    const tb = t.closest('.win .tb'); if (tb) return titleMenu(x, y, tb.parentElement);
    const row = t.closest('.fm .row[data-n]'); if (row) return filesRowMenu(x, y, row);
    if (t.matches && t.matches('input:not([type=range]):not([type=checkbox]),textarea')) return textMenu(x, y, t);
    if (t.id === 'desk' || t.id === 'wall' || t.id === 'dicons' || t.id === 'widgets' || t.id === 'wm') return desktopMenu(x, y);
    const sel = String(getSelection()); if (sel) show(x, y, [{ label: 'העתק', fn: () => document.execCommand('copy') }]);
  });

  /* long press (touch screen, or holding the mouse still) = right click */
  let lp = null, lpDone = false;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.cm') || e.target.closest('input,textarea,select,button')) return; lpDone = false; const sx = e.clientX, sy = e.clientY, tg = e.target;
    const cancel = () => { clearTimeout(lp); document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', cancel); }; const mv = ev => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) cancel(); };
    lp = setTimeout(() => { cancel(); lpDone = true; marq.style.display = 'none'; tg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: sx, clientY: sy })); }, 650);
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', cancel);
  }, true);
  document.addEventListener('click', e => { if (lpDone) { lpDone = false; e.stopPropagation(); e.preventDefault(); } }, true);

  /* ---------- right-click inside web pages (forwarded from the Electron main process) ---------- */
  window.__webMenu = d => {
    const f = [...document.querySelectorAll('webview')].find(v => { try { return v.getWebContentsId() === d.id; } catch { return false; } }); if (!f) return;
    const r = f.getBoundingClientRect(), x = r.left + d.x, y = r.top + d.y, items = [];
    if (d.link) items.push({ label: 'פתח קישור בלשונית חדשה', fn: () => window.__openTab(d.link) }, { label: 'העתק כתובת קישור', fn: () => navigator.clipboard.writeText(d.link) }, { sep: 1 });
    if (d.media === 'image' && d.src) items.push({ label: 'פתח תמונה בלשונית חדשה', fn: () => window.__openTab(d.src) }, { label: 'העתק כתובת תמונה', fn: () => navigator.clipboard.writeText(d.src) }, { sep: 1 });
    if (d.sel) items.push({ label: 'העתק', fn: () => f.copy() }, { label: 'חפש "' + d.sel.slice(0, 20) + '"', fn: () => window.__openTab('https://duckduckgo.com/?q=' + encodeURIComponent(d.sel)) }, { sep: 1 });
    if (d.edit) items.push({ label: 'גזור', fn: () => f.cut() }, { label: 'העתק', fn: () => f.copy() }, { label: 'הדבק', fn: () => f.paste() }, { label: 'בחר הכול', fn: () => f.selectAll() }, { sep: 1 });
    items.push({ label: 'אחורה', dis: !d.back, fn: () => f.goBack() }, { label: 'קדימה', dis: !d.fwd, fn: () => f.goForward() }, { label: 'רענן', fn: () => f.reload() }, { sep: 1 },
      { label: 'הוסף למועדפים', fn: () => { const fv = store.get('favs', []); if (!fv.find(k => k.u === d.page)) { fv.push({ u: d.page, t: d.title || d.page }); store.set('favs', fv); toast('נוסף למועדפים'); } } },
      { label: 'העתק כתובת הדף', fn: () => navigator.clipboard.writeText(d.page) }, { label: 'הדפס…', fn: () => f.print() }, { label: 'בדוק אלמנט', fn: () => f.inspectElement(d.x, d.y) });
    show(x, y, items);
  };

  setTimeout(loadIcons, 1200); setInterval(loadIcons, 6000); addEventListener('resize', loadIcons);
})();
