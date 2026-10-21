// node scripts/load-test.mjs latency  -> do do tre MISS / HIT / trang 4 (BYPASS) bang autocannon
// node scripts/load-test.mjs attack   -> ban hang nghin to hop loc rac, kiem tra tran so khoa
import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const mode = process.argv[2] ?? 'latency';

const api = (path, init) => fetch(`${BASE_URL}${path}`, init).then((r) => r.json());

async function timed(path) {
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}${path}`);
  await res.arrayBuffer();
  return { ms: (performance.now() - t0).toFixed(1), cache: res.headers.get('x-cache') };
}

const bench = (path, duration, connections, overallRate) =>
  autocannon({ url: `${BASE_URL}${path}`, duration, connections, overallRate });

async function latency() {
  const path = '/products?category=phone&brand=samsung,apple&sort=price_asc';
  await api('/debug/cache', { method: 'DELETE' });

  const first = await timed(path);
  const second = await timed(path);
  console.log(`\nGET ${path}`);
  console.table({ 'Lan 1': first, 'Lan 2': second });

  // Gio cao diem 3.000 luot/phut = 50 req/s -> do o 100 req/s (gap doi), them 1 lan stress khong gioi han
  const peak = await bench(path, 10, 10, 100);
  const stress = await bench(path, 5, 50);
  const bypass = await bench('/products?sort=price_asc&page=4', 5, 10);
  const row = (r) => ({
    'Tong request': r.requests.total,
    'Req/s': Math.round(r.requests.average),
    'Avg (ms)': r.latency.average,
    'p50 (ms)': r.latency.p50,
    'p99 (ms)': r.latency.p99,
    'Max (ms)': r.latency.max,
    'Non-2xx': r.non2xx,
  });
  console.log('\nautocannon');
  console.table({
    'HIT 100 req/s x 10s': row(peak),
    'HIT stress 50 conn x 5s': row(stress),
    'Trang 4 BYPASS 10 conn x 5s': row(bypass),
  });

  const { count, keys } = await api('/debug/cache');
  console.log(`\nSo khoa danh sach trong Redis: ${count}`);
  for (const k of keys) console.log(`  ${k.key}  (TTL ${k.ttl}s)`);
}

// Sinh to hop hop le khac nhau (category x brand x khoang gia theo buoc 100k x sort x trang 1..3)
function validCombos(n) {
  const cats = ['phone', 'laptop', 'tablet', 'audio', 'watch'];
  const brands = ['apple', 'samsung', 'xiaomi', 'sony', 'asus', 'dell', 'lenovo', 'oppo'];
  const sorts = ['price_asc', 'price_desc', 'newest'];
  const out = new Set();
  let i = 0;
  while (out.size < n) {
    const b = brands.filter((_, j) => ((i >> j) & 1) === 1).slice(0, 3).join(',');
    out.add(
      `/products?category=${cats[i % 5]}${b ? `&brand=${b}` : ''}` +
        `&minPrice=${(i % 50) * 100000}&sort=${sorts[i % 3]}&page=${(i % 3) + 1}`,
    );
    i++;
  }
  return [...out];
}

function junkRequests() {
  const junk = [];
  for (let i = 0; i < 100; i++) junk.push(`/products?category=phone&utm_${i}=x`); // tham so la
  for (let i = 0; i < 100; i++) junk.push(`/products?category=cat${i}`); // danh muc khong ton tai
  for (let i = 0; i < 100; i++) junk.push(`/products?category=phone&minPrice=${100001 + i}`); // gia le
  for (let i = 0; i < 100; i++) junk.push(`/products?category=phone&page=${4 + i}`); // trang >= 4
  return junk;
}

async function attack() {
  await api('/debug/cache', { method: 'DELETE' });
  const { maxKeys } = await api('/debug/cache');
  const paths = [...validCombos(Number(process.env.VALID_COMBOS ?? 600)), ...junkRequests()];

  const stats = {};
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const res = await fetch(`${BASE_URL}${paths[next++]}`);
      await res.arrayBuffer();
      const label = `${res.status} ${res.headers.get('x-cache') ?? ''} ${res.headers.get('x-cache-note') ?? ''}`.trim();
      stats[label] = (stats[label] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: 100 }, worker));

  const { count, indexSize } = await api('/debug/cache');
  console.log(`\nDa gui ${paths.length} request (to hop hop le + rac)`);
  console.table(stats);
  console.table({ 'Tran MAX_CACHE_KEYS': maxKeys, 'So khoa danh sach trong Redis': count, 'Kich thuoc index': indexSize });
}

await (mode === 'attack' ? attack() : latency());
