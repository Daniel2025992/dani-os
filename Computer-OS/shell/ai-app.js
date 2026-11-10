/* DANI AI: a local personal assistant. Understands Hebrew commands (no internet, no API key), answers by text and by a robot-style voice.
 * It is rule based on purpose: everything it does is an action the shell already offers (open apps, wallpaper, volume, lock, files...).
 */
window.DaniAI = function (APPS, ICONS) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ag = async (p, body) => { const r = await fetch(AGENT + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };

  ICONS.ai = `<svg viewBox="0 0 56 56"><defs><linearGradient id="aig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b78"/><stop offset="1" stop-color="#b3101f"/></linearGradient></defs><rect width="56" height="56" rx="13" fill="url(#aig)"/><rect x="13" y="19" width="30" height="22" rx="7" fill="#fff"/><circle cx="22" cy="30" r="3.6" fill="#e11d2e"/><circle cx="34" cy="30" r="3.6" fill="#e11d2e"/><rect x="24" y="36" width="8" height="2" rx="1" fill="#e11d2e"/><path d="M28 19v-5" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="28" cy="12.5" r="2.5" fill="#fff"/></svg>`;
  const css = document.createElement('style'); css.textContent = `
.ai{display:flex;flex-direction:column;height:100%;direction:rtl;background:#faf6f7}.ai .log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
.ai .m{max-width:82%;padding:9px 13px;border-radius:16px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.ai .m.u{align-self:flex-start;background:var(--red);color:#fff;border-bottom-right-radius:4px}.ai .m.a{align-self:flex-end;background:#fff;border:1px solid var(--line);border-bottom-left-radius:4px}
.ai .chips{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 8px}.ai .chips span{padding:5px 11px;border-radius:14px;background:#ffe9ec;color:var(--red);font-size:12.5px;cursor:pointer}.ai .chips span:hover{background:var(--red);color:#fff}
.ai .in{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line);background:#fff}.ai .in input{flex:1;border:1px solid #ddd;border-radius:20px;padding:9px 14px;font:inherit;outline:none}.ai .in input:focus{border-color:var(--red)}
.ai .in button{border:0;width:38px;height:38px;border-radius:50%;background:#f1f1f3;cursor:pointer;display:grid;place-items:center}.ai .in button:hover{background:#ffd9dd}.ai .in button.on{background:var(--red);color:#fff}.ai svg.i{width:20px;height:20px}`;
  document.head.appendChild(css);
  const ico = d => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const MIC = ico('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'), SPK = ico('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>'), SPKX = ico('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'), SEND = ico('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>');

  /* ---------- understanding ---------- */
  const norm = t => String(t || '').replace(/[֑-ׇ]/g, '').replace(/[?!.,"'׳״]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const APP_WORDS = [['gallery', ['גלריה', 'תמונות', 'תמונה']], ['video', ['סרטונים', 'סרטון', 'וידאו', 'וידיאו', 'סרט']], ['music', ['מוזיקה', 'נגן מוזיקה', 'שירים', 'שיר']], ['browser', ['דפדפן', 'אינטרנט', 'כרום', 'גוגל']], ['store', ['חנות', 'אפליקציות']],
    ['files', ['קבצים', 'תיקיות', 'מנהל קבצים']], ['terminal', ['טרמינל', 'שורת פקודה', 'פקודות']], ['tasks', ['מנהל משימות', 'משימות', 'תהליכים']], ['settings', ['הגדרות']], ['phone', ['טלפון', 'חיבור טלפון']], ['updates', ['עדכונים', 'עדכון']], ['trash', ['פח', 'מחזור', 'אשפה']]];
  const APP_NAMES = { gallery: 'הגלריה', video: 'נגן הסרטונים', music: 'נגן המוזיקה', browser: 'הדפדפן', store: 'החנות', files: 'הקבצים', terminal: 'הטרמינל', tasks: 'מנהל המשימות', settings: 'ההגדרות', phone: 'חיבור הטלפון', updates: 'העדכונים', trash: 'פח המחזור' };
  const findApp = t => { for (const [id, ws] of APP_WORDS) for (const w of ws) if (new RegExp('(^| )[הולבמש]?' + w + '( |$)').test(t)) return id; return null; };
  const WALLS = { אדום: 'red', דני: 'red', שמיים: 'sky', שמים: 'sky', כחול: 'sky', שקיעה: 'sunset', כתום: 'sunset', יער: 'forest', ירוק: 'forest', לילה: 'night', שחור: 'night', גרפיט: 'graphite', אפור: 'graphite' };
  const ACC = { אדום: 0, כחול: 1, ירוק: 2, סגול: 3, כתום: 4, כהה: 5, שחור: 5 };
  const word = (t, map) => { for (const k of Object.keys(map)) if (new RegExp('(^| )[הלב]?' + k + '( |$)').test(t)) return map[k]; return null; };
  const NUM = { אפס: 0, אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שתי: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10 };
  const toNum = s => /^\d+(\.\d+)?$/.test(s) ? +s : (s in NUM ? NUM[s] : NaN);
  const calc = t => {
    const m = /(\d+(?:\.\d+)?|\S+) (ועוד|פלוס|\+|פחות|-|כפול|\*|x|חלקי|\/|ב) (\d+(?:\.\d+)?|\S+)/.exec(t); if (!m) return null; const a = toNum(m[1]), b = toNum(m[3]); if (isNaN(a) || isNaN(b)) return null;
    const op = m[2], r = /ועוד|פלוס|\+/.test(op) ? a + b : /פחות|-/.test(op) ? a - b : /כפול|\*|x/.test(op) ? a * b : /חלקי|\//.test(op) ? (b ? a / b : NaN) : null; return r == null || isNaN(r) ? null : `${a} ${op} ${b} = ${Math.round(r * 1000) / 1000}`;
  };
  let pending = null;

  async function understand(raw) {
    const t = norm(raw); if (!t) return 'אני מקשיב.';
    if (pending) { const p = pending; pending = null; if (/^(כן|אשר|בטח|סבבה|אוקיי|אוקי|בצע)/.test(t)) return p(); return 'בסדר, ביטלתי.'; }
    let m;
    if (/^(שלום|היי|הי|אהלן|בוקר טוב|ערב טוב|מה נשמע|מה קורה)/.test(t)) return 'שלום! אני DANI AI. אפשר לבקש ממני לפתוח אפליקציה, לשנות רקע, לנעול את המחשב ועוד.';
    if (/(מי אתה|מה אתה|איך קוראים לך)/.test(t)) return 'אני DANI AI, העוזר האישי של DANI OS. אני רץ ישירות על המחשב שלך, בלי אינטרנט.';
    if (/(תודה|מעולה|יופי)/.test(t)) return 'בכיף!';
    if (/(מה אתה יכול|עזרה|איך משתמשים|פקודות)/.test(t)) return 'אפשר להגיד לי:\n• "פתח גלריה" (או כל אפליקציה)\n• "חפש בעיות שינה" (חיפוש באינטרנט)\n• "שנה רקע לכחול" / "מצב כהה"\n• "נעל את המחשב"\n• "מה השעה" / "איזה יום היום"\n• "הגבר" / "הנמך" / "השתק" / "עוצמה 40"\n• "צור תיקייה פרויקט"\n• "כמה זה 5 כפול 6"\n• "מה מצב המערכת"';
    if (/(מה השעה|כמה השעה|שעה)/.test(t)) return 'השעה ' + new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + '.';
    if (/(איזה יום|מה התאריך|תאריך|איזה תאריך|מה היום)/.test(t)) return 'היום ' + new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.';
    if (/(מצב המערכת|כמה זיכרון|כמה מעבד|מצב המחשב)/.test(t)) { const i = await ag('/api/sys/info').catch(() => null); if (!i) return 'לא הצלחתי לקרוא את מצב המערכת.'; return `זיכרון בשימוש: ${Math.round((1 - i.memFreeMB / i.memTotalMB) * 100)}%. דיסק: ${i.diskUsedGB} מתוך ${i.diskGB} ג'יגה. מעבדים: ${i.cpus}.`; }
    if ((m = /^(?:סגור|סגירת)(?: את)? (.+)$/.exec(t))) { if (/הכול|הכל|כל החלונות/.test(m[1])) { Object.values(wins).forEach(w => { const c = $('.c', w.el); c && c.click(); }); return 'סגרתי את כל החלונות.'; } const id = findApp(m[1]); if (id && wins[id]) { $('.c', wins[id].el).click(); return 'סגרתי ' + APP_NAMES[id] + '.'; } return 'לא מצאתי חלון כזה פתוח.'; }
    if ((m = /^(?:חפש|תחפש|חיפוש|גוגל)(?: באינטרנט| בגוגל)? (.+)$/.exec(t))) { openApp('browser'); setTimeout(() => window.__openTab('https://duckduckgo.com/?q=' + encodeURIComponent(m[1])), 150); return 'מחפש: ' + m[1]; }
    if (/(נעל|נעילה|לנעול)/.test(t)) { const u = store.get('user'); if (u && u.hash) { setTimeout(() => lockScreen(u), 600); return 'נועל את המחשב.'; } return 'לא הוגדרה סיסמה, אז אין מה לנעול. אפשר להגדיר בהגדרות, משתמשים.'; }
    if (/(הפעל מחדש|אתחל|ריסטארט|ריבוט)/.test(t)) { pending = async () => { const r = await ag('/api/sys/power', { action: 'reboot' }).catch(() => ({})); return r.ok ? 'מפעיל מחדש.' : 'לא זמין כרגע.'; }; return 'להפעיל את המחשב מחדש? אמור כן לאישור.'; }
    if (/(כבה|כיבוי|לכבות)( את)?( ה)?(מחשב|מערכת)?/.test(t) && /(כבה|כיבוי|לכבות)/.test(t) && !/(מצב כהה|וידג|ווידג)/.test(t)) { pending = async () => { const r = await ag('/api/sys/power', { action: 'poweroff' }).catch(() => ({})); return r.ok ? 'מכבה. להתראות!' : 'לא זמין כרגע.'; }; return 'לכבות את המחשב? אמור כן לאישור.'; }
    if (/(מצב כהה|ערכת כהה|מצב לילה)/.test(t)) { store.set('mode', 'dark'); DaniApplyAppearance(); return 'עברתי למצב כהה.'; }
    if (/(מצב בהיר|מצב יום)/.test(t)) { store.set('mode', 'light'); DaniApplyAppearance(); return 'עברתי למצב בהיר.'; }
    if (/מצב אוטומטי/.test(t)) { store.set('mode', 'auto'); DaniApplyAppearance(); return 'המצב ישתנה אוטומטית לפי השעה.'; }
    if (/(צבע ראשי|צבע הדגשה|צבע המערכת)/.test(t)) { const a = word(t, ACC); if (a == null) return 'באיזה צבע? אדום, כחול, ירוק, סגול, כתום או כהה.'; store.set('accent', a); DaniApplyAppearance(); return 'שיניתי את הצבע הראשי.'; }
    if (/(רקע|טפט)/.test(t) && !/(פתח|הפעל)/.test(t)) { const w = word(t, WALLS); if (!w) { openSettings('wall'); return 'פתחתי את הגדרות הרקע.'; } store.set('wall', { kind: 'preset', id: w }); DaniApplyAppearance(); return 'שיניתי את הרקע.'; }
    if (/(הגבר|תגביר|יותר חזק|הרם)/.test(t)) return vol(+15); if (/(הנמך|תנמיך|יותר שקט|הנמכה)/.test(t)) return vol(-15); if (/(השתק|שקט)/.test(t)) return vol(0, true);
    if ((m = /(?:עוצמה|עוצמת קול|ווליום)(?: ל)? ?(\d+|\S+)/.exec(t))) { const n = toNum(m[1]); if (!isNaN(n)) return vol(n, false, true); }
    if ((m = /(?:וידג'ט|ווידג'ט|וידג׳ט|ווידג׳ט|ווידג|וידג)(?:ים|ט)? ?(.*)/.exec(raw.replace(/[׳']/g, "'")) || /(?:ווידג|וידג)\S* ?(.*)/.exec(t))) {
      const ids = { שעון: 'clock', לוח: 'calendar', שנה: 'calendar', פתק: 'notes', מערכת: 'system' }; const k = Object.keys(ids).find(x => t.includes(x)); const on = !/(כבה|הסר|הסתר)/.test(t);
      if (k) { const cur = new Set(store.get('widgets', ['clock'])); on ? cur.add(ids[k]) : cur.delete(ids[k]); store.set('widgets', [...cur]); DaniWidgets.refresh(); return on ? 'הוספתי את הווידג\'ט.' : 'הסרתי את הווידג\'ט.'; } openSettings('widgets'); return 'פתחתי את הגדרות הווידג\'טים.';
    }
    if ((m = /^(?:צור|תצור|הוסף|פתח)(?: לי)? (תיקייה|תיקיה|קובץ)(?: חדשה| חדש)? ?(.*)$/.exec(t)) && m[2]) { const nm = m[2].replace(/[\/\\]/g, '_'); try { m[1] === 'קובץ' ? await ag('/api/fs/write', { path: '/Desktop/' + nm + '.txt', text: '' }) : await ag('/api/fs/mkdir', { path: '/Desktop/' + nm }); window.DaniDesktopRefresh && DaniDesktopRefresh(); return 'יצרתי ' + m[1] + ' "' + nm + '" על שולחן העבודה.'; } catch { return 'לא הצלחתי ליצור.'; } }
    if (/^(?:פתח|הפעל|תפתח|תפעיל|הצג|עבור ל|לך ל|פתיחת)(?: את)? (.+)$/.test(t)) { const id = findApp(t.replace(/^\S+(?: את)? /, '')); if (id) { openApp(id); return 'פותח את ' + APP_NAMES[id] + '.'; } }
    { const c = calc(t); if (c) return c; }
    if (/^(?:ספר|תספר)(?: לי)? בדיחה/.test(t)) return ['למה המחשב הלך לרופא? כי היה לו וירוס.', 'מה אמר הקובץ לתיקייה? אני מרגיש מכווץ.', 'למה המתכנת עזב? לא היה לו מספיק מקום בזיכרון.'][Math.floor(Math.random() * 3)];
    const id = findApp(t); if (id && t.split(' ').length <= 3) { openApp(id); return 'פותח את ' + APP_NAMES[id] + '.'; }
    return 'לא הבנתי את זה. אני עוזר מקומי, ואני מבין פקודות כמו "פתח גלריה", "שנה רקע לכחול", "נעל את המחשב" או "חפש חדשות". אמור "עזרה" לרשימה מלאה.';
  }
  async function vol(n, mute, abs) {
    try { const cur = await ag('/api/sys/volume'); if (mute) { await ag('/api/sys/volume', { muted: !cur.muted }); return cur.muted ? 'ביטלתי את ההשתקה.' : 'השתקתי.'; } const v = Math.max(0, Math.min(100, abs ? n : cur.volume + n)); await ag('/api/sys/volume', { volume: v }); return 'עוצמת הקול ' + v + ' אחוז.'; } catch { return 'לא הצלחתי לשנות את עוצמת הקול.'; }
  }

  /* ---------- voice ---------- */
  const synth = window.speechSynthesis;
  function say(text) {
    if (!store.get('aiVoice', true) || !synth) return; try { synth.cancel(); const u = new SpeechSynthesisUtterance(String(text).replace(/[•\n]+/g, '. ')); u.lang = 'he-IL'; const v = synth.getVoices().find(x => /^he/i.test(x.lang)); if (v) u.voice = v; u.pitch = .5; u.rate = .92; synth.speak(u); } catch { }
  }

  function ai(root) {
    root.innerHTML = `<div class="ai"><div class="log"></div><div class="chips">${['פתח גלריה', 'מה השעה', 'שנה רקע לכחול', 'מצב כהה', 'חפש חדשות', 'עזרה'].map(c => `<span>${c}</span>`).join('')}</div>
      <div class="in"><button id="mic" title="דבר">${MIC}</button><input id="q" placeholder="כתוב או דבר אליי…" autocomplete="off"><button id="vo" title="קול">${store.get('aiVoice', true) ? SPK : SPKX}</button><button id="sd" title="שלח">${SEND}</button></div></div>`;
    const log = $('.log', root), q = $('#q', root);
    const add = (t, who) => { const d = document.createElement('div'); d.className = 'm ' + who; d.textContent = t; log.appendChild(d); log.scrollTop = log.scrollHeight; };
    const ask = async text => { text = String(text || '').trim(); if (!text) return; add(text, 'u'); q.value = ''; let r; try { r = await understand(text); } catch (e) { r = 'משהו השתבש: ' + e.message; } add(r, 'a'); say(r); };
    add('שלום, אני DANI AI. מה לעשות? (אפשר להקליד, או ללחוץ על המיקרופון ולדבר)', 'a');
    $('#sd', root).onclick = () => ask(q.value); q.onkeydown = e => { if (e.key === 'Enter') ask(q.value); }; $('.chips', root).onclick = e => { if (e.target.tagName === 'SPAN') ask(e.target.textContent); };
    $('#vo', root).onclick = e => { const on = !store.get('aiVoice', true); store.set('aiVoice', on); e.currentTarget.innerHTML = on ? SPK : SPKX; if (!on && synth) synth.cancel(); else say('הקול פועל'); };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $('#mic', root); let rec = null;
    mic.onclick = () => {
      if (!SR) return add('זיהוי קול לא זמין בדפדפן הזה. אפשר להקליד.', 'a');
      if (rec) { rec.stop(); return; } rec = new SR(); rec.lang = 'he-IL'; rec.interimResults = false; mic.classList.add('on');
      rec.onresult = e => ask(e.results[0][0].transcript); rec.onerror = e => add(e.error === 'network' || e.error === 'service-not-allowed' ? 'זיהוי הקול דורש חיבור לשירות זיהוי דיבור, ולא זמין כרגע. אפשר להקליד.' : e.error === 'not-allowed' ? 'אין הרשאה למיקרופון.' : 'לא שמעתי. נסה שוב.', 'a');
      rec.onend = () => { rec = null; mic.classList.remove('on'); }; try { rec.start(); } catch { rec = null; mic.classList.remove('on'); }
    };
    setTimeout(() => q.focus(), 50);
    root.__ask = ask;
  }
  APPS.ai = { title: 'DANI AI', icon: ICONS.ai, w: 430, h: 560, render: ai };
  window.DaniAskAI = text => { openApp('ai'); setTimeout(() => wins.ai && wins.ai.el.querySelector('.ai') && wins.ai.el.querySelector('.ai').parentElement.__ask && wins.ai.el.querySelector('.ai').parentElement.__ask(text), 200); };
};
