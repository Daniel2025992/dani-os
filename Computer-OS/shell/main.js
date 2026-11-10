// Electron wrapper: full-screen kiosk window that hosts the DANI OS shell (or the installer).
// Pages are served from a tiny local HTTP server (127.0.0.1 only) because Chromium blocks fetch() on file:// URLs,
// and the shell needs to read ../../Shared/*.json. <webview> is enabled so the built-in browser opens real sites.
const { app, BrowserWindow, session } = require('electron');
let mainWin = null;
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');          // .../DANI-OS or /opt/dani-os
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const argPage = (process.argv.find(a => a.startsWith('--page=')) || '').slice(7);
const PAGE = argPage || 'Computer-OS/shell/index.html';
const dev = process.argv.includes('--dev');

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.resolve(ROOT, '.' + rel);
      // stay inside ROOT, and never serve account data or node_modules internals
      if (!file.startsWith(ROOT + path.sep) || /[\\/](data|node_modules)[\\/]/.test(file)) { rsp.writeHead(403); return rsp.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { rsp.writeHead(404); return rsp.end(); }
        rsp.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        rsp.end(buf);
      });
    });
    // fixed port: the page origin (incl. port) keys localStorage, so a random port would forget the user/apps on every boot
    srv.on('error', () => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
    srv.listen(17788, '127.0.0.1', () => res(srv.address().port));
  });
}

app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.whenReady().then(async () => {
  const port = await serve();
  const win = mainWin = new BrowserWindow({
    fullscreen: !dev, width: 1280, height: 800, backgroundColor: '#e11d2e', autoHideMenuBar: true,
    webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.once('did-finish-load', () => { try { require('fs').writeFileSync('/tmp/dani-ready', 'ok'); } catch (e) {} });
  // sites should treat the built-in browser like normal Chrome (many block the 'Electron' token)
  const UA = app.userAgentFallback.replace(/\sElectron\/\S+/, '').replace(/\s[a-z-]+\/\d[\d.]*(?=\sChrome|$)/i, (m) => /Chrome|Safari/.test(m) ? m : '');
  const setupSession = (ses) => {
    try { ses.setUserAgent(UA); } catch (e) {}
    ses.on('will-download', (ev, item) => {                       // downloads from the built-in browser go to ~/Downloads
      try {
        const dir = path.join(require('os').homedir(), 'Downloads'); fs.mkdirSync(dir, { recursive: true });
        let name = (item.getFilename() || 'download').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '_'), target = path.join(dir, name), i = 1;
        const ext = path.extname(name), stem = name.slice(0, name.length - ext.length); while (fs.existsSync(target)) target = path.join(dir, stem + ' (' + i++ + ')' + ext);
        item.setSavePath(target);
        const say = (t) => mainWin && mainWin.webContents.executeJavaScript('window.toast&&toast(' + JSON.stringify(t) + ')').catch(() => {});
        say('מוריד: ' + name);
        item.once('done', (e2, state) => say(state === 'completed' ? 'ההורדה הסתיימה: ' + path.basename(target) + ' (בתיקייה הורדות)' : 'ההורדה נכשלה: ' + name));
      } catch (e) {}
    });
  };
  setupSession(session.defaultSession); setupSession(session.fromPartition('persist:dani'));
  // target=_blank / window.open inside the browser -> a new DANI browser tab
  app.on('web-contents-created', (e, wc) => {
    if (wc.getType() !== 'webview') return;
    wc.on('before-input-event', (ev, input) => {                // browser shortcuts keep working while the page has the keyboard focus
      if (input.type !== 'keyDown') return;
      const k = String(input.key || '').toLowerCase(), c = input.control || input.meta;
      if ((c && ['t', 'w', 'l', 'r', 'f', 'd', '+', '=', '-', '0', 'tab'].includes(k)) || k === 'f5' || (input.alt && (k === 'arrowleft' || k === 'arrowright'))) {
        ev.preventDefault();
        mainWin && mainWin.webContents.executeJavaScript('window.__browserKey&&window.__browserKey(' + JSON.stringify({ ctrl: !!c, alt: !!input.alt, key: input.key }) + ')').catch(() => {});
      }
    });
    wc.on('context-menu', (ev, p) => {            // right-click inside a web page -> DANI's own menu
      if (!mainWin) return;
      let back = false, fwd = false; try { back = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(); fwd = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward(); } catch (e) {}
      const d = { id: wc.id, x: p.x, y: p.y, link: p.linkURL || '', src: p.srcURL || '', media: p.mediaType, sel: p.selectionText || '', edit: !!p.isEditable, page: p.pageURL || wc.getURL(), title: wc.getTitle(), back, fwd };
      mainWin.webContents.executeJavaScript('window.__webMenu&&window.__webMenu(' + JSON.stringify(d) + ')').catch(() => {});
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url) && mainWin) mainWin.webContents.executeJavaScript('window.__openTab&&window.__openTab(' + JSON.stringify(url) + ')').catch(() => {});
      return { action: 'deny' };
    });
  });
  win.loadURL(`http://127.0.0.1:${port}/${PAGE}`);
});
app.on('window-all-closed', () => app.quit());
