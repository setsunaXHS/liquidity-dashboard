// Vercel Serverless Function - FRED API 代理
// 修复：加超时、支持 gzip 解压、限制响应大小
const https = require('https');
const zlib  = require('zlib');

const TIMEOUT_MS = 25000;  // Vercel hobby 限制 ~30s，留 5s 余量

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const params   = new URLSearchParams(req.query).toString();
  const fredUrl  = `https://api.stlouisfed.org/fred/series/observations?${params}`;

  try {
    const data = await new Promise((resolve, reject) => {
      const req2 = https.get(fredUrl, {
        headers: {
          'User-Agent':      'liquidity-dashboard/2.0',
          'Accept-Encoding': 'gzip, deflate',
        }
      }, (r) => {
        // 处理 gzip
        let stream = r;
        const enc  = r.headers['content-encoding'] || '';
        if (enc.includes('gzip'))    stream = r.pipe(zlib.createGunzip());
        if (enc.includes('deflate')) stream = r.pipe(zlib.createInflate());

        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end',  ()    => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
      });

      req2.on('error', reject);
      req2.setTimeout(TIMEOUT_MS, () => {
        req2.destroy();
        reject(new Error('FRED request timed out'));
      });
    });

    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
