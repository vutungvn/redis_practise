// node scripts/bench.mjs compare  -> cung tai hon hop, tat cache (truoc) va bat cache (sau)
// node scripts/bench.mjs chaos    -> bat cache, tat Redis o giay 10, bat lai o giay 20
// node scripts/bench.mjs price    -> doi gia lien tuc trong khi doc, co tat/bat Redis: dem so lan thay gia cu
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6392';
const PROJECT_DIR = fileURLToPath(new URL('..', import.meta.url));
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);
const mode = process.argv[2] ?? 'compare';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, { body, user } = {}) {
  const startedAt = performance.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': String(user) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, startedAt, ms: performance.now() - startedAt };
  } catch {
    return { status: 'ERR', json: null, startedAt, ms: performance.now() - startedAt };
  }
}

// San pham id nho duoc xem nhieu hon (gan voi thuc te: mot nhom nho san pham hot)
const hotProduct = () => 1 + Math.floor(Math.pow(Math.random(), 3) * 2000);
const CATEGORIES = ['phone', 'laptop', 'tablet', 'audio', 'watch', 'camera', 'gaming', 'accessory'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Ti trong luot xem gio cao diem
const WORKLOAD = [
  { name: 'GET /products/:id', weight: 45, run: () => call('GET', `/products/${hotProduct()}`) },
  { name: 'GET /categories/:slug/top-sellers', weight: 20, run: () => call('GET', `/categories/${pick(CATEGORIES)}/top-sellers`) },
  { name: 'GET /categories', weight: 15, run: () => call('GET', '/categories') },
  { name: 'GET /me/orders', weight: 15, run: () => call('GET', '/me/orders', { user: 1 + Math.floor(Math.random() * 1000) }) },
  {
    name: 'POST /orders',
    weight: 4,
    run: () =>
      call('POST', '/orders', {
        user: 1 + Math.floor(Math.random() * 1000),
        body: { items: [{ productId: hotProduct(), qty: 1 }] },
      }),
  },
  {
    name: 'PATCH /admin/products/:id (gia)',
    weight: 1,
    run: () => call('PATCH', `/admin/products/${hotProduct()}`, { body: { price: (100 + Math.floor(Math.random() * 49900)) * 1000 } }),
  },
];
const TOTAL_WEIGHT = WORKLOAD.reduce((s, w) => s + w.weight, 0);
const pickRequest = () => {
  let r = Math.random() * TOTAL_WEIGHT;
  return WORKLOAD.find((w) => (r -= w.weight) < 0) ?? WORKLOAD[0];
};

async function runLoad(durationMs, onTick) {
  const results = [];
  const start = performance.now();
  const worker = async () => {
    while (performance.now() - start < durationMs) {
      const w = pickRequest();
      const r = await w.run();
      results.push({ ...r, name: w.name, at: r.startedAt - start });
    }
  };
  const ticker = onTick ? onTick(start) : null;
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (ticker) await ticker;
  return { results, seconds: (performance.now() - start) / 1000 };
}

const pct = (arr, p) => {
  if (arr.length === 0) return '-';
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
};

async function flushCache() {
  const redis = new Redis(REDIS_URL, { lazyConnect: true });
  await redis.connect();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'sf:v1:*', 'COUNT', 1000);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
  await redis.quit();
}

async function phase(label, enabled, durationMs) {
  await call('PUT', '/admin/cache', { body: { enabled } });
  await flushCache(); // bat dau tu cache rong (khong lam nong truoc) cho cong bang
  await call('POST', '/metrics/reset');
  process.stdout.write(`Dang chay "${label}" ${durationMs / 1000}s, ${CONCURRENCY} ket noi... `);
  const load = await runLoad(durationMs);
  const metrics = (await call('GET', '/metrics')).json;
  console.log('xong');
  return { label, ...load, metrics };
}

