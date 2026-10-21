# Bài 6 – Chống dồn dập (cache stampede) khi khoá hết hạn

NestJS + Redis (`ioredis`). Khoá phân tán `SET NX PX` + giải phóng bằng Lua + TTL lệch ngẫu nhiên.

## 1. Bối cảnh và quy tắc nghiệp vụ

Sản phẩm flash sale có 5.000 người xem cùng lúc. Mỗi khi khoá cache hết hạn, DB nhận gần 200 truy vấn giống hệt nhau trong một giây, thời gian phản hồi vọt lên 3 giây.

| #  | Quy tắc |
|----|---------|
| R1 | Tại một thời điểm, với một khoá cache, tối đa **một** request được xuống DB để dựng lại giá trị. |
| R2 | Khoá phân tán phải **tự hết hạn** sau một khoảng ngắn, để hệ thống không bị kẹt vĩnh viễn khi tiến trình giữ khoá bị chết. |
| R3 | Truy vấn DB ném lỗi thì khoá phân tán **vẫn phải được giải phóng**. |
| R4 | Request chờ cache được dựng phải có **giới hạn số lần chờ**, không lặp vô tận. |
| R5 | TTL của các khoá cùng loại **lệch nhau ngẫu nhiên**, để không hết hạn đồng loạt. |

### Vì sao bị dồn dập?

```
t = 0       khoá shopfast:product:1 hết hạn
t = 0..200ms  200 request cùng GET → cùng miss → cùng gọi repo.findById("1")
              DB nhận 200 truy vấn giống hệt nhau, càng đông càng chậm (~3s)
t = ~3s     200 request cùng SET lại cùng một giá trị
```

## 2. Điền 5 chỗ khuyết

File: [`src/product/product.service.ts`](src/product/product.service.ts), hàm `getProductWithLock`.

| # | Chỗ khuyết | Cách điền |
|---|------------|-----------|
| (1) | Giành khoá phân tán | `SET lock:shopfast:product:<id> <uuid> PX 5000 NX`. Lệnh này nguyên tử: chỉ một request nhận `OK`. `PX 5000` giúp khoá tự hết hạn sau 5s nếu tiến trình chết (R2). Giá trị là UUID riêng của request (token). |
| (2) | Không giành được khoá | `waitForCache()`: ngủ 100ms rồi đọc lại cache, tối đa **20 lần** (khoảng 2s). Hết lượt mà vẫn chưa có thì trả `503 Service Unavailable`, không lặp vô tận (R4). |
| (3) | Độ lệch ngẫu nhiên cho TTL | `EX 300 + randomInt(0, 61)`, tức TTL nằm trong khoảng 300–360s (R5). |
| (4) | Giải phóng khoá | Script Lua: chỉ `DEL` khi giá trị khoá vẫn đúng là token của mình. Nhờ vậy không xoá nhầm khoá của request khác trong trường hợp khoá của mình đã tự hết hạn và bị người khác giành. |
| (5) | Giải phóng cả khi DB lỗi | Bước (4) đặt trong `finally`, nên luôn chạy dù `findById` ném lỗi (R3). |

Bổ sung **double-check**: sau khi giành được khoá, đọc lại cache một lần nữa. Một request có thể đã miss cache trước khi request giữ khoá trước đó kịp dựng xong và trả khoá. Nếu không có bước này, request đó sẽ giành được khoá và xuống DB lần thứ 2.

```ts
const acquired = await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');  // (1)
if (acquired !== 'OK') return this.waitForCache(key, id);                       // (2)
try {
  const rebuilt = await this.redis.get(key);                                    // double-check
  if (rebuilt) return JSON.parse(rebuilt);
  const product = await this.repo.findById(id);
  const ttl = CACHE_TTL_SECONDS + randomInt(0, CACHE_TTL_JITTER_SECONDS + 1);   // (3)
  await this.redis.set(key, JSON.stringify(product), 'EX', ttl);
  return product;
} finally {
  await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);                // (4) + (5)
}
```

| Tham số | Giá trị | Lý do |
|---------|---------|-------|
| `LOCK_TTL_MS` | 5000 | Lớn hơn nhiều so với thời gian một truy vấn DB bình thường, nhưng đủ ngắn để hệ thống tự hồi phục khi tiến trình chết. |
| `WAIT_INTERVAL_MS` × `MAX_WAIT_RETRIES` | 100ms × 20 | Tổng thời gian chờ tối đa khoảng 2s. |
| `CACHE_TTL_SECONDS` + jitter | 300 + [0..60] | Trải thời điểm hết hạn của các khoá ra trong 1 phút. |

## 3. Môi trường mô phỏng

- **DB giả lập** ([`product.repository.ts`](src/product/product.repository.ts)) gồm 10 sản phẩm. Độ trễ cơ bản 200ms, mỗi truy vấn đang chạy song song cộng thêm 15ms để mô phỏng DB chậm dần khi bị dồn tải. Có đếm tổng số truy vấn.
- **`GET /products/:id/no-lock`:** bản gốc chưa có khoá, chỉ dùng làm mốc so sánh.
- **Endpoint debug** (chỉ dùng để kiểm thử):

