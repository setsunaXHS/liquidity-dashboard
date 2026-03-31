// 美元流动性看板 - 本地代理服务
// 用法: node server.js
// 默认端口: 8766

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { URLSearchParams } = require('url');

const PORT = 8766;
const FRED_HOST = 'api.stlouisfed.org';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function fredProxy(req, res, parsedUrl) {
  const qs = req.url.replace(/^\/fred\??/, '');
  const fredPath = '/fred/series/observations?' + qs;
  const options = {
    hostname: FRED_HOST,
    port: 443,
    path: fredPath,
    method: 'GET',
    headers: { 'User-Agent': 'liquidity-dashboard/1.0' }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: e.message }));
  });

  proxyReq.end();
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
    res.end();
    return;
  }

  // FRED proxy
  if (pathname === '/fred') {
    fredProxy(req, res, parsedUrl);
    return;
  }

  // Static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ 看板服务已启动: http://localhost:${PORT}`);
  console.log(`   FRED 代理: http://localhost:${PORT}/fred?series_id=WALCL&api_key=...`);
});