async function compare() {
  const duration = Number(process.env.DURATION_MS ?? 20000);
  const before = await phase('TRUOC (tat cache)', false, duration);
  const after = await phase('SAU (bat cache)', true, duration);
  await call('PUT', '/admin/cache', { body: { enabled: true } });

  const summarize = (p) => {
    const ok = p.results.filter((r) => typeof r.status === 'number' && r.status < 500);
    const ms = p.results.map((r) => r.ms);
    return {
      'Tong request': p.results.length,
      'Req/s': Math.round(p.results.length / p.seconds),
      'p50 (ms)': pct(ms, 0.5),
      'p95 (ms)': pct(ms, 0.95),
      'p99 (ms)': pct(ms, 0.99),
      'Loi 5xx': p.results.length - ok.length,
      'Truy van DB': p.metrics.db.queries,
      'Truy van DB / request': (p.metrics.db.queries / p.results.length).toFixed(2),
      'DB thuc thi / request (ms)': (p.metrics.db.execMs / p.results.length).toFixed(2),
      'Cho ket noi DB / request (ms)': (p.metrics.db.waitMs / p.results.length).toFixed(2),
    };
  };
  console.log('\n=== Tong quan ===');
  console.table({ [before.label]: summarize(before), [after.label]: summarize(after) });

  console.log('\n=== Do tre theo endpoint (p50 / p95 ms) ===');
  const rows = {};
  for (const w of WORKLOAD) {
    const b = before.results.filter((r) => r.name === w.name).map((r) => r.ms);
    const a = after.results.filter((r) => r.name === w.name).map((r) => r.ms);
    rows[w.name] = { 'Truoc p50': pct(b, 0.5), 'Truoc p95': pct(b, 0.95), 'Sau p50': pct(a, 0.5), 'Sau p95': pct(a, 0.95) };
  }
  console.table(rows);

  console.log('\n=== Ti le trung cache theo loai du lieu (giai doan SAU) ===');
  const hit = {};
  for (const t of after.metrics.cache) {
    hit[t.type] = { 'Luot tra cuu': t.lookups, 'Trung Redis': t.hits, 'Trung L1': t.l1Hits, Truot: t.misses, 'Bo qua': t.bypass, 'Doc truc tiep DB': t.liveReads, 'Ti le trung': t.hitRatio };
  }
  console.table(hit);

  console.log('\n=== Chi phi DB theo truy van ===');
  const dbRows = {};
  const labels = new Set([...Object.keys(before.metrics.db.byQuery), ...Object.keys(after.metrics.db.byQuery)]);
  for (const l of labels) {
    const b = before.metrics.db.byQuery[l] ?? { count: 0, execMs: 0, avgExecMs: 0 };
    const a = after.metrics.db.byQuery[l] ?? { count: 0, execMs: 0, avgExecMs: 0 };
    dbRows[l] = {
      'Truoc: so lan': b.count,
      'Truoc: thuc thi ms': b.execMs,
      'Truoc: TB ms': b.avgExecMs,
      'Sau: so lan': a.count,
      'Sau: thuc thi ms': a.execMs,
      'Sau: TB ms': a.avgExecMs,
    };
  }
  console.table(dbRows);
}

function compose(action) {
  return new Promise((resolve) => spawn('docker', ['compose', action, 'redis'], { cwd: PROJECT_DIR, stdio: 'ignore' }).on('exit', resolve));
}

