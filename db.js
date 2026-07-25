const { Pool } = require("pg");

const DATABASE_URL = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();

let pool = null;

function sslOption() {
  // Bothost/pghost often has no SSL. Enable only if explicitly requested.
  const mode = String(process.env.PGSSL || "false").toLowerCase();
  if (mode === "true" || mode === "1" || mode === "require") {
    return { rejectUnauthorized: false };
  }
  return false;
}

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: sslOption(),
      max: 5,
    });
    pool.on("error", (err) => console.error("pg pool error", err.message));
  }
  return pool;
}

async function initDb() {
  const p = getPool();
  if (!p) {
    console.log("DATABASE_URL not set — orders only via Telegram notify");
    return false;
  }
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        color_id TEXT,
        color_name TEXT,
        config_id TEXT,
        storage TEXT,
        price INTEGER,
        payment_id TEXT,
        payment_title TEXT,
        phone TEXT NOT NULL,
        telegram_user_id BIGINT,
        telegram_username TEXT,
        telegram_full_name TEXT,
        status TEXT NOT NULL DEFAULT 'new'
      );
    `);
    console.log("PostgreSQL ready (orders table), ssl=", sslOption() !== false);
    return true;
  } catch (err) {
    console.error("PostgreSQL init failed (HTTP will continue):", err.message);
    try {
      await p.end();
    } catch (_) {
      /* ignore */
    }
    pool = null;
    return false;
  }
}

async function saveOrder(order) {
  const p = getPool();
  if (!p) return null;
  const result = await p.query(
    `INSERT INTO orders (
      product_id, product_name, color_id, color_name, config_id, storage,
      price, payment_id, payment_title, phone,
      telegram_user_id, telegram_username, telegram_full_name
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id, created_at`,
    [
      order.product_id,
      order.product_name,
      order.color_id,
      order.color_name,
      order.config_id,
      order.storage,
      order.price,
      order.payment_id,
      order.payment_title,
      order.phone,
      order.telegram_user_id || null,
      order.telegram_username || null,
      order.telegram_full_name || null,
    ]
  );
  return result.rows[0];
}

const ORDER_STATUSES = ["new", "in_progress", "done", "cancelled"];

async function listOrders({ status, q, limit = 50, offset = 0 } = {}) {
  const p = getPool();
  if (!p) return { items: [], total: 0 };

  const where = [];
  const params = [];
  if (status && ORDER_STATUSES.includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(phone ILIKE $${params.length} OR product_name ILIKE $${params.length} OR telegram_full_name ILIKE $${params.length} OR telegram_username ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await p.query(`SELECT COUNT(*)::int AS total FROM orders ${whereSql}`, params);
  const total = countRes.rows[0]?.total || 0;

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  params.push(lim);
  params.push(off);
  const result = await p.query(
    `SELECT id, created_at, product_id, product_name, color_id, color_name, config_id, storage,
            price, payment_id, payment_title, phone,
            telegram_user_id, telegram_username, telegram_full_name, status
     FROM orders
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { items: result.rows, total };
}

async function updateOrderStatus(id, status) {
  const p = getPool();
  if (!p) return null;
  if (!ORDER_STATUSES.includes(status)) {
    throw new Error("invalid status");
  }
  const result = await p.query(
    `UPDATE orders SET status = $1 WHERE id = $2
     RETURNING id, status, created_at, product_name, phone`,
    [status, id]
  );
  return result.rows[0] || null;
}

module.exports = {
  initDb,
  saveOrder,
  getPool,
  listOrders,
  updateOrderStatus,
  ORDER_STATUSES,
};
