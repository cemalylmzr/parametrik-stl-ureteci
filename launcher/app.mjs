import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const EXPORTS_DIR = path.join(ROOT_DIR, 'exports');

const PREFERRED_PORT = 4173;
const APP_ID = 'parametric-stl-generator-v1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

const KEEPALIVE_SNIPPET = `
<script>
  (function () {
    try {
      var es = new EventSource('/__keepalive');
      window.addEventListener('beforeunload', function () {
        try { es.close(); } catch (_) {}
      });
    } catch (_) {}
  })();
</script>
`;

function findChromiumBrowser() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const exe of candidates) {
    if (exe && fs.existsSync(exe)) return exe;
  }
  return null;
}

function openDesktopWindow(url) {
  if (process.env.NO_OPEN === '1') return;
  const browser = findChromiumBrowser();
  if (browser) {
    const child = spawn(
      browser,
      [
        `--app=${url}`,
        '--window-size=1400,880',
        '--new-window',
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }
    );
    child.unref();
    return;
  }

  // Yedek: varsayılan sistem tarayıcısında aç
  const child = spawn('cmd.exe', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function checkExistingInstance(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/__health', timeout: 600 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body.trim() === APP_ID));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startServer() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error('dist/index.html bulunamadı. Önce npm run build çalıştırın.');
    process.exit(1);
  }

  let activeClients = 0;
  let hasHadClient = false;
  let shutdownTimer = null;

  const scheduleShutdown = (delayMs) => {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => {
      if (activeClients <= 0) {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 500).unref();
      }
    }, delayMs);
    shutdownTimer.unref();
  };

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname === '/__health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(APP_ID);
      return;
    }

    if (pathname === '/__save-stl' && req.method === 'POST') {
      const rawName = reqUrl.searchParams.get('name') || 'model.stl';
      const baseName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeName = baseName.toLowerCase().endsWith('.stl')
        ? baseName
        : `${baseName}.stl`;

      const chunks = [];
      let totalBytes = 0;
      const MAX_BYTES = 100 * 1024 * 1024; // 100 MB güvenlik limiti

      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes <= MAX_BYTES) chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          fs.mkdirSync(EXPORTS_DIR, { recursive: true });
          const targetPath = path.join(EXPORTS_DIR, safeName);
          fs.writeFileSync(targetPath, Buffer.concat(chunks));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ saved: true, path: targetPath }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ saved: false, error: String(err) }));
        }
      });
      return;
    }

    if (pathname === '/__keepalive') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');

      activeClients += 1;
      hasHadClient = true;
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      }

      const pingInterval = setInterval(() => {
        res.write(': ping\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(pingInterval);
        activeClients = Math.max(0, activeClients - 1);
        if (activeClients === 0) {
          // F5 yenileme için 4 saniye bekle, hâlâ pencere yoksa temizce kapan
          scheduleShutdown(4000);
        }
      });
      return;
    }

    // Statik dosya çözümü (path traversal korumalı)
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const fullPath = path.resolve(DIST_DIR, relPath);
    if (!fullPath.startsWith(DIST_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let fileToServe = fullPath;
    if (!fs.existsSync(fileToServe) || fs.statSync(fileToServe).isDirectory()) {
      fileToServe = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(fileToServe).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    if (fileToServe.endsWith('index.html')) {
      let html = fs.readFileSync(fileToServe, 'utf8');
      html = html.replace('</body>', `${KEEPALIVE_SNIPPET}</body>`);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(fileToServe).pipe(res);
  });

  // Başlangıçta pencere 25 saniye içinde bağlanmazsa boşta kalma
  scheduleShutdown(25000);

  const onListening = () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : PREFERRED_PORT;
    const url = `http://127.0.0.1:${actualPort}/`;
    openDesktopWindow(url);
  };

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // Başka bir uygulama 4173'ü kullanıyorsa otomatik boş port seç
      server.listen(0, '127.0.0.1', onListening);
    } else {
      console.error(err);
      process.exit(1);
    }
  });

  server.listen(PREFERRED_PORT, '127.0.0.1', onListening);
}

async function main() {
  const alreadyRunning = await checkExistingInstance(PREFERRED_PORT);
  if (alreadyRunning) {
    openDesktopWindow(`http://127.0.0.1:${PREFERRED_PORT}/`);
    process.exit(0);
  }
  startServer();
}

main();
