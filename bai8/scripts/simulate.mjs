// node scripts/simulate.mjs burst      -> 400 luot tru kho dong thoi, ton kho 100
// node scripts/simulate.mjs sustained  -> 400 luot/s trong 10s, ton kho 3000, ~10% don bi huy
// node scripts/simulate.mjs restart    -> nhu sustained, khoi dong lai Redis o giay thu 4
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const PROJECT_DIR = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv[2] ?? 'burst';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, ms: performance.now() - t0 };
  } catch (err) {
    return { status: 'NETWORK_ERROR', json: null, ms: performance.now() - t0 };
  }
}

function latency(results) {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const at = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))]?.toFixed(1);
  return { 'p50 (ms)': at(0.5), 'p99 (ms)': at(0.99), 'max (ms)': ms.at(-1)?.toFixed(1) };
}

function countBy(results, label) {
  const out = {};
  for (const r of results) out[label(r)] = (out[label(r)] ?? 0) + 1;
  return out;
}

const orderLabel = (r) =>
  r.status === 201 ? '201 RESERVED' : r.status === 409 ? '409 Sold out' : r.status === 503 ? '503 Retry' : String(r.status);

function printReconcile(rec) {
  console.log('\nDoi chieu cuoi chien dich (POST /inventory/:id/reconcile)');
  console.table({
    'Ton kho ban dau': rec.db.initialStock,
    'Da ban (RESERVED)': rec.db.soldQty,
    'Da huy & hoan kho': rec.db.cancelledQty,
    'Ton kho DB': rec.db.dbStock,
    'Ton kho Redis': rec.redis.stock,
    'DB = ban dau - da ban': rec.checks.dbStockMatchesSales,
    'Redis = DB': rec.checks.redisMatchesDb,
    'Khong ban vuot': rec.checks.noOversell,
    'Khong am': rec.checks.nonNegative,
  });
  console.log(
    `Dong bo theo lo: ${rec.sync.ordersApplied} luot thay doi -> ${rec.sync.productRowWrites} lan UPDATE dong products ` +
      `(${rec.sync.batches} lo)`,
  );
  console.log(rec.ok ? 'KET QUA: KHOP TUYET DOI' : 'KET QUA: SAI LECH');
}

async function burst() {
  const productId = 1;
  const stock = Number(process.env.STOCK ?? 100);
  const n = Number(process.env.ORDERS ?? 400);
  await call('POST', `/campaigns/${productId}/reset`, { stock });

  const results = await Promise.all(Array.from({ length: n }, () => call('POST', '/orders', { productId, qty: 1 })));

  console.log(`\n${n} luot tru kho dong thoi, ton kho ${stock}`);
  console.table(countBy(results, orderLabel));
  console.table(latency(results));
  printReconcile((await call('POST', `/inventory/${productId}/reconcile`)).json);
}

function restartRedis() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    spawn('docker', ['compose', 'restart', 'redis'], { cwd: PROJECT_DIR, stdio: 'ignore' }).on('exit', () =>
      resolve(performance.now() - t0),
    );
  });
}

async function sustained(restartAtMs) {
  const productId = 2;
  const stock = 3000;
  const rate = 400;
  const durationMs = 10_000;
  const cancelRatio = 0.1;
  await call('POST', `/campaigns/${productId}/reset`, { stock });
  const runIdBefore = (await call('GET', `/inventory/${productId}`)).json.redis.runId;

  const orders = [];
  const cancels = [];
  const inflight = [];
  let restartInfo = null;

  const placeOne = async () => {
    const r = await call('POST', '/orders', { productId, qty: 1 });
    r.at = performance.now() - start;
    orders.push(r);
    if (r.status === 201 && r.json?.status === 'RESERVED' && Math.random() < cancelRatio) {
      await sleep(Math.random() * 500);
      cancels.push(await call('POST', `/orders/${r.json.orderId}/cancel`));
    }
  };

  const start = performance.now();
  if (restartAtMs) {
    setTimeout(async () => {
      const at = performance.now() - start;
      restartInfo = { at, took: await restartRedis() };
    }, restartAtMs);
  }
  let sent = 0;
  while (performance.now() - start < durationMs) {
    const due = Math.floor(((performance.now() - start) / 1000) * rate) - sent;
    for (let i = 0; i < due; i++, sent++) inflight.push(placeOne());
    await sleep(5);
  }
  await Promise.all(inflight);
  while (restartAtMs && !restartInfo) await sleep(100);

  console.log(`\n${sent} don trong ${durationMs / 1000}s (${rate} luot/s), ton kho ${stock}, ~${cancelRatio * 100}% don bi huy`);
  if (restartInfo) {
    const runIdAfter = (await call('GET', `/inventory/${productId}`)).json.redis.runId;
    console.log(
      `Redis restart luc +${(restartInfo.at / 1000).toFixed(1)}s, mat ${(restartInfo.took / 1000).toFixed(1)}s; ` +
        `run_id ${runIdBefore.slice(0, 8)} -> ${runIdAfter.slice(0, 8)}`,
    );
    const during = orders.filter((o) => o.status === 503);
    if (during.length) {
      console.log(
        `503 xuat hien tu +${(Math.min(...during.map((o) => o.at)) / 1000).toFixed(2)}s ` +
          `den +${(Math.max(...during.map((o) => o.at)) / 1000).toFixed(2)}s`,
      );
    }
  }
  console.log('Dat hang:');
  console.table(countBy(orders, orderLabel));
  console.table({ 'Tat ca don': latency(orders), 'Don thanh cong': latency(orders.filter((o) => o.status === 201)) });
  console.log('Huy don:');
  console.table(countBy(cancels, (c) => `${c.status} ${c.json?.restock ?? c.json?.message ?? ''}`));
  printReconcile((await call('POST', `/inventory/${productId}/reconcile`)).json);
}

if (mode === 'burst') await burst();
else if (mode === 'sustained') await sustained();
else if (mode === 'restart') await sustained(4000);
else console.error(`Unknown mode ${mode}`);
