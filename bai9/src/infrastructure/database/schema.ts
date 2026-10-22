export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS categories (
  id   SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brands (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES categories(id),
  brand_id      INT NOT NULL REFERENCES brands(id),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  specs         JSONB NOT NULL DEFAULT '{}',
  price         INT NOT NULL CHECK (price >= 0),
  price_version INT NOT NULL DEFAULT 1,
  stock         INT NOT NULL CHECK (stock >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reviews (
  id         BIGSERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PAID',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id   BIGINT NOT NULL REFERENCES orders(id),
  product_id INT NOT NULL REFERENCES products(id),
  qty        INT NOT NULL CHECK (qty > 0),
  unit_price INT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);
CREATE INDEX IF NOT EXISTS reviews_product_idx ON reviews(product_id);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items(product_id);
`;

// Du lieu mau: 8 danh muc, 12 thuong hieu, 2.000 san pham, 200k danh gia, 1.000 nguoi dung,
// 100k don hang trong 30 ngay, 300k dong don hang (san pham id nho ban chay hon)
export const SEED_SQL = `
INSERT INTO categories (slug, name)
SELECT s, initcap(s) FROM unnest(ARRAY['phone','laptop','tablet','audio','watch','camera','gaming','accessory']) s;

INSERT INTO brands (name)
SELECT unnest(ARRAY['Apple','Samsung','Xiaomi','Sony','Asus','Dell','Lenovo','Oppo','Canon','Logitech','Garmin','Nintendo']);

INSERT INTO products (category_id, brand_id, name, description, specs, price, stock)
SELECT 1 + (g % 8), 1 + (g % 12), 'Product ' || g,
       repeat('Mo ta chi tiet san pham ' || g || '. ', 20),
       jsonb_build_object('weight', 100 + g % 900, 'color', (ARRAY['black','white','blue'])[1 + g % 3], 'warranty', 12),
       (100 + (g * 7919) % 49900) * 1000, 1000000
FROM generate_series(1, 2000) g;

INSERT INTO reviews (product_id, rating, created_at)
SELECT 1 + floor(random() * 2000)::int, 1 + floor(random() * 5)::int, now() - random() * interval '365 days'
FROM generate_series(1, 200000);

INSERT INTO orders (user_id, created_at)
SELECT 1 + floor(random() * 1000)::int, now() - random() * interval '30 days'
FROM generate_series(1, 100000);

INSERT INTO order_items (order_id, product_id, qty, unit_price)
SELECT o.id, 1 + floor(power(random(), 2) * 2000)::int, 1 + floor(random() * 3)::int, 100000
FROM orders o CROSS JOIN generate_series(1, 3);

ANALYZE;
`;
