/* Commands sent from the paired phone (lock, notification, theme, received files / wallpaper). The shell collects them from the local
 * pairing server with the computer's own link token; the server never exposes this endpoint to the phone or the relay. */
(function () {
  'use strict';
  let busy = false;
  /* ring: a repeating two-tone ring + a full-screen card with a stop button */
  window.DaniRing = function (title, who) {
    if (document.getElementById('ringov')) return;
    const o = document.createElement('div'); o.id = 'ringov';
    o.style.cssText = 'position:fixed;inset:0;z-index:30000;display:grid;place-items:center;background:rgba(40,0,6,.72);backdrop-filter:blur(8px);direction:rtl';
    o.innerHTML = '<div style="background:#fff;border-radius:22px;padding:30px 40px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);min-width:280px"><div style="width:74px;height:74px;margin:0 auto 12px;border-radius:50%;background:var(--red);color:#fff;display:grid;place-items:center;animation:ringp 1s infinite"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:38px;height:38px"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/></svg></div><h2 style="margin:0 0 4px"></h2><p style="color:#666;margin:0 0 18px"></p><button class="b" id="ringstop">עצור</button></div><style>@keyframes ringp{50%{transform:scale(1.12)}}</style>';
    o.querySelector('h2').textContent = title; o.querySelector('p').textContent = who; document.body.appendChild(o);
    let ctx = null, iv = null; try { ctx = new (window.AudioContext || window.webkitAudioContext)(); const beep = () => { [880, 660].forEach((f, i) => { const os = ctx.createOscillator(), g = ctx.createGain(); os.frequency.value = f; os.type = 'sine'; g.gain.value = .25; os.connect(g); g.connect(ctx.destination); const t = ctx.currentTime + i * .22; os.start(t); os.stop(t + .18); }); }; beep(); iv = setInterval(beep, 1200); } catch (e) { }
    const stop = () => { clearInterval(iv); try { ctx && ctx.close(); } catch (e) { } o.remove(); };
    o.querySelector('#ringstop').onclick = stop; setTimeout(stop, 60000);
  };
  function run(c) {
    if (c.type === 'lock') { const u = store.get('user'); if (u && u.hash) lockScreen(u); else toast('הטלפון ביקש לנעול, אבל לא הוגדרה סיסמה (הגדרות › משתמשים)'); }
    else if (c.type === 'ring') window.DaniRing && DaniRing('טלפון מצלצל במחשב', c.from || 'הטלפון');
    else if (c.type === 'notify') toast(c.title + ': ' + c.body, 6000);
    else if (c.type === 'theme') {
      if (c.accent != null) store.set('accent', c.accent);
      if (c.wall) store.set('wall', { kind: 'preset', id: c.wall });
      if (window.DaniApplyAppearance) DaniApplyAppearance(); toast('הטלפון שינה את ערכת העיצוב');
    } else if (c.type === 'received') {
      if (c.kind === 'wallpaper') { store.set('wall', { kind: 'img', path: c.path }); if (window.DaniApplyAppearance) DaniApplyAppearance(); toast('הטלפון שלח רקע חדש: ' + c.name); }
      else toast('התקבל מהטלפון: ' + c.name + ' (בתיקייה הורדות/DANI-Phone)');
    }
  }
  setInterval(async () => {
    if (busy) return; const l = store.get('phoneLink', null); if (!l || !l.token) return; busy = true;
    try {
      const r = await fetch(PAIR + '/api/remote/commands', { headers: { authorization: 'Bearer ' + l.token } }); if (!r.ok) return;
      for (const c of (await r.json()).commands || []) { try { run(c); } catch (e) { } }
    } catch (e) { } finally { busy = false; }
  }, 3000);
})();
