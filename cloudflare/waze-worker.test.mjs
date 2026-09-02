import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {sanitizeFeed} from './waze-worker.mjs';

// Cloudflare provides this global; Node's test runner does not.
globalThis.caches = undefined;

const now = Date.now();
const fixture = {endTimeMillis: now, alerts: [{type: 'HAZARD', street: 'Grove Loop',
  location: {x: -89.52, y: 34.36}, reliability: 8, confidence: 3,
  uuid: 'private-id', reportBy: 'private-driver', reportDescription: 'private-comment'}],
  jams: [{street: 'Grove Loop', level: 3, speed: 5, delay: 60, length: 200,
    line: [{x: -89.52, y: 34.36}, {x: -89.51, y: 34.36}]}]};
const env = {PUBLIC_TRAFFIC_ENABLED: 'true',
  WAZE_FEED_URL: 'https://www.waze.com/partnerhub-api/partners/123/waze-feeds/test-token?format=1'};
const req = () => new Request('https://test.workers.dev/waze.json');
const ctx = {waitUntil: promise => promise};

test('only public allowlisted fields survive; Waze m/s converts to km/h', () => {
  const data = sanitizeFeed(fixture, now);
  assert.equal(data.alerts[0].street, 'Grove Loop');
  assert.equal(data.jams[0].speedKMH, 18);
  assert.equal(data.meta.sourceUpdatedAt, new Date(now).toISOString());
  assert.ok(!JSON.stringify(data).includes('private-'));
});

test('fresh empty data is distinct from unavailable or stale data', () => {
  assert.deepEqual(sanitizeFeed({endTimeMillis: now, alerts: [], jams: []}, now).alerts, []);
  for (const bad of [{}, {...fixture, endTimeMillis: now - 600001},
    {...fixture, endTimeMillis: now + 120001}, {...fixture, jams: 'broken'}]) {
    assert.throws(() => sanitizeFeed(bad, now));
  }
});

test('malformed coordinates and numeric HTML are not published', () => {
  const data = sanitizeFeed({...fixture, alerts: [{type: 'HAZARD',
    location: {x: '<script>', y: 34}, reliability: '<img>'}]}, now);
  assert.equal(data.alerts[0].location, undefined);
  assert.equal(data.alerts[0].reliability, undefined);
});

test('release gate, path, method and upstream URL restrictions fail closed', async () => {
  assert.equal((await worker.fetch(req(), {}, ctx)).status, 503);
  assert.equal((await worker.fetch(new Request('https://test.workers.dev/other'), env, ctx)).status, 404);
  assert.equal((await worker.fetch(new Request(req(), {method: 'POST'}), env, ctx)).status, 405);
  assert.equal((await worker.fetch(req(), {...env, WAZE_FEED_URL: 'https://example.com'}, ctx)).status, 503);
  const preflight = await worker.fetch(new Request(req(), {method: 'OPTIONS'}), env, ctx);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://lcema36.github.io');
});

test('live response is sanitized; cached responses avoid another upstream call', async t => {
  let saved, calls = 0;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    assert.equal(options.redirect, 'manual');
    calls++; return Response.json(fixture);
  });
  t.mock.property(globalThis, 'caches', {default: {
    match: async () => saved?.clone(), put: async (_, response) => {saved = response;}
  }});
  const response = await worker.fetch(req(), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).jams[0].speedKMH, 18);
  assert.equal((await worker.fetch(req(), env, ctx)).status, 200);
  assert.equal(calls, 1);
});

test('redirects are not followed and only the destination hostname is logged', async t => {
  const logs = [];
  t.mock.method(console, 'warn', (...args) => logs.push(args));
  t.mock.property(globalThis, 'caches', {default: {match: async () => undefined}});
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, {status: 302, headers: {
      location: 'https://www.waze.com/private-test-token?secret=private-test-secret'
    }});
  });
  const response = await worker.fetch(req(), env, ctx);
  assert.equal(response.status, 502);
  assert.equal(logs[0][1].upstreamStatus, 302);
  assert.equal(logs[0][1].redirectHost, 'www.waze.com');
  assert.ok(!JSON.stringify(logs).includes('private-test'));
  assert.ok(!(await response.text()).includes('private-test'));
});

test('upstream errors do not leak the feed URL or imply empty roads', async t => {
  const logs = [];
  t.mock.method(console, 'warn', (...args) => logs.push(args));
  t.mock.property(globalThis, 'caches', {default: {match: async () => undefined}});
  t.mock.method(globalThis, 'fetch', async () => {throw new Error(env.WAZE_FEED_URL);});
  const response = await worker.fetch(req(), env, ctx);
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.ok(!body.includes('test-token'));
  assert.ok(!body.includes('"alerts":[]'));
  assert.ok(!JSON.stringify(logs).includes('test-token'));
  assert.equal(logs[0][1].reason, 'request');
});
