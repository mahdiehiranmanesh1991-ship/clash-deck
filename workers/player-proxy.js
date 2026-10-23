// OPTIONAL: tiny Cloudflare Worker so the API key never sits on the phone.
// 1) Create a key at developer.clashroyale.com with allowed IP 45.79.218.79 (RoyaleAPI proxy).
// 2) Deploy this worker, add secret CR_API_TOKEN (wrangler secret put CR_API_TOKEN).
// 3) In the app: Settings → Advanced → server URL = https://<your-worker>.workers.dev/v1
// Only GET /v1/players/%23TAG is forwarded; everything else is rejected.
const ALLOW_ORIGIN = '*'; // or 'https://<user>.github.io'
export default {
  async fetch(request, env) {
    const cors = { 'access-control-allow-origin': ALLOW_ORIGIN, 'access-control-allow-headers': 'accept', 'access-control-allow-methods': 'GET' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/v1\/players\/%23([0289PYLQGRJCUV]{3,14})$/i);
    if (request.method !== 'GET' || !m) return new Response('Not found', { status: 404, headers: cors });
    const res = await fetch(`https://proxy.royaleapi.dev/v1/players/%23${m[1].toUpperCase()}`, {
      headers: { authorization: `Bearer ${env.CR_API_TOKEN}`, accept: 'application/json' },
      cf: { cacheTtl: 120 },
    });
    return new Response(res.body, { status: res.status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'public, max-age=120' } });
  },
};
