// Продакшен-сервер: отдаёт собранный сайт (dist) и API — вход, общие данные, файлы, анализ P&L.
// Запуск: node --env-file=.env.production server/index.js (работает за nginx на 127.0.0.1).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { createData } from './data.js';
import { validators } from './rules.js';
import { createNotifications } from './notifications.js';
import { createReviews } from './reviews.js';
import { createTraining } from './training.js';
import { createPnlHandler } from './pnlAnalysis.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const dataDir = path.resolve(root, env.DATA_DIR || 'server/data');
const distDir = path.join(root, 'dist');
const port = Number(env.PORT || 3110);
const host = env.HOST || '127.0.0.1';
const secure = env.COOKIE_SECURE === '1';

const auth = createAuth({ file: path.join(dataDir, 'auth.json'), env, secure, trustProxy: true });
const notifications = createNotifications({ file: path.join(dataDir, 'notifications.json'), auth });
const data = createData({ dir: dataDir, auth, validators, onSaved: notifications.onSaved });
const reviews = createReviews({ env, auth, file: path.join(dataDir, 'reviews.json') });
const training = createTraining({ file: path.join(dataDir, 'training.json'), auth, data });
const handlers = [auth.handler, data.handler, notifications.handler, reviews.handler, training.handler, createPnlHandler(env, auth)];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Не найдено' }));
  }
  let file = path.normalize(path.join(distDir, decodeURIComponent(url.pathname)));
  if (!file.startsWith(distDir)) {
    res.statusCode = 400;
    return res.end();
  }
  // Любой неизвестный путь (например, /invite/…) — это страница приложения.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
  const isAsset = file.includes(`${path.sep}assets${path.sep}`);
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', isAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  let i = 0;
  const next = () => {
    const h = handlers[i++];
    if (!h) return serveStatic(req, res);
    Promise.resolve(h(req, res, next)).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  };
  next();
});

// SSE-соединения держатся долго — не обрываем их по таймауту.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.listen(port, host, () => console.log(`KAKDELA: http://${host}:${port}`));
