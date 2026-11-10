/* DANI browser v2: per-tab home/library/error pages, favicons, loading bar, stop, zoom, find, shortcuts, persistent logins (partition), downloads. */
window.DaniBrowser = function (APPS) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = document.createElement('style'); css.textContent = `
.br{position:absolute;inset:0;display:flex;flex-direction:column;direction:ltr;background:#fff}.br .tabs{display:flex;gap:3px;padding:6px 6px 0;background:#e6e6e8;overflow-x:auto;flex:none;align-items:flex-end}
.br .tab{display:flex;align-items:center;gap:6px;padding:6px 8px 6px 10px;background:#d4d4d8;border-radius:9px 9px 0 0;font-size:12px;min-width:90px;max-width:180px;cursor:pointer;flex:none}.br .tab.on{background:#fff}
.br .tab img{width:14px;height:14px;flex:none}.br .tab span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.br .tab b{width:16px;height:16px;line-height:15px;text-align:center;border-radius:50%;font-weight:400}.br .tab b:hover{background:rgba(0,0,0,.15)}
.br .tabs .plus{padding:4px 10px;cursor:pointer;font-size:16px;border-radius:8px}.br .tabs .plus:hover{background:rgba(0,0,0,.1)}
.br .bar{display:flex;gap:4px;padding:6px;background:#fff;border-bottom:1px solid var(--line);align-items:center;flex:none}.br .bar button{border:0;background:transparent;border-radius:8px;width:32px;height:30px;font-size:15px;cursor:pointer}.br .bar button:hover{background:#eee}.br .bar button:disabled{opacity:.3;cursor:default}
.br .bar input{flex:1;border:1px solid #ddd;border-radius:16px;padding:6px 14px;font:inherit;outline:none;min-width:0}.br .bar input:focus{border-color:var(--red);box-shadow:0 0 0 2px rgba(225,29,46,.15)}
.br .prog{height:2px;background:transparent;flex:none;overflow:hidden}.br .prog i{display:block;height:100%;width:0;background:var(--red)}.br .prog.on i{animation:brl 1.2s ease-in-out infinite}@keyframes brl{0%{width:5%;margin-left:0}50%{width:60%;margin-left:20%}100%{width:5%;margin-left:95%}}
.br .find{display:none;padding:5px 8px;background:#f5f5f6;border-bottom:1px solid var(--line);gap:6px;align-items:center;flex:none}.br .find.on{display:flex}.br .find input{border:1px solid #ddd;border-radius:8px;padding:4px 8px;font:inherit}
.br .view{position:relative;flex:1;min-height:0}html.dark .win webview{filter:invert(1) hue-rotate(180deg)}.br .view>webview,.br .view>iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
.br .ov{position:absolute;inset:0;overflow:auto;background:#fff;direction:rtl;padding:24px}.br .ov a{color:var(--red);text-decoration:none}.br .tile{display:inline-block;padding:12px 18px;border-radius:12px;background:#fff1f2;margin:5px;cursor:pointer;color:var(--red)}
.br .ov .li{padding:6px 0;border-bottom:1px solid #f1f1f1;display:flex;gap:8px;align-items:center;direction:ltr;text-align:left}.br .ov .li a{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.br .ov .li button{border:0;background:#eee;border-radius:6px;cursor:pointer}`;
  document.head.appendChild(css);

  const PARTITION = 'persist:dani';
  const norm = v => { v = String(v || '').trim(); if (!v) return 'about:blank'; if (/^(https?:|file:|about:)/i.test(v)) return v; if (/^localhost(:\d+)?(\/.*)?$/i.test(v)) return 'http://' + v; if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(v) && !/\s/.test(v)) return 'https://' + v; return 'https://duckduckgo.com/?q=' + encodeURIComponent(v); };
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const TILES = [['Google', 'https://www.google.com'], ['YouTube', 'https://www.youtube.com'], ['ויקיפדיה', 'https://he.wikipedia.org'], ['Ynet', 'https://www.ynet.co.il'], ['DuckDuckGo', 'https://duckduckgo.com'], ['GitHub', 'https://github.com']];

  function browser(root, w, startUrl) {
    root.innerHTML = `<div class="br"><div class="tabs"></div><div class="bar"><button data-a="back" title="אחורה (Alt+←)">◀</button><button data-a="fwd" title="קדימה (Alt+→)">▶</button><button data-a="reload" title="רענן (Ctrl+R)">⟳</button><input id="u" placeholder="חפש או הקלד כתובת" spellcheck="false"><button data-a="fav" title="מועדפים">☆</button><button data-a="lib" title="מועדפים והיסטוריה">☰</button></div><div class="prog"><i></i></div><div class="find"><input id="fi" placeholder="חיפוש בדף"><button class="b s" data-a="fprev">◀</button><button class="b s" data-a="fnext">▶</button><button class="b s" data-a="fclose">✕</button></div><div class="view"></div></div>`;
    const tabsEl = $('.tabs', root), url = $('#u', root), view = $('.view', root), prog = $('.prog', root), find = $('.find', root), fi = $('#fi', root);
    let tabs = [], cur = -1;
    const T = () => tabs[cur];
    const live = t => { try { return t.f && t.f.getWebContentsId && t.ready; } catch { return false; } };

    function mk(u, activate = true) {
      const isE = typeof isElectron !== 'undefined' && isElectron;
      const f = document.createElement(isE ? 'webview' : 'iframe');
      if (isE) f.setAttribute('partition', PARTITION); else f.setAttribute('referrerpolicy', 'no-referrer');
      f.style.display = 'none';
      const t = { f, title: 'לשונית חדשה', url: '', loading: false, icon: '', ov: null, zoom: 1, ready: false, isE };
      tabs.push(t); view.appendChild(f);
      if (isE) {
        f.addEventListener('dom-ready', () => { t.ready = true; try { f.setZoomFactor(t.zoom); } catch { } upd(); });
        f.addEventListener('did-start-loading', () => { t.loading = true; upd(); });
        f.addEventListener('did-stop-loading', () => { t.loading = false; upd(); });
        f.addEventListener('did-navigate', e => { t.url = e.url; clearOv(t); hist(t); if (t === T()) url.value = shown(t); upd(); });
        f.addEventListener('did-navigate-in-page', e => { if (e.isMainFrame !== false) { t.url = e.url; if (t === T()) url.value = shown(t); upd(); } });
        f.addEventListener('page-title-updated', e => { t.title = e.title || t.url; draw(); });
        f.addEventListener('page-favicon-updated', e => { t.icon = (e.favicons || [])[0] || ''; draw(); });
        f.addEventListener('did-fail-load', e => { if (e.isMainFrame && e.errorCode !== -3 && e.errorCode !== 0) errorPage(t, e.validatedURL, e.errorDescription || e.errorCode); });
        f.addEventListener('render-process-gone', () => errorPage(t, t.url, 'הדף קרס'));
      }
      select(tabs.length - 1, activate); if (u && u !== 'about:blank') go(t, u); else homePage(t);
      return t;
    }
    const shown = t => (t.url === 'about:blank' ? '' : t.url);
    function hist(t) { if (!t.url || t.url === 'about:blank') return; const h = store.get('history', []); if (h[0] && h[0].u === t.url) return; h.unshift({ u: t.url, t: Date.now(), title: t.title }); store.set('history', h.slice(0, 300)); }
    function clearOv(t) { if (t.ov) { t.ov.remove(); t.ov = null; } if (t === T()) t.f.style.display = t.isE ? 'inline-flex' : 'block'; }
    function setOv(t, html) { if (t.ov) t.ov.remove(); const o = document.createElement('div'); o.className = 'ov'; o.innerHTML = html; view.appendChild(o); t.ov = o; t.f.style.display = 'none'; if (t !== T()) o.style.display = 'none'; return o; }
    function go(t, u) { u = norm(u); if (u === 'about:blank') return homePage(t); t.url = u; clearOv(t); t.loading = true; try { if (t.ready && t.f.loadURL) t.f.loadURL(u); else t.f.src = u; } catch { t.f.src = u; } if (t === T()) url.value = shown(t); if (!t.isE) { t.loading = false; hist(t); } draw(); upd(); }
    function select(i, act = true) {
      if (!act) return; cur = i; tabs.forEach((t, k) => { const on = k === i; if (t.ov) t.ov.style.display = on ? '' : 'none'; t.f.style.display = on && !t.ov ? (t.isE ? 'inline-flex' : 'block') : 'none'; });
      url.value = shown(T() || {}); draw(); upd();
    }
    function close(i) { const t = tabs[i]; if (!t) return; t.f.remove(); if (t.ov) t.ov.remove(); tabs.splice(i, 1); if (!tabs.length) { mk('about:blank'); return; } select(Math.min(i, tabs.length - 1)); }
    function draw() {
      tabsEl.innerHTML = tabs.map((t, i) => `<div class="tab ${i === cur ? 'on' : ''}" data-i="${i}">${t.icon ? `<img src="${E(t.icon)}" alt="">` : ''}<span>${E(t.loading ? 'טוען…' : (t.title || t.url || 'לשונית חדשה'))}</span><b data-x="${i}">×</b></div>`).join('') + '<div class="plus" data-a="new" title="לשונית חדשה (Ctrl+T)">+</div>';
    }
    function upd() {
      const t = T(); if (!t) return; prog.classList.toggle('on', !!t.loading); $('[data-a=reload]', root).textContent = t.loading ? '✕' : '⟳';
      let b = false, f = false; if (live(t)) { try { b = t.f.canGoBack(); f = t.f.canGoForward(); } catch { } }
      $('[data-a=back]', root).disabled = !b; $('[data-a=fwd]', root).disabled = !f;
      const fav = store.get('favs', []).some(x => x.u === t.url); $('[data-a=fav]', root).textContent = fav ? '★' : '☆'; $('[data-a=fav]', root).style.color = fav ? 'var(--red)' : '';
    }
    const tileHtml = (a) => `<span class="tile" data-go="${E(a[1])}">${E(a[0])}</span>`;
    function homePage(t) {
      t.url = 'about:blank'; t.title = 'לשונית חדשה'; t.icon = ''; t.loading = false;
      const o = setOv(t, `<div style="max-width:600px;margin:36px auto;text-align:center"><img src="../../Shared/branding/logo.png" style="width:200px" alt=""><h2>חיפוש באינטרנט</h2><input id="hq" placeholder="חפש או הקלד כתובת" style="width:100%;direction:ltr;font-size:16px;padding:11px 16px;border:1px solid #ddd;border-radius:24px;outline:none"><div style="margin-top:22px">${TILES.concat(store.get('favs', []).map(x => [x.t || hostOf(x.u), x.u])).map(tileHtml).join('')}</div></div>`);
      const hq = $('#hq', o); hq.onkeydown = e => { if (e.key === 'Enter' && hq.value.trim()) go(t, hq.value); }; o.onclick = e => { const g = e.target.dataset && e.target.dataset.go; if (g) go(t, g); };
      if (t === T()) { url.value = ''; setTimeout(() => hq.focus(), 30); } draw(); upd();
    }
    function libPage(t) {
      const favs = store.get('favs', []), h = store.get('history', []).slice(0, 60);
      const o = setOv(t, `<h3>מועדפים</h3>${favs.map((x, i) => `<div class="li"><a href="#" data-go="${E(x.u)}">${E(x.t || x.u)}</a><button data-rf="${i}">הסר</button></div>`).join('') || '<small>אין עדיין. לחץ על ☆ בדף כדי להוסיף.</small>'}<h3>היסטוריה</h3>${h.map(x => `<div class="li"><a href="#" data-go="${E(x.u)}">${E(x.title || x.u)}</a><small>${E(hostOf(x.u))}</small></div>`).join('') || '<small>ריק</small>'}<p><button class="b s" data-clr>נקה היסטוריה</button></p>`);
      t.title = 'מועדפים והיסטוריה'; draw();
      o.onclick = e => { const g = e.target.dataset.go; if (g) { e.preventDefault(); go(t, g); } if (e.target.dataset.rf != null) { const f = store.get('favs', []); f.splice(+e.target.dataset.rf, 1); store.set('favs', f); libPage(t); }
        if (e.target.dataset.clr !== undefined) { store.set('history', []); libPage(t); }
      };
    }
    function errorPage(t, u, why) { t.loading = false; setOv(t, `<div style="max-width:520px;margin:60px auto;text-align:center"><div style="font-size:54px">🌐</div><h3>לא ניתן לפתוח את הדף</h3><p style="direction:ltr;color:#777;word-break:break-all">${E(u || '')}</p><p>${E(String(why))}<br>בדוק שיש חיבור לאינטרנט (הגדרות › רשת ו-Wi-Fi) ונסה שוב.</p><button class="b" data-retry>נסה שוב</button></div>`).onclick = e => { if (e.target.dataset.retry !== undefined) go(t, u || t.url); }; draw(); upd(); }

    /* ---------- actions ---------- */
    const act = {
      back() { const t = T(); try { t.f.goBack(); } catch { } }, fwd() { const t = T(); try { t.f.goForward(); } catch { } },
      reload() { const t = T(); if (t.ov && t.url !== 'about:blank') return go(t, t.url); if (t.loading && t.isE) { try { t.f.stop(); } catch { } return; } try { t.f.reload(); } catch { if (t.f.src) t.f.src = t.f.src; } },
      new() { mk('about:blank'); }, lib() { libPage(T()); },
      fav() { const t = T(); if (!t.url || t.url === 'about:blank') return; const fv = store.get('favs', []), i = fv.findIndex(x => x.u === t.url); if (i >= 0) { fv.splice(i, 1); toast('הוסר מהמועדפים'); } else { fv.push({ u: t.url, t: t.title }); toast('נוסף למועדפים'); } store.set('favs', fv); upd(); },
      fprev() { const t = T(); if (fi.value) try { t.f.findInPage(fi.value, { forward: false, findNext: true }); } catch { } }, fnext() { const t = T(); if (fi.value) try { t.f.findInPage(fi.value, { findNext: true }); } catch { } },
      fclose() { find.classList.remove('on'); try { T().f.stopFindInPage('clearSelection'); } catch { } }
    };
    root.addEventListener('click', e => {
      const x = e.target.closest('[data-x]'); if (x) { e.stopPropagation(); return close(+x.dataset.x); }
      const a = e.target.closest('[data-a]'); if (a && act[a.dataset.a]) return act[a.dataset.a]();
      const tb = e.target.closest('.tab'); if (tb) select(+tb.dataset.i);
    });
    root.addEventListener('auxclick', e => { const tb = e.target.closest('.tab'); if (tb && e.button === 1) close(+tb.dataset.i); });
    url.addEventListener('keydown', e => { if (e.key === 'Enter') { go(T(), url.value); url.blur(); } if (e.key === 'Escape') { url.value = shown(T()); url.blur(); } });
    url.addEventListener('focus', () => setTimeout(() => url.select(), 0));
    fi.addEventListener('input', () => { const t = T(); try { fi.value ? t.f.findInPage(fi.value) : t.f.stopFindInPage('clearSelection'); } catch { } });
    fi.addEventListener('keydown', e => { if (e.key === 'Enter') act.fnext(); if (e.key === 'Escape') act.fclose(); });
    const zoom = d => { const t = T(); t.zoom = d === 0 ? 1 : Math.max(.3, Math.min(3, +(t.zoom + d).toFixed(2))); try { t.f.setZoomFactor(t.zoom); } catch { } toast('זום ' + Math.round(t.zoom * 100) + '%', 900); };
    w.key = k => {                                      // keyboard shortcuts (from the shell and forwarded from web pages)
      const c = k.ctrl || k.meta, key = String(k.key || '').toLowerCase();
      if (c && key === 't') act.new(); else if (c && key === 'w') close(cur); else if (c && key === 'l') { url.focus(); } else if ((c && key === 'r') || key === 'f5') act.reload();
      else if (c && key === 'f') { find.classList.add('on'); fi.focus(); fi.select(); } else if (c && (key === '+' || key === '=')) zoom(.1); else if (c && key === '-') zoom(-.1); else if (c && key === '0') zoom(0);
      else if (k.alt && key === 'arrowleft') act.back(); else if (k.alt && key === 'arrowright') act.fwd(); else if (c && key === 'tab') select((cur + 1) % tabs.length); else if (c && key === 'd') act.fav(); else return false;
      return true;
    };
    root.addEventListener('keydown', e => { if (w.key({ ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, key: e.key })) e.preventDefault(); });
    w.openUrl = u => { const t = T(); if (t && t.url === 'about:blank' && t.ov && tabs.length === 1) go(t, u); else mk(u); };
    window.__openTab = u => { if (typeof wins !== 'undefined' && wins.browser) wins.browser.openUrl(u); };
    mk(startUrl || 'about:blank');
  }
  APPS.browser.render = (r, w) => browser(r, w);
  window.__browserKey = k => { try { const w = wins.browser; if (w && w.key) w.key(k); } catch { } };
};
