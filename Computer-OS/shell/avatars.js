/* Drawn user avatars (no emoji). Avatar ids are "a0".."a7"; anything else (old emoji profiles) falls back to a0. */
(function () {
  const COL = [['#ff6b78', '#b3101f'], ['#60a5fa', '#1d4ed8'], ['#4ade80', '#15803d'], ['#c084fc', '#7e22ce'], ['#fdba74', '#c2410c'], ['#94a3b8', '#334155'], ['#fde047', '#a16207'], ['#f9a8d4', '#be185d']];
  const GLY = [
    '<circle cx="24" cy="19" r="7"/><path d="M10 39c2-8 8-11 14-11s12 3 14 11z"/>',                                  // person
    '<path d="M24 8l4 9 10 1-7.5 6.5L33 34l-9-5-9 5 2.5-9.5L10 18l10-1z"/>',                                         // star
    '<path d="M24 38S9 29 9 19a8 8 0 0 1 15-4 8 8 0 0 1 15 4c0 10-15 19-15 19z"/>',                                  // heart
    '<path d="M27 6L14 26h9l-2 16 13-20h-9z"/>',                                                                       // bolt
    '<rect x="8" y="15" width="32" height="20" rx="8"/><circle cx="17" cy="25" r="2.5" fill="#000" opacity=".35"/><circle cx="31" cy="25" r="2.5" fill="#000" opacity=".35"/>', // game pad-ish face
    '<path d="M24 6c6 5 8 12 7 20l5 6-6 1-3 5-3-4-3 4-3-5-6-1 5-6c-1-8 1-15 7-20z"/>',                              // rocket
    '<path d="M32 8a16 16 0 1 0 8 22A13 13 0 0 1 32 8z"/>',                                                            // moon
    '<path d="M24 8c8 6 12 13 8 21-2 4-6 6-8 11-2-5-6-7-8-11-4-8 0-15 8-21z"/>'                                       // flame
  ];
  window.DANI_AVATARS = GLY.map((_, i) => 'a' + i);
  window.DaniAvatar = function (id, px) {
    const i = /^a[0-7]$/.test(id || '') ? +id[1] : 0, c = COL[i], g = 'avg' + i;
    return `<svg viewBox="0 0 48 48" style="width:${px || '100%'}px;height:${px || '100%'}px;display:block;border-radius:50%"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs><rect width="48" height="48" fill="url(#${g})"/><g fill="#fff">${GLY[i]}</g></svg>`;
  };
  window.DaniAvatarId = a => /^a[0-7]$/.test(a || '') ? a : 'a0';
})();

/* Administrator password policy: at least 10 characters with lower case, upper case, a digit and a symbol. Returns '' when OK. */
window.DaniPw = { check: p => { p = String(p || ''); if (p.length < 10) return 'הסיסמה חייבת להיות לפחות 10 תווים'; if (!/[a-z]/.test(p)) return 'חסרה אות קטנה (a-z)'; if (!/[A-Z]/.test(p)) return 'חסרה אות גדולה (A-Z)'; if (!/\d/.test(p)) return 'חסרה ספרה'; if (!/[^A-Za-z0-9]/.test(p)) return 'חסר סימן מיוחד (למשל @ # ! $ %)'; return ''; },
  hint: 'לפחות 10 תווים: אות גדולה, אות קטנה, ספרה וסימן מיוחד (@ # ! $ ...)' };
