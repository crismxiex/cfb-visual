import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../extension/', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const target = path.resolve(root, `.${decodeURIComponent(name === '/' ? '/dashboard.html' : name)}`);
    if (!target.startsWith(root + path.sep) && target !== path.join(root, 'dashboard.html')) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Saturday controller layout: http://127.0.0.1:4173 (install the extension to control real Chrome tabs)'));
