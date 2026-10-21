// Do tai tai thoi diem khoa cache het han.
//   node scripts/load-test.mjs nolock   -> ban goc, khong khoa
//   node scripts/load-test.mjs lock     -> ban co khoa phan tan
//   node scripts/load-test.mjs ttl      -> kiem tra TTL lech ngau nhien
import Redis from 'ioredis';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 200); // so nguoi xem dong thoi
const DURATION_MS = Number(process.env.DURATION_MS ?? 3000);
const EXPIRE_AFTER_MS = 1000; // khoa het han sau 1s ke tu luc bat dau tai
const PRODUCT_ID = '1';

const mode = process.argv[2] ?? 'lock';
const redis = new Redis(REDIS_URL);
const cacheKey = (id) => `shopfast:product:${id}`;
const lockKey = (id) => `lock:shopfast:product:${id}`;

const api = (path, init) => fetch(`${BASE_URL}${path}`, init).then((r) => r.json());

async function stampede(path) {
  await redis.del(cacheKey(PRODUCT_ID), lockKey(PRODUCT_ID));
  await api(path); // lam nong cache
  await api('/debug/stats/reset', { method: 'POST' });
  await redis.pexpire(cacheKey(PRODUCT_ID), EXPIRE_AFTER_MS); // het han that, giua luc dang tai

  const latencies = [];
  const statuses = {};
  const startedAt = Date.now();

  const worker = async () => {
    while (Date.now() - startedAt < DURATION_MS) {
      const t0 = performance.now();
      const res = await fetch(`${BASE_URL}${path}`);
      await res.arrayBuffer();
      latencies.push(performance.now() - t0);
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const { dbQueries } = await api('/debug/stats');
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))].toFixed(0);

  console.log(`\nMode: ${mode}  (${path})`);
  console.log(`Concurrency: ${CONCURRENCY}, duration: ${DURATION_MS}ms, cache expires at +${EXPIRE_AFTER_MS}ms`);
  console.table({
    'Tong request': latencies.length,
    'HTTP status': JSON.stringify(statuses),
    'Truy van DB khi khoa het han': dbQueries,
    'Latency p50 (ms)': pct(0.5),
    'Latency p99 (ms)': pct(0.99),
    'Latency max (ms)': latencies.at(-1).toFixed(0),
  });
}

async function ttlCheck() {
  const ids = Array.from({ length: 10 }, (_, i) => String(i + 1));
  await redis.del(...ids.map(cacheKey));
  for (const id of ids) await api(`/products/${id}`);
  const rows = {};
  for (const id of ids) rows[cacheKey(id)] = { TTL: await redis.ttl(cacheKey(id)) };
  console.table(rows);
}

try {
  if (mode === 'ttl') await ttlCheck();
  else await stampede(mode === 'nolock' ? `/products/${PRODUCT_ID}/no-lock` : `/products/${PRODUCT_ID}`);
} finally {
  await redis.quit();
}
