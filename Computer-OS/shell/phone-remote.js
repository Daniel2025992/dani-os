/* Commands sent from the paired phone (lock, notification, theme, received files / wallpaper). The shell collects them from the local
 * pairing server with the computer's own link token; the server never exposes this endpoint to the phone or the relay. */
(function () {
  'use strict';
  let busy = false;
  function run(c) {
    if (c.type === 'lock') { const u = store.get('user'); if (u && u.hash) lockScreen(u); else toast('הטלפון ביקש לנעול, אבל לא הוגדרה סיסמה (הגדרות › משתמשים)'); }
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
