const { Pool } = require("pg");

const DATABASE_URL = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();

let pool = null;

function sslOption() {
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
    await p.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS manager_note TEXT`);
    await p.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_to BIGINT`);
    await p.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_name TEXT`);
    await p.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

    await p.query(`
      CREATE TABLE IF NOT EXISTS order_events (
        id BIGSERIAL PRIMARY KEY,
        order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor TEXT,
        kind TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT ''
      );
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON order_events(order_id)`);

    await p.query(`
      CREATE TABLE IF NOT EXISTS faq_templates (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const faqCount = await p.query(`SELECT COUNT(*)::int AS n FROM faq_templates`);
    if ((faqCount.rows[0]?.n || 0) === 0) {
      await p.query(
        `INSERT INTO faq_templates (title, body, sort_order) VALUES
        ($1,$2,1),($3,$4,2),($5,$6,3),($7,$8,4)`,
        [
          "Оригинал?",
          "Да, все устройства — новые оригиналы в заводской упаковке.",
          "Гарантия",
          "Гарантия 12 месяцев + сервисное обслуживание 24–36 мес.",
          "Доставка",
          "Доставка по Беларуси бесплатно. Самовывоз: Минск, Нововиленская 10.",
          "Рассрочка / лизинг",
          "Рассрочка и лизинг доступны. Оставьте заявку в боте — менеджер подберёт условия.",
        ]
      );
    }

    console.log("PostgreSQL ready (orders + faq), ssl=", sslOption() !== false);
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

const ORDER_STATUSES = ["new", "in_progress", "done", "cancelled", "archived"];

function periodClause(period) {
  if (period === "today") return `created_at >= date_trunc('day', NOW())`;
  if (period === "week") return `created_at >= NOW() - INTERVAL '7 days'`;
  if (period === "month") return `created_at >= NOW() - INTERVAL '30 days'`;
  return null;
}

async function addOrderEvent(orderId, { actor, kind, message } = {}) {
  const p = getPool();
  if (!p || !orderId) return null;
  const r = await p.query(
    `INSERT INTO order_events (order_id, actor, kind, message) VALUES ($1,$2,$3,$4) RETURNING *`,
    [orderId, actor || "system", kind || "note", String(message || "")]
  );
  return r.rows[0];
}

async function listOrderEvents(orderId, limit = 50) {
  const p = getPool();
  if (!p) return [];
  const r = await p.query(
    `SELECT id, order_id, created_at, actor, kind, message
     FROM order_events WHERE order_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [orderId, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return r.rows;
}

async function listOrders({ status, q, product_id, period, limit = 50, offset = 0, include_archived = false } = {}) {
  const p = getPool();
  if (!p) return { items: [], total: 0 };

  const where = [];
  const params = [];
  if (status && ORDER_STATUSES.includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  } else if (!include_archived) {
    where.push(`status <> 'archived'`);
  }
  if (product_id) {
    params.push(String(product_id));
    where.push(`product_id = $${params.length}`);
  }
  const pc = periodClause(period);
  if (pc) where.push(pc);
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    where.push(
      `(phone ILIKE $${params.length} OR product_name ILIKE $${params.length} OR telegram_full_name ILIKE $${params.length} OR telegram_username ILIKE $${params.length} OR COALESCE(manager_note,'') ILIKE $${params.length})`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await p.query(`SELECT COUNT(*)::int AS total FROM orders ${whereSql}`, params);
  const total = countRes.rows[0]?.total || 0;

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  params.push(lim);
  params.push(off);
  const result = await p.query(
    `SELECT id, created_at, updated_at, product_id, product_name, color_id, color_name, config_id, storage,
            price, payment_id, payment_title, phone,
            telegram_user_id, telegram_username, telegram_full_name, status,
            manager_note, assigned_to, assigned_name
     FROM orders
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { items: result.rows, total };
}

async function getOrder(id) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query(`SELECT * FROM orders WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function deleteOrder(id) {
  const p = getPool();
  if (!p) return false;
  const r = await p.query(`DELETE FROM orders WHERE id = $1 RETURNING id`, [id]);
  return Boolean(r.rowCount);
}

async function updateOrder(id, patch = {}, meta = {}) {
  const p = getPool();
  if (!p) return null;
  const before = await getOrder(id);
  if (!before) return null;
  const sets = [];
  const params = [];
  if (patch.status !== undefined) {
    if (!ORDER_STATUSES.includes(patch.status)) throw new Error("invalid status");
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
  }
  if (patch.manager_note !== undefined) {
    params.push(String(patch.manager_note || ""));
    sets.push(`manager_note = $${params.length}`);
  }
  if (patch.assigned_to !== undefined) {
    params.push(patch.assigned_to === null || patch.assigned_to === "" ? null : Number(patch.assigned_to));
    sets.push(`assigned_to = $${params.length}`);
  }
  if (patch.assigned_name !== undefined) {
    params.push(patch.assigned_name || null);
    sets.push(`assigned_name = $${params.length}`);
  }
  if (!sets.length) return before;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const result = await p.query(
    `UPDATE orders SET ${sets.join(", ")} WHERE id = $${params.length}
     RETURNING *`,
    params
  );
  const row = result.rows[0] || null;
  if (row) {
    const actor = meta.actor || "admin";
    if (patch.status !== undefined && patch.status !== before.status) {
      await addOrderEvent(id, {
        actor,
        kind: "status",
        message: `${before.status} → ${patch.status}`,
      });
    }
    if (patch.manager_note !== undefined && patch.manager_note !== before.manager_note) {
      await addOrderEvent(id, {
        actor,
        kind: "note",
        message: String(patch.manager_note || "").slice(0, 500),
      });
    }
    if (patch.assigned_to !== undefined && Number(patch.assigned_to) !== Number(before.assigned_to)) {
      await addOrderEvent(id, {
        actor,
        kind: "assign",
        message: patch.assigned_name || String(patch.assigned_to || "снят"),
      });
    }
  }
  return row;
}

async function updateOrderStatus(id, status) {
  return updateOrder(id, { status });
}

async function getOrderStats(period) {
  const p = getPool();
  if (!p) {
    return {
      total: 0,
      by_status: {},
      today: 0,
      week: 0,
      month: 0,
      top_products: [],
      top_colors: [],
      top_storage: [],
      repeat_phones: [],
      revenue_done: 0,
      period: period || "all",
      period_total: 0,
      daily: [],
    };
  }
  const pc = periodClause(period);
  const baseWhere = pc
    ? `WHERE ${pc} AND status <> 'archived'`
    : `WHERE status <> 'archived'`;

  const total = await p.query(`SELECT COUNT(*)::int AS n FROM orders ${baseWhere}`);
  const byStatus = await p.query(
    `SELECT status, COUNT(*)::int AS n FROM orders ${baseWhere} GROUP BY status`
  );
  const today = await p.query(
    `SELECT COUNT(*)::int AS n FROM orders WHERE status <> 'archived' AND created_at >= date_trunc('day', NOW())`
  );
  const week = await p.query(
    `SELECT COUNT(*)::int AS n FROM orders WHERE status <> 'archived' AND created_at >= NOW() - INTERVAL '7 days'`
  );
  const month = await p.query(
    `SELECT COUNT(*)::int AS n FROM orders WHERE status <> 'archived' AND created_at >= NOW() - INTERVAL '30 days'`
  );
  const top = await p.query(
    `SELECT product_id, product_name, COUNT(*)::int AS n
     FROM orders ${baseWhere} GROUP BY product_id, product_name
     ORDER BY n DESC LIMIT 10`
  );
  const topColors = await p.query(
    `SELECT color_name, COUNT(*)::int AS n FROM orders
     ${baseWhere} AND COALESCE(color_name,'') <> ''
     GROUP BY color_name ORDER BY n DESC LIMIT 8`
  );
  const topStorage = await p.query(
    `SELECT storage, COUNT(*)::int AS n FROM orders
     ${baseWhere} AND COALESCE(storage,'') <> ''
     GROUP BY storage ORDER BY n DESC LIMIT 8`
  );
  const repeats = await p.query(
    `SELECT phone, COUNT(*)::int AS n, MAX(created_at) AS last_at
     FROM orders ${baseWhere}
     GROUP BY phone HAVING COUNT(*) > 1
     ORDER BY n DESC, last_at DESC LIMIT 15`
  );
  const revenueDoneSql = pc
    ? `SELECT COALESCE(SUM(price),0)::int AS s FROM orders WHERE ${pc} AND status = 'done'`
    : `SELECT COALESCE(SUM(price),0)::int AS s FROM orders WHERE status = 'done'`;
  const revenueDone = await p.query(revenueDoneSql);
  const periodTotal = await p.query(`SELECT COUNT(*)::int AS n FROM orders ${baseWhere}`);
  const periodRev = await p.query(revenueDoneSql);

  const daysBack = period === "today" ? 1 : period === "week" ? 7 : 14;
  const series = await p.query(
    `WITH days AS (
       SELECT generate_series(
         date_trunc('day', NOW()) - ($1::int - 1) * INTERVAL '1 day',
         date_trunc('day', NOW()),
         INTERVAL '1 day'
       )::date AS d
     )
     SELECT to_char(days.d, 'DD.MM') AS label,
            COALESCE(COUNT(o.id), 0)::int AS n,
            COALESCE(SUM(CASE WHEN o.status = 'done' THEN o.price ELSE 0 END), 0)::int AS revenue
     FROM days
     LEFT JOIN orders o
       ON o.created_at::date = days.d AND o.status <> 'archived'
     GROUP BY days.d
     ORDER BY days.d`,
    [daysBack]
  );

  const by_status = {};
  for (const row of byStatus.rows) by_status[row.status] = row.n;
  return {
    total: total.rows[0]?.n || 0,
    today: today.rows[0]?.n || 0,
    week: week.rows[0]?.n || 0,
    month: month.rows[0]?.n || 0,
    by_status,
    top_products: top.rows,
    top_colors: topColors.rows,
    top_storage: topStorage.rows,
    repeat_phones: repeats.rows,
    revenue_done: revenueDone.rows[0]?.s || 0,
    period: period || "all",
    period_total: periodTotal.rows[0]?.n || 0,
    period_revenue: periodRev.rows[0]?.s || 0,
    daily: series.rows,
  };
}

async function listFaq() {
  const p = getPool();
  if (!p) return [];
  const r = await p.query(`SELECT id, title, body, sort_order FROM faq_templates ORDER BY sort_order, id`);
  return r.rows;
}

async function saveFaq(id, { title, body, sort_order }) {
  const p = getPool();
  if (!p) return null;
  if (id) {
    const r = await p.query(
      `UPDATE faq_templates SET title=$1, body=$2, sort_order=COALESCE($3, sort_order) WHERE id=$4 RETURNING *`,
      [title, body, sort_order ?? null, id]
    );
    return r.rows[0] || null;
  }
  const r = await p.query(
    `INSERT INTO faq_templates (title, body, sort_order) VALUES ($1,$2,COALESCE($3,0)) RETURNING *`,
    [title, body, sort_order ?? 0]
  );
  return r.rows[0];
}

async function deleteFaq(id) {
  const p = getPool();
  if (!p) return false;
  await p.query(`DELETE FROM faq_templates WHERE id=$1`, [id]);
  return true;
}

function ordersToCsv(items) {
  const cols = [
    "id",
    "created_at",
    "status",
    "product_name",
    "color_name",
    "storage",
    "price",
    "payment_title",
    "phone",
    "telegram_username",
    "telegram_full_name",
    "assigned_name",
    "manager_note",
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const row of items) {
    lines.push(cols.map((c) => esc(row[c])).join(","));
  }
  return "\uFEFF" + lines.join("\n");
}

module.exports = {
  initDb,
  saveOrder,
  getPool,
  listOrders,
  getOrder,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  addOrderEvent,
  listOrderEvents,
  getOrderStats,
  listFaq,
  saveFaq,
  deleteFaq,
  ordersToCsv,
  ORDER_STATUSES,
};