| Method | Path | Mục đích |
|--------|------|----------|
| `GET` | `/debug/stats` | Số truy vấn DB, cấu hình DB hiện tại |
| `POST` | `/debug/stats/reset` | Đặt bộ đếm truy vấn về 0 |
| `PATCH` | `/debug/db` | Body `{"latencyMs": 3000}` và/hoặc `{"failQueries": true}` |
| `GET` | `/debug/cache/:id` | Xem TTL của cache và trạng thái khoá phân tán |
| `DELETE` | `/debug/cache/:id` | Xoá cache, mô phỏng khoá vừa hết hạn |

## 4. Cách chạy

```bash
cd bai6
npm install
npm run start:dev                 # http://localhost:3000, Redis mặc định redis://localhost:6380
```

Đo tải (mở terminal khác trong lúc app đang chạy):

```bash
npm run loadtest:nolock           # bản gốc
npm run loadtest:lock             # bản có khoá
npm run ttl:check                 # TTL của 10 sản phẩm
```

[`scripts/load-test.mjs`](scripts/load-test.mjs) làm như sau: làm nóng cache, đặt `PEXPIRE` 1s để khoá **hết hạn thật** giữa lúc đang tải, rồi chạy 200 client đồng thời gửi request liên tục trong 3s. Cuối cùng đọc số truy vấn DB. Có thể chỉnh qua biến môi trường `CONCURRENCY`, `DURATION_MS`.

## 5. Kết quả đo tải

200 người xem đồng thời, 3 giây, khoá hết hạn ở giây thứ 1:

| Chỉ số | Không khoá | Có khoá phân tán |
|--------|-----------:|-----------------:|
| Tổng request | 30.489 | 32.838 |
| HTTP status | 200 × 30.489 | 200 × 32.838 |
| **Truy vấn DB khi khoá hết hạn** | **200** | **1** |
| Latency p50 | 6 ms | 14 ms |
| Latency p99 | 105 ms | 105 ms |
| **Latency max** | **3.196 ms** | **232 ms** |

Bản không khoá tái hiện đúng sự cố: 200 truy vấn trùng lặp, request chậm nhất mất khoảng 3,2s. Bản có khoá chỉ còn **1 truy vấn DB**. Các request còn lại chờ khoảng 200ms rồi đọc được cache.

### TTL lệch ngẫu nhiên (`npm run ttl:check`)

| Key | TTL (s) |
|-----|--------:|
| shopfast:product:1 | 324 |
| shopfast:product:2 | 304 |
| shopfast:product:3 | 299 |
| shopfast:product:4 | 347 |
| shopfast:product:5 | 350 |
| shopfast:product:6 | 344 |
| shopfast:product:7 | 303 |
| shopfast:product:8 | 324 |
| shopfast:product:9 | 345 |
| shopfast:product:10 | 300 |

Kiểm tra thủ công: `docker exec shopfast-redis-1 redis-cli TTL shopfast:product:1`

## 6. Test case chính (Postman)

| TC | Mục tiêu | Các bước | Kết quả mong đợi | Kết quả |
|----|----------|----------|------------------|---------|
| 1 | Đọc bình thường | `GET /products/1` | 200, dữ liệu SP 1 | ✅ |
| 2 | TTL lệch ngẫu nhiên | `DELETE /debug/cache/{1..3}` → `GET /products/{1..3}` → `GET /debug/cache/{1..3}` | `ttl` mỗi key khác nhau, nằm trong 300–360 | ✅ |
| 3 | **Bẫy 1:** DB ném lỗi vẫn giải phóng khoá | `PATCH /debug/db` `{"failQueries":true}` → `DELETE /debug/cache/1` → `GET /products/1` → `GET /debug/cache/1` | GET trả `500`; `lock.holder = null`, `lock.pttl = -2` (khoá đã bị xoá ngay, không phải đợi 5s) | ✅ |
| 4 | Hồi phục sau lỗi | `PATCH /debug/db` `{"failQueries":false}` → `GET /products/1` | `200`, request mới giành được khoá bình thường | ✅ |
| 5 | **Bẫy 2:** chờ có giới hạn | `PATCH /debug/db` `{"latencyMs":3000}` → `DELETE /debug/cache/1` → gửi **2 request** `GET /products/1` gần như cùng lúc (2 tab Postman) | Request A (giữ khoá): `200` sau khoảng 3s. Request B (chờ): `503 "Product 1 is being rebuilt, please retry"` sau khoảng 2,2s. Log có `Gave up waiting ... after 20 retries` | ✅ |
| 6 | Số truy vấn DB khi hết hạn | `npm run loadtest:nolock` rồi `npm run loadtest:lock` | 200 → 1 | ✅ |

Sau TC 5 nhớ trả cấu hình về `PATCH /debug/db` `{"latencyMs":200}`.

Có thể dùng thêm tab **Performance** của Postman (Collection Runner → Performance, khoảng 100 virtual users) gọi `GET /products/1` sau khi `DELETE /debug/cache/1`, rồi xem `GET /debug/stats`.

## 7. Giới hạn đã biết

- Nếu truy vấn DB chạy lâu hơn `LOCK_TTL_MS` (5s), khoá sẽ tự hết hạn trước khi dựng xong và một request khác có thể xuống DB lần nữa. Script Lua đảm bảo request đầu không xoá nhầm khoá của request thứ hai. Nếu DB thường xuyên chậm như vậy, cần tăng `LOCK_TTL_MS` hoặc gia hạn khoá trong lúc chờ (watchdog).
- Khoá chỉ dựng trên một node Redis. Môi trường Redis cluster hoặc sentinel cần cân nhắc Redlock.
