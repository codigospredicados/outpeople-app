const COLLECTIONS = new Set(['distritos', 'municipios', 'freguesias']);
const SOURCE = 'https://ogcapi.dgterritorio.gov.pt/collections';
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const CACHE_BYTES = 16 * 1024 * 1024;
const TTL = 60 * 60 * 1000;

export class BoundaryTileError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function validTile(collection, z, x, y) {
  if (!COLLECTIONS.has(collection) || ![z, x, y].every(value => /^\d+$/.test(String(value)))) return false;
  return Number(z) <= 14 && Number(x) < 2 ** Number(z) && Number(y) < 2 ** Number(z);
}

export function createBoundaryTiles({ request = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  const waiting = [];
  let active = 0;
  let bytes = 0;
  async function acquire() {
    if (active < 4) { active++; return; }
    if (waiting.length >= 64) throw new BoundaryTileError('Serviço de limites ocupado. Tente novamente.', 503);
    await new Promise(resolve => waiting.push(resolve));
  }
  function release() {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
  function remove(key) { bytes -= cache.get(key).body.length; cache.delete(key); }
  return {
    async get(collection, z, x, y) {
      if (!validTile(collection, z, x, y)) throw new BoundaryTileError('Mosaico administrativo inválido.', 400);
      const key = `${collection}/${Number(z)}/${Number(x)}/${Number(y)}`;
      const cached = cache.get(key);
      if (cached?.expires > now()) return cached.body;
      if (cached) remove(key);
      if (pending.has(key)) return pending.get(key);
      const task = Promise.resolve().then(async () => {
        await acquire();
        try {
          // OGC API Tiles uses matrix / row / column, i.e. z / y / x.
          const url = `${SOURCE}/${collection}/tiles/WebMercatorQuad/${Number(z)}/${Number(y)}/${Number(x)}?f=mvt`;
          const response = await request(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.mapbox-vector-tile', 'User-Agent': 'OurPeople/0.1 administrative-map' } });
          if (!response.ok) throw new BoundaryTileError('Não foi possível carregar os limites administrativos.');
          const type = response.headers.get('content-type') || '';
          if (response.status !== 204 && !/protobuf|mapbox-vector-tile|octet-stream/i.test(type)) throw new BoundaryTileError('Resposta inválida do serviço de limites.');
          const chunks = [];
          let size = 0;
          if (response.body) for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_TILE_BYTES) throw new BoundaryTileError('O mosaico excede o tamanho permitido.');
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          while (cache.size >= 128 || bytes + body.length > CACHE_BYTES) remove(cache.keys().next().value);
          cache.set(key, { body, expires: now() + TTL }); bytes += body.length;
          return body;
        } catch (error) {
          if (error instanceof BoundaryTileError) throw error;
          throw new BoundaryTileError('O serviço de limites está temporariamente indisponível.');
        } finally { release(); }
      }).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    }
  };
}
