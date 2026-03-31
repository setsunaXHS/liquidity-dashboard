// Cloudflare Worker - FRED API 代理
// 部署到 Cloudflare Workers 后填入 worker URL

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const params = url.searchParams.toString()
  const fredUrl = `https://api.stlouisfed.org/fred/series/observations?${params}`

  const response = await fetch(fredUrl, {
    headers: { 'User-Agent': 'liquidity-dashboard/1.0' }
  })

  const data = await response.json()

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    }
  })
}
