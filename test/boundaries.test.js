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
