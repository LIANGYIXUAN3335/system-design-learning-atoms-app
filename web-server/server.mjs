import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 8080);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.png': 'image/png' };

http.createServer((req, res) => {
  const requested = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requested === '/' ? '/index.html' : requested;
  const safe = path.normalize(relative).replace(/^\.\.(\/|\\|$)/, '');
  let file = path.join(root, safe);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  // The HTML chooses the hashed Expo bundle. Never serve an old HTML shell after a
  // deploy, while allowing immutable assets to stay fast in browser/CDN caches.
  const isHtmlShell = path.basename(file) === 'index.html';
  res.writeHead(200, {
    'content-type': contentTypes[path.extname(file)] || 'application/octet-stream',
    'cache-control': isHtmlShell ? 'no-cache, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Atoms web listening on ${port}`));