async function chaos() {
  await call('PUT', '/admin/cache', { body: { enabled: true } });
  await call('POST', '/metrics/reset');
  const events = [];
  console.log(`Tai hon hop 30s, ${CONCURRENCY} ket noi; tat Redis o giay 10, bat lai o giay 20`);
  const { results } = await runLoad(30000, (start) =>
    (async () => {
      await sleep(10000 - (performance.now() - start));
      events.push(`+${((performance.now() - start) / 1000).toFixed(1)}s docker compose stop redis`);
      await compose('stop');
      await sleep(20000 - (performance.now() - start));
      events.push(`+${((performance.now() - start) / 1000).toFixed(1)}s docker compose start redis`);
      await compose('start');
    })(),
  );
  events.forEach((e) => console.log(e));

  const phases = { '0-10s (Redis song)': [0, 10000], '10-20s (Redis tat)': [10000, 20000], '20-30s (Redis bat lai)': [20000, 31000] };
  const table = {};
  for (const [label, [from, to]] of Object.entries(phases)) {
    const rs = results.filter((r) => r.at >= from && r.at < to);
    const by = (pred) => rs.filter(pred).length;
    table[label] = {
      Request: rs.length,
      '2xx': by((r) => r.status >= 200 && r.status < 300),
      '4xx': by((r) => r.status >= 400 && r.status < 500),
      '5xx': by((r) => r.status >= 500),
      'Loi mang': by((r) => r.status === 'ERR'),
      'p50 (ms)': pct(rs.map((r) => r.ms), 0.5),
      'p99 (ms)': pct(rs.map((r) => r.ms), 0.99),
    };
  }
  console.table(table);
  const m = (await call('GET', '/metrics')).json;
  console.log('Trang thai Redis cua ung dung:', m.redis);
  const bypass = {};
  for (const t of m.cache) bypass[t.type] = { 'Trung (L1+Redis)': t.hits + t.l1Hits, Truot: t.misses, 'Bo qua (Redis tat)': t.bypass };
  console.table(bypass);
}

async function price() {
  const productId = 8; // san pham hot, nam trong top-sellers cua danh muc phone
  const durationMs = 15000;
  await call('PUT', '/admin/cache', { body: { enabled: true } });
  const acks = []; // { version, price, ackAt }
  const reads = []; // { startedAt, version, price, source }
  const start = performance.now();
  const events = [];

  const writer = (async () => {
    while (performance.now() - start < durationMs) {
      const newPrice = (100 + Math.floor(Math.random() * 49900)) * 1000;
      const r = await call('PATCH', `/admin/products/${productId}`, { body: { price: newPrice } });
      if (r.status === 200) acks.push({ version: r.json.product.price_version, price: r.json.product.price, ackAt: performance.now() });
      await sleep(50);
    }
  })();

  const reader = async (path, extract) => {
    while (performance.now() - start < durationMs) {
      const r = await call('GET', path);
      if (r.status === 200) {
        const item = extract(r.json);
        if (item) reads.push({ startedAt: r.startedAt, version: item.priceVersion, price: item.price, path });
      }
    }
  };
  const chaosTask = (async () => {
    await sleep(5000);
    events.push(`+${((performance.now() - start) / 1000).toFixed(1)}s tat Redis`);
    await compose('stop');
    await sleep(10000 - (performance.now() - start));
    events.push(`+${((performance.now() - start) / 1000).toFixed(1)}s bat lai Redis`);
    await compose('start');
  })();

  await Promise.all([
    writer,
    chaosTask,
    ...Array.from({ length: 20 }, () => reader(`/products/${productId}`, (j) => j)),
    ...Array.from({ length: 20 }, () => reader('/categories/phone/top-sellers', (j) => j.items.find((i) => i.id === productId))),
  ]);
  events.forEach((e) => console.log(e));

  // Vi pham = request BAT DAU sau khi lan doi gia v da duoc xac nhan, nhung van thay version < v
  const priceOf = new Map(acks.map((a) => [a.version, a.price]));
  let stale = 0;
  let wrongPrice = 0;
  for (const r of reads) {
    const latestAcked = acks.filter((a) => a.ackAt <= r.startedAt).at(-1);
    if (latestAcked && r.version < latestAcked.version) stale++;
    if (priceOf.has(r.version) && priceOf.get(r.version) !== r.price) wrongPrice++;
  }
  console.table({
    'So lan doi gia': acks.length,
    'So lan doc gia': reads.length,
    '- tu /products/:id': reads.filter((r) => r.path.startsWith('/products')).length,
    '- tu top-sellers': reads.filter((r) => r.path.includes('top-sellers')).length,
    'Doc thay gia CU sau khi doi gia da xac nhan': stale,
    'Gia khong khop version': wrongPrice,
  });
  console.log(stale === 0 && wrongPrice === 0 ? 'KET QUA: KHONG CO LAN NAO THAY GIA CU' : 'KET QUA: CO GIA CU');
}

if (mode === 'compare') await compare();
else if (mode === 'chaos') await chaos();
else if (mode === 'price') await price();
else console.error(`Unknown mode ${mode}`);
