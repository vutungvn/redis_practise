# Bài 5 – Vá lỗi bộ nhớ đệm phục vụ giá sai cho khách hàng

NestJS + Redis (`@nestjs/cache-manager` v3, `cache-manager` v7, `@keyv/redis`).

## 1. Bối cảnh và quy tắc nghiệp vụ

Bộ phận kinh doanh ShopFast báo hai sự cố:

- Khách đặt hàng theo giá khuyến mãi đã kết thúc từ hôm qua.
- Khách mở sản phẩm A nhưng thấy thông tin của sản phẩm B.

| #  | Quy tắc đúng |
|----|--------------|
| R1 | Mỗi sản phẩm có bản ghi đệm riêng, không lẫn với sản phẩm khác. |
| R2 | Khi giá thay đổi, lần đọc tiếp theo phải trả về giá mới ngay lập tức. |
| R3 | Bản ghi đệm có thời gian sống hữu hạn, kiểm chứng được bằng lệnh `TTL`. |
| R4 | Sản phẩm không tồn tại phải trả `404`, không trả dữ liệu của sản phẩm khác. |

### Mã nguồn gốc (đang lỗi)

```ts
async findOne(id: string) {
  const cached = await this.cache.get("product");
  if (cached) return cached;

  const product = await this.repo.findById(id);
  await this.cache.set("product", product);
  return product;
}

async update(id: string, dto: UpdateProductDto) {
  return this.repo.update(id, dto);
}
```

### Luồng thực thi của bản lỗi

```
GET /products/:id
  └─ cache.get("product")          ← khoá không chứa id
       ├─ có  → trả luôn (bất kể id là gì)
       └─ không → repo.findById(id) → cache.set("product", product)   ← không TTL, kể cả null

PATCH /products/:id
  └─ repo.update(id, dto)          ← cache giữ nguyên bản cũ
```

## 2. Phần 1 – Các khiếm khuyết và test case tái hiện

Dữ liệu mẫu: SP `1` "Tai nghe Bluetooth" giá `500000`, SP `2` "Ban phim co" giá `1200000`.
Redis đang trống trước mỗi kịch bản (`redis-cli FLUSHDB`).
Kết quả "thực tế" dưới đây là kết quả chạy thật trên bản lỗi.

### Lỗi 1 – Khoá cache cố định `"product"`, mọi sản phẩm dùng chung một bản ghi

Vi phạm R1. Đây là nguyên nhân của sự cố "mở A thấy B".

| Bước | Request | Thực tế | Đúng |
|------|---------|---------|------|
| 1 | `GET /products/1` | `{"id":"1","name":"Tai nghe Bluetooth","price":500000}` | Như thực tế |
| 2 | `GET /products/2` | `{"id":"1","name":"Tai nghe Bluetooth","price":500000}` ❌ | `{"id":"2","name":"Ban phim co","price":1200000}` |

### Lỗi 2 – `update()` không vô hiệu hoá cache

Vi phạm R2. Đây là nguyên nhân của sự cố "khách mua theo giá khuyến mãi đã hết".

| Bước | Request | Thực tế | Đúng |
|------|---------|---------|------|
| 1 | `GET /products/1` | `price: 500000` (đã vào cache) | Như thực tế |
| 2 | `PATCH /products/1` body `{"price":399000}` | Trả `price: 399000`, DB đã cập nhật | Như thực tế |
| 3 | `GET /products/1` | `price: 500000` ❌ (giá cũ từ cache) | `price: 399000` |

### Lỗi 3 – `cache.set` không truyền TTL, bản ghi sống vĩnh viễn

Vi phạm R3. Kết hợp với lỗi 2, giá cũ không bao giờ tự hết hạn.

| Bước | Lệnh | Thực tế | Đúng |
|------|------|---------|------|
| 1 | `GET /products/1` | `200` | Như thực tế |
| 2 | `docker exec shopfast-redis-1 redis-cli TTL product` | `-1` ❌ (không hết hạn) | Số dương, giảm dần theo thời gian |

### Lỗi 4 – Không xử lý sản phẩm không tồn tại, cache cả giá trị `null`

