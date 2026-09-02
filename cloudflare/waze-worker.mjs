// Private Waze URL belongs ONLY in the WAZE_FEED_URL Cloudflare secret.
// Public release requires PUBLIC_TRAFFIC_ENABLED=true after permission review.
const ORIGIN = 'https://lcema36.github.io';
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  }});
}

function number(value, min = -Infinity, max = Infinity) {
  if (value === null || value === '' || typeof value === 'boolean') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

function point(value) {
  const x = number(value?.x, -180, 180), y = number(value?.y, -90, 90);
  return x === undefined || y === undefined ? undefined : {x, y};
}

function text(value, limit = 180) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, limit) : undefined;
}

function sourceTime(data) {
  for (const key of ['endTimeMillis', 'endTime', 'startTimeMillis', 'startTime']) {
    const v = data[key];
    if (v == null || v === '') continue;
    const ms = /Millis$/.test(key) ? number(v) : Date.parse(v);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return undefined;
}

export function sanitizeFeed(data, now = Date.now()) {
  if (!data || typeof data !== 'object' ||
      (!Array.isArray(data.alerts) && !Array.isArray(data.jams)) ||
      (data.alerts != null && !Array.isArray(data.alerts)) ||
      (data.jams != null && !Array.isArray(data.jams))) throw new Error('Invalid traffic data');
  const updated = sourceTime(data);
  if (!updated || now - updated > MAX_AGE_MS || updated > now + 120000) {
    throw new Error('Traffic feed is stale or has no valid timestamp');
  }
  // Explicit field allowlists: never forward usernames, IDs, comments, images,
  // free-text driver descriptions, private feed URLs, or arbitrary extra fields.
  const alerts = (data.alerts || []).slice(0, 5000).filter(a => a && typeof a === 'object').map(a => ({
    type: text(a.type, 80), subtype: text(a.subtype, 100), street: text(a.street), city: text(a.city),
    roadType: number(a.roadType, 0, 100), pubMillis: number(a.pubMillis, 0, now + 120000),
    location: point(a.location), reliability: number(a.reliability, 0, 10),
    confidence: number(a.confidence, -1, 10), nThumbsUp: number(a.nThumbsUp, 0),
    reportByMunicipalityUser: a.reportByMunicipalityUser === true || a.reportByMunicipalityUser === 'true'
  }));
  const jams = (data.jams || []).slice(0, 5000).filter(j => j && typeof j === 'object').map(j => ({
    street: text(j.street), city: text(j.city), roadType: number(j.roadType, 0, 100),
    pubMillis: number(j.pubMillis, 0, now + 120000), level: number(j.level, 0, 5),
    length: number(j.length, 0), delay: number(j.delay, -1),
    speedKMH: number(j.speedKMH, 0) ?? (number(j.speed, 0) === undefined ? undefined : Number(j.speed) * 3.6),
    line: Array.isArray(j.line) ? j.line.slice(0, 10000).map(point).filter(Boolean) : []
  }));
  return {alerts, jams, endTime: new Date(updated).toISOString(),
    meta: {source: 'Waze', sourceUpdatedAt: new Date(updated).toISOString(),
      fetchedAt: new Date(now).toISOString(), refreshSeconds: 120,
      attribution: 'Data provided by Waze App. Learn more at Waze.com.'}};
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/waze.json') return json({error: 'Not found'}, 404);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {
      'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '600', 'Vary': 'Origin'
    }});
    if (request.method !== 'GET') return json({error: 'Method not allowed'}, 405);
    // CORS restricts browser embedding, not access to this public endpoint.
    // The release gate and field filtering apply to every request.
    if (env.PUBLIC_TRAFFIC_ENABLED !== 'true') return json({error: 'Traffic feed not enabled'}, 503);
    let feed;
    try {
      feed = new URL(env.WAZE_FEED_URL);
      if (feed.protocol !== 'https:' || feed.hostname !== 'www.waze.com' || feed.port ||
          feed.username || feed.password || !/^\/(row-)?partnerhub-api\/partners\/\d+\/waze-feeds\/[a-zA-Z0-9-]+$/.test(feed.pathname)) throw new Error();
      feed.searchParams.set('format', '1');
    } catch { return json({error: 'Traffic feed is not configured'}, 503); }

    const cache = caches.default;
    const key = new Request(url.origin + '/waze-cache-v1');
    try {
      const cached = await cache.match(key);
      if (cached) {
        const data = await cached.json();
        const age = Date.now() - Date.parse(data.meta?.sourceUpdatedAt);
        const cacheAge = Date.now() - Date.parse(data.meta?.fetchedAt);
        if (age >= -120000 && age <= MAX_AGE_MS && cacheAge >= 0 && cacheAge < 120000) return json(data);
      }
    } catch { /* Cache failure does not prevent a fresh request. */ }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let stage = 'request', upstreamStatus, redirectHost;
    try {
      const response = await fetch(feed.href, {signal: controller.signal, redirect: 'manual',
        headers: {'Accept': 'application/json'}});
      upstreamStatus = response.status;
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        redirectHost = new URL(response.headers.get('location'), feed).hostname;
      }
      if (!response.ok) throw new Error('Upstream unavailable');
      stage = 'body';
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Feed too large');
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Feed too large'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      stage = 'json';
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      stage = 'validation';
      const data = sanitizeFeed(parsed);
      const cached = new Response(JSON.stringify(data), {headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120'
      }});
      ctx.waitUntil(cache.put(key, cached).catch(() => {}));
      return json(data);
    } catch (error) {
      // Never echo upstream URLs, credentials, response bodies or exception text.
      // Only fixed diagnostic labels and the HTTP status enter private Worker logs.
      const reason = ['Invalid traffic data', 'Traffic feed is stale or has no valid timestamp',
        'Feed too large'].includes(error?.message) ? error.message : stage;
      console.warn('Waze feed unavailable', {reason, upstreamStatus, redirectHost});
      return json({error: 'Current Waze traffic data is unavailable. Check Waze Live Map.'}, 502);
    } finally { clearTimeout(timer); }
  }
};
