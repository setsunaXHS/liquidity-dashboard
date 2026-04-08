// Vercel Serverless Function - 流动性相关市场新闻
// 每日通过智谱 Web Search API 搜索最新新闻，Vercel CDN 缓存 24 小时
const https = require('https');

const ZHIPU_API_KEY = process.env.ZHIPU_SEARCH_API_KEY || process.env.ZHIPU_API_KEY || '';

// 调用智谱 Web Search REST API
function zhipuSearch(query, count = 5) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, count });

    const options = {
      hostname: 'open.bigmodel.cn',
      path: '/api/paas/v4/tools/search_std',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZHIPU_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function searchNews() {
  const queries = [
    'Fed reserve liquidity TGA RRP 2026 latest news',
    '美联储 流动性 准备金 TGA 最新消息 2026',
  ];

  const news = [];
  const seen = new Set();

  for (const q of queries) {
    try {
      const resp = await zhipuSearch(q, 5);
      // 智谱 search_std 返回 { data: { results: [...] } } 或 { results: [...] }
      const results = resp?.data?.results || resp?.results || [];
      for (const r of results) {
        const title  = r.title   || r.name || '';
        const url    = r.link    || r.url  || '';
        const desc   = r.snippet || r.content || r.description || '';
        const date   = r.publish_time || r.published || r.date || '';
        if (!title || seen.has(url)) continue;
        seen.add(url);
        // 过滤：只保留近期（有日期）或高质量来源
        news.push({ title, url, desc: desc.slice(0, 200), date });
        if (news.length >= 5) break;
      }
    } catch (e) {
      console.error('Search error for query:', q, e.message);
    }
    if (news.length >= 3) break;
  }

  return news.slice(0, 3);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  // Vercel CDN 缓存 24 小时，过期后后台静默刷新
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!ZHIPU_API_KEY) {
    return res.status(200).json({
      ok: false,
      error: 'API key not configured',
      news: [],
      fetchedAt: new Date().toISOString(),
    });
  }

  try {
    const news = await searchNews();
    res.status(200).json({
      ok: true,
      news,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      error: e.message,
      news: [],
      fetchedAt: new Date().toISOString(),
    });
  }
};
