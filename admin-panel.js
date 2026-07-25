/**
 * Hidden admin panel — orders, catalog, stats, FAQ, managers, Telegram login.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  listOrders,
  updateOrder,
  ORDER_STATUSES,
  getPool,
  getOrderStats,
  listFaq,
  saveFaq,
  deleteFaq,
  ordersToCsv,
} = require("./db");
const catalogAdmin = require("./catalog-admin");

const ADMIN_PATH = (process.env.ADMIN_PATH || "").trim().replace(/^\/+|\/+$/g, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET =
  (process.env.ADMIN_SESSION_SECRET || "").trim() || (process.env.BOT_TOKEN || "").trim();
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID || 0);

const COOKIE_NAME = "knyaz_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const loginAttempts = new Map();

function adminEnabled() {
  return Boolean(ADMIN_PATH && ADMIN_PASSWORD && ADMIN_SESSION_SECRET && ADMIN_PATH.length >= 8);
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(Buffer.alloc(ba.length), Buffer.alloc(ba.length));
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function signPayload(payloadB64) {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payloadB64).digest("base64url");
}

function makeSessionCookie(extra = {}) {
  const payload = Buffer.from(
    JSON.stringify({ v: 2, exp: Date.now() + SESSION_TTL_MS, ...extra }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function readSession(raw) {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!timingSafeEqualStr(sig, signPayload(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || (data.v !== 1 && data.v !== 2) || typeof data.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch (_) {
      out[k] = v;
    }
  }
  return out;
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function checkLoginRate(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 };
    loginAttempts.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= 10;
}

function setSessionCookie(res, value) {
  const secure = Boolean(process.env.DOMAIN) || process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function sendHtml(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.status(404).type("text").send("Not found");
    return;
  }
  res.status(200).type("html").send(fs.readFileSync(filePath, "utf8"));
}

function notFound(res) {
  res.status(404).type("text").send("Not found");
}

function gatePath(req, res, next) {
  if (req.params.path !== ADMIN_PATH) {
    notFound(res);
    return;
  }
  next();
}

function requireAuth(req, res, next) {
  const session = readSession(parseCookies(req)[COOKIE_NAME]);
  if (!session) {
    if (String(req.path || "").includes("/api/")) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    res.redirect(`/a/${ADMIN_PATH}/`);
    return;
  }
  req.adminSession = session;
  next();
}

function parseInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (calculated !== hash) return null;
  const userRaw = params.get("user");
  return userRaw ? JSON.parse(userRaw) : null;
}

async function notifyTelegram(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error("admin notifyTelegram", err.message);
  }
}

function mountAdmin(app) {
  if (!adminEnabled()) {
    console.log("Admin panel disabled (set ADMIN_PATH ≥8 chars, ADMIN_PASSWORD, ADMIN_SESSION_SECRET)");
    return false;
  }

  const adminDir = path.join(__dirname, "admin");
  const loginHtml = path.join(adminDir, "login.html");
  const appHtml = path.join(adminDir, "app.html");

  app.use("/a/:path", (req, res, next) => {
    if (req.params.path !== ADMIN_PATH) {
      notFound(res);
      return;
    }
    next();
  });

  function serveLoginPage(req, res) {
    if (readSession(parseCookies(req)[COOKIE_NAME])) {
      res.redirect(302, `/a/${ADMIN_PATH}/app`);
      return;
    }
    sendHtml(res, loginHtml);
  }

  app.get("/a/:path", gatePath, serveLoginPage);
  app.get("/a/:path/", gatePath, serveLoginPage);

  app.post("/a/:path/login", gatePath, (req, res) => {
    const ip = clientIp(req);
    if (!checkLoginRate(ip)) {
      return res.status(429).json({ detail: "Слишком много попыток. Подождите минуту." });
    }
    const password = String((req.body && req.body.password) || "");
    if (!timingSafeEqualStr(password, ADMIN_PASSWORD)) {
      return res.status(401).json({ detail: "Неверный пароль" });
    }
    setSessionCookie(res, makeSessionCookie({ mid: ADMIN_CHAT_ID || null, name: "Админ" }));
    return res.json({ ok: true, redirect: `/a/${ADMIN_PATH}/app` });
  });

  app.post("/a/:path/login/telegram", gatePath, (req, res) => {
    const ip = clientIp(req);
    if (!checkLoginRate(ip)) {
      return res.status(429).json({ detail: "Слишком много попыток" });
    }
    if (!BOT_TOKEN) return res.status(500).json({ detail: "BOT_TOKEN missing" });
    const user = parseInitData(String((req.body && req.body.init_data) || ""), BOT_TOKEN);
    if (!user?.id) return res.status(401).json({ detail: "Откройте админку через Telegram" });
    if (!catalogAdmin.isAllowedAdminId(user.id)) {
      return res.status(403).json({ detail: "Нет доступа (Telegram ID не в списке менеджеров)" });
    }
    const managers = catalogAdmin.loadManagers();
    const mgr = managers.find((m) => Number(m.telegram_id) === Number(user.id));
    const name =
      mgr?.name ||
      [user.first_name, user.last_name].filter(Boolean).join(" ") ||
      user.username ||
      String(user.id);
    setSessionCookie(res, makeSessionCookie({ mid: user.id, name }));
    return res.json({ ok: true, redirect: `/a/${ADMIN_PATH}/app`, manager: { id: user.id, name } });
  });

  app.post("/a/:path/logout", gatePath, (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true, redirect: `/a/${ADMIN_PATH}/` });
  });

  app.get("/a/:path/app", gatePath, requireAuth, (_req, res) => sendHtml(res, appHtml));

  app.get("/a/:path/api/me", gatePath, requireAuth, (req, res) => {
    res.json({
      name: req.adminSession.name || "Админ",
      mid: req.adminSession.mid || null,
      managers: catalogAdmin.loadManagers(),
    });
  });

  // —— Orders ——
  app.get("/a/:path/api/orders", gatePath, requireAuth, async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ detail: "База данных не подключена" });
      const data = await listOrders({
        status: String(req.query.status || "").trim() || undefined,
        q: String(req.query.q || "").trim() || undefined,
        product_id: String(req.query.product_id || "").trim() || undefined,
        period: String(req.query.period || "").trim() || undefined,
        limit: Number(req.query.limit || 80),
        offset: Number(req.query.offset || 0),
      });
      res.json({ ...data, statuses: ORDER_STATUSES, managers: catalogAdmin.loadManagers() });
    } catch (err) {
      console.error("admin listOrders", err);
      res.status(500).json({ detail: "Ошибка загрузки заявок" });
    }
  });

  app.get("/a/:path/api/orders.csv", gatePath, requireAuth, async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ detail: "БД не подключена" });
      const data = await listOrders({
        status: String(req.query.status || "").trim() || undefined,
        q: String(req.query.q || "").trim() || undefined,
        product_id: String(req.query.product_id || "").trim() || undefined,
        period: String(req.query.period || "").trim() || undefined,
        limit: 2000,
        offset: 0,
      });
      const csv = ordersToCsv(data.items);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="orders.csv"');
      res.send(csv);
    } catch (err) {
      console.error("admin csv", err);
      res.status(500).json({ detail: "Ошибка экспорта" });
    }
  });

  app.patch("/a/:path/api/orders/:id", gatePath, requireAuth, async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ detail: "БД не подключена" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ detail: "Некорректный id" });
      const body = req.body || {};
      const patch = {};
      if (body.status !== undefined) patch.status = String(body.status);
      if (body.manager_note !== undefined) patch.manager_note = String(body.manager_note);
      if (body.assigned_to !== undefined) {
        patch.assigned_to = body.assigned_to;
        if (body.assigned_name !== undefined) patch.assigned_name = body.assigned_name;
        else {
          const m = catalogAdmin.loadManagers().find((x) => Number(x.telegram_id) === Number(body.assigned_to));
          patch.assigned_name = m?.name || req.adminSession.name || null;
        }
      }
      if (body.take === true) {
        patch.assigned_to = req.adminSession.mid || ADMIN_CHAT_ID || null;
        patch.assigned_name = req.adminSession.name || "Менеджер";
        if (!patch.status) patch.status = "in_progress";
      }
      const row = await updateOrder(id, patch);
      if (!row) return res.status(404).json({ detail: "Заявка не найдена" });
      if (patch.status) {
        await notifyTelegram(
          `📋 Заявка <b>#${row.id}</b> → <b>${row.status}</b>\n` +
            `${row.product_name || ""} · ${row.phone || ""}\n` +
            `Кто: ${req.adminSession.name || "админ"}`
        );
      }
      res.json({ ok: true, order: row });
    } catch (err) {
      console.error("admin updateOrder", err);
      res.status(500).json({ detail: err.message || "Ошибка обновления" });
    }
  });

  // —— Stats ——
  app.get("/a/:path/api/stats", gatePath, requireAuth, async (_req, res) => {
    try {
      res.json(await getOrderStats());
    } catch (err) {
      res.status(500).json({ detail: "Ошибка статистики" });
    }
  });

  // —— Catalog ——
  app.get("/a/:path/api/catalog", gatePath, requireAuth, (_req, res) => {
    try {
      res.json(catalogAdmin.getCatalog());
    } catch (err) {
      res.status(500).json({ detail: String(err.message || err) });
    }
  });

  app.put("/a/:path/api/catalog/product", gatePath, requireAuth, (req, res) => {
    try {
      const product = catalogAdmin.upsertProduct(req.body || {});
      res.json({ ok: true, product });
    } catch (err) {
      res.status(400).json({ detail: err.message || "Ошибка" });
    }
  });

  app.delete("/a/:path/api/catalog/product/:id", gatePath, requireAuth, (req, res) => {
    try {
      const ok = catalogAdmin.deleteProduct(req.params.id);
      if (!ok) return res.status(404).json({ detail: "Не найден" });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ detail: err.message });
    }
  });

  app.patch("/a/:path/api/catalog/product/:id/config/:cfg", gatePath, requireAuth, (req, res) => {
    try {
      const product = catalogAdmin.patchConfig(req.params.id, req.params.cfg, req.body || {});
      res.json({ ok: true, product });
    } catch (err) {
      res.status(400).json({ detail: err.message });
    }
  });

  app.patch("/a/:path/api/catalog/product/:id/color/:colorId", gatePath, requireAuth, (req, res) => {
    try {
      const product = catalogAdmin.patchColor(req.params.id, req.params.colorId, req.body || {});
      res.json({ ok: true, product });
    } catch (err) {
      res.status(400).json({ detail: err.message });
    }
  });

  app.post("/a/:path/api/catalog/upload", gatePath, requireAuth, (req, res) => {
    try {
      const raw = String((req.body && req.body.data) || "");
      const filename = String((req.body && req.body.filename) || "upload.png");
      const b64 = raw.replace(/^data:[^;]+;base64,/, "");
      if (!b64 || b64.length < 32) return res.status(400).json({ detail: "Нет файла" });
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 4 * 1024 * 1024) return res.status(400).json({ detail: "Макс. 4 МБ" });
      const url = catalogAdmin.saveUploadedImage(buf, filename);
      const productId = req.body?.product_id;
      const colorId = req.body?.color_id;
      if (productId && colorId) {
        catalogAdmin.patchColor(productId, colorId, { image: url });
      }
      res.json({ ok: true, url });
    } catch (err) {
      res.status(400).json({ detail: err.message || "Ошибка загрузки" });
    }
  });

  // —— FAQ ——
  app.get("/a/:path/api/faq", gatePath, requireAuth, async (_req, res) => {
    try {
      res.json({ items: await listFaq() });
    } catch (err) {
      res.status(500).json({ detail: "Ошибка FAQ" });
    }
  });

  app.post("/a/:path/api/faq", gatePath, requireAuth, async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim();
      const body = String(req.body?.body || "").trim();
      if (!title || !body) return res.status(400).json({ detail: "title и body обязательны" });
      const row = await saveFaq(null, {
        title,
        body,
        sort_order: Number(req.body?.sort_order || 0),
      });
      res.json({ ok: true, item: row });
    } catch (err) {
      res.status(500).json({ detail: err.message });
    }
  });

  app.put("/a/:path/api/faq/:id", gatePath, requireAuth, async (req, res) => {
    try {
      const row = await saveFaq(Number(req.params.id), {
        title: String(req.body?.title || "").trim(),
        body: String(req.body?.body || "").trim(),
        sort_order: req.body?.sort_order !== undefined ? Number(req.body.sort_order) : undefined,
      });
      res.json({ ok: true, item: row });
    } catch (err) {
      res.status(500).json({ detail: err.message });
    }
  });

  app.delete("/a/:path/api/faq/:id", gatePath, requireAuth, async (req, res) => {
    try {
      await deleteFaq(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ detail: err.message });
    }
  });

  // —— Managers ——
  app.get("/a/:path/api/managers", gatePath, requireAuth, (_req, res) => {
    res.json({ items: catalogAdmin.loadManagers() });
  });

  app.put("/a/:path/api/managers", gatePath, requireAuth, (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const cleaned = items
        .map((m) => ({
          telegram_id: Number(m.telegram_id),
          name: String(m.name || "").trim() || `ID ${m.telegram_id}`,
        }))
        .filter((m) => Number.isFinite(m.telegram_id) && m.telegram_id > 0);
      catalogAdmin.saveManagers(cleaned);
      res.json({ ok: true, items: cleaned });
    } catch (err) {
      res.status(400).json({ detail: err.message });
    }
  });

  console.log(`Admin panel enabled at /a/${ADMIN_PATH}/ (do not share this URL)`);
  return true;
}

module.exports = { mountAdmin, adminEnabled };