Vi phạm R4.

| Tình huống | Request | Thực tế | Đúng |
|------------|---------|---------|------|
| Cache đang chứa SP 1 | `GET /products/999` | `200` + dữ liệu SP 1 ❌ | `404 Not Found` |
| Cache trống | `GET /products/999` (gọi 2 lần) | `200` body rỗng ❌; Redis lưu `product = null`; vì `if (cached)` coi `null` là miss nên mọi lần gọi đều xuống DB | `404`, không ghi `null` vào cache |

## 3. Phần 2 – Cách sửa

File: [`src/product/product.service.ts`](src/product/product.service.ts)

| Lỗi | Cách sửa |
|-----|----------|
| 1 | Khoá riêng theo id: `product:${id}` (ví dụ `product:1`, `product:2`). |
| 2 | Trong `update()`: ghi DB trước, thành công rồi mới `cache.del('product:' + id)`. Lần đọc sau là cache miss nên lấy giá mới từ DB. |
| 3 | `cache.set(key, product, CACHE_TTL_MS)` với `CACHE_TTL_MS = 5 * 60 * 1000` (cache-manager v7 tính TTL bằng mili giây, tức 300 giây trên Redis). |
| 4 | Không tìm thấy thì ném `NotFoundException` (404) và không ghi vào cache. `update()` với id không tồn tại cũng trả 404. |

Thứ tự "cập nhật DB → xoá cache" (thay vì ghi đè cache bằng giá trị mới) giúp tránh việc cache giữ giá trị chưa được DB xác nhận nếu bước ghi DB thất bại.

### Luồng thực thi sau khi sửa

```
GET /products/:id
  └─ cache.get("product:<id>")
       ├─ có  → trả về
       └─ không → repo.findById(id)
                   ├─ null → 404 (không cache)
                   └─ có   → cache.set("product:<id>", product, 300s) → trả về

PATCH /products/:id
  └─ repo.update(id, dto)
       ├─ null → 404
       └─ có   → cache.del("product:<id>") → trả về bản mới
```

## 4. Cách chạy

Yêu cầu: Node.js 20+, Redis (mặc định `redis://localhost:6380`, đổi qua biến môi trường `REDIS_URL`).

```bash
cd bai5
npm install
npm run start:dev        # http://localhost:3000
```

Tầng DB được giả lập in-memory ([`product.repository.ts`](src/product/product.repository.ts)) để tập trung vào tầng cache. Mỗi lần gọi xuống DB in ra log `[DB] findById(<id>)`, nhờ đó phân biệt được cache hit và cache miss. Khởi động lại app thì dữ liệu về giá ban đầu, nên cần `FLUSHDB` Redis để cache khớp DB.

## 5. Kiểm thử sau khi sửa (Postman)

Body của `PATCH` chọn **raw → JSON**.

| TC | Request | Kết quả mong đợi | Kết quả |
|----|---------|------------------|---------|
| 1 | `GET /products/1`, sau đó `GET /products/2` | Lần lượt trả SP 1 "Tai nghe Bluetooth" và SP 2 "Ban phim co" | ✅ |
| 2 | `GET /products/1` → `PATCH /products/1` `{"price":399000}` → `GET /products/1` | GET cuối trả `price: 399000`; sau PATCH, `EXISTS product:1` = `0` | ✅ |
| 3 | Sau TC 1: `docker exec shopfast-redis-1 redis-cli TTL product:1` | Số dương ≤ 300, giảm dần | ✅ (`299`) |
| 4 | `GET /products/999` | `404 {"message":"Product 999 not found"}` | ✅ |
| 5 | `PATCH /products/1` `{"price":-5}` | `400 ["price must not be less than 0"]` | ✅ |

Lệnh Redis hữu ích:

```bash
docker exec shopfast-redis-1 redis-cli KEYS "product:*"
docker exec shopfast-redis-1 redis-cli TTL product:1
docker exec shopfast-redis-1 redis-cli GET product:1
docker exec shopfast-redis-1 redis-cli FLUSHDB
```
