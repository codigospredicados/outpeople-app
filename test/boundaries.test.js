import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createBoundaryTiles, BoundaryTileError, validTile } from '../boundary-tiles.js';
import { createFrontendApp } from '../server.js';

const fixture = readFileSync(new URL('./fixtures/distritos.pbf', import.meta.url));
const tileResponse = () => new Response(fixture, { headers: { 'Content-Type': 'application/vnd.mapbox-vector-tile' } });

test('only the three administrative collections and valid bounded tile coordinates are allowed', () => {
  assert.equal(validTile('distritos', '8', '121', '98'), true);
  assert.equal(validTile('freguesias', '14', '0', '0'), true);
  for (const args of [['other', 8, 1, 1], ['distritos', 15, 1, 1], ['distritos', 8, 256, 1], ['municipios', 8, -1, 1], ['distritos', '8.1', 1, 1], ['distritos', 'Infinity', 1, 1]]) assert.equal(validTile(...args), false, JSON.stringify(args));
});

test('tiles use DGT row/column order, aggregate concurrent requests and expire from cache', async () => {
  let calls = 0;
  let clock = 1000;
  const tiles = createBoundaryTiles({ now: () => clock, request: async url => {
    calls++;
    assert.equal(url, 'https://ogcapi.dgterritorio.gov.pt/collections/distritos/tiles/WebMercatorQuad/8/98/121?f=mvt');
    return tileResponse();
  } });
  const [first, second] = await Promise.all([tiles.get('distritos', 8, 121, 98), tiles.get('distritos', 8, 121, 98)]);
  assert.deepEqual(first, fixture); assert.deepEqual(second, fixture); assert.equal(calls, 1);
  await tiles.get('distritos', 8, 121, 98); assert.equal(calls, 1);
  clock += 3600001;
  await tiles.get('distritos', 8, 121, 98); assert.equal(calls, 2);
});

test('invalid upstream responses are rejected and not cached', async () => {
  for (const response of [() => new Response('', { status: 503 }), () => Response.json({ error: 'not a tile' }), () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/octet-stream' } })]) {
    let calls = 0;
    const tiles = createBoundaryTiles({ request: async () => { calls++; return response(); } });
    await assert.rejects(tiles.get('freguesias', 11, 900, 800), BoundaryTileError);
    await assert.rejects(tiles.get('freguesias', 11, 900, 800), BoundaryTileError);
    assert.equal(calls, 2);
  }
});

test('administrative tiles work independently of API authentication and keep a bounded public cache', async t => {
  const tiles = createBoundaryTiles({ request: async () => tileResponse() });
  const server = http.createServer(createFrontendApp({ env: { API_URL: 'http://127.0.0.1:1' }, boundaryTiles: tiles }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/map-data/distritos/8/121/98.pbf`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /mapbox-vector-tile/);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture);
  const bad = await fetch(`${base}/map-data/other/8/121/98.pbf`);
  assert.equal(bad.status, 400); assert.equal(bad.headers.get('cache-control'), 'no-store');
});

test('cancelling one viewer does not interrupt another viewer sharing the same tile', async () => {
  let finish;
  let upstreamSignal;
  let calls = 0;
  const tiles = createBoundaryTiles({ request: async (_url, options) => {
    calls++; upstreamSignal = options.signal;
    return new Promise(resolve => { finish = () => resolve(tileResponse()); });
  } });
  const firstController = new AbortController();
  const first = tiles.get('freguesias', 11, 972, 784, { signal: firstController.signal });
  const second = tiles.get('freguesias', 11, 972, 784);
  await new Promise(resolve => setImmediate(resolve));
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  firstController.abort(); await cancelled;
  assert.equal(upstreamSignal.aborted, false);
  finish(); assert.deepEqual(await second, fixture); assert.equal(calls, 1);
});

test('obsolete queued and active tiles are cancelled so the next viewport can load', async () => {
  const calls = [];
  const tiles = createBoundaryTiles({ request: async (url, { signal }) => {
    calls.push(url);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const requests = controllers.map((controller, i) => tiles.get('freguesias', 11, 972 + i, 784, { signal: controller.signal }));
  const settled = Promise.allSettled(requests);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 4);
  // Cancel the fifth tile while it is still queued, then cancel active work.
  controllers[4].abort();
  for (const controller of controllers.slice(0, 4)) controller.abort();
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
  assert.equal(calls.length, 4);
});

test('slow upstreams produce an identifiable timeout and can be retried', async () => {
  let slow = true;
  const tiles = createBoundaryTiles({ timeoutMs: 20, request: async (_url, { signal }) => {
    if (!slow) return tileResponse();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Missing timeout')), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  } });
  await assert.rejects(tiles.get('freguesias', 11, 972, 784), error => error.code === 'BOUNDARY_UPSTREAM_TIMEOUT');
  slow = false;
  assert.deepEqual(await tiles.get('freguesias', 11, 972, 784), fixture);
});
