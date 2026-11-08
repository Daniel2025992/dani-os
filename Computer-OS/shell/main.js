// Electron wrapper: full-screen kiosk window that hosts the DANI OS shell (or the installer).
// Pages are served from a tiny local HTTP server (127.0.0.1 only) because Chromium blocks fetch() on file:// URLs,
// and the shell needs to read ../../Shared/*.json. <webview> is enabled so the built-in browser opens real sites.
const { app, BrowserWindow } = require('electron');
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
  const win = new BrowserWindow({
    fullscreen: !dev, width: 1280, height: 800, backgroundColor: '#e11d2e', autoHideMenuBar: true,
    webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.once('did-finish-load', () => { try { require('fs').writeFileSync('/tmp/dani-ready', 'ok'); } catch (e) {} });
  win.loadURL(`http://127.0.0.1:${port}/${PAGE}`);
});
app.on('window-all-closed', () => app.quit());
