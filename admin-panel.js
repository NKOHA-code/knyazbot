/**
 * Hidden admin panel: secret path + password + signed httpOnly cookie.
 * Mounted only when ADMIN_PATH and ADMIN_PASSWORD are set.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { listOrders, updateOrderStatus, ORDER_STATUSES, getPool } = require("./db");

const ADMIN_PATH = (process.env.ADMIN_PATH || "").trim().replace(/^\/+|\/+$/g, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET =
  (process.env.ADMIN_SESSION_SECRET || "").trim() ||
  (process.env.BOT_TOKEN || "").trim();

const COOKIE_NAME = "knyaz_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const loginAttempts = new Map(); // ip -> { count, resetAt }

function adminEnabled() {
  return Boolean(ADMIN_PATH && ADMIN_PASSWORD && ADMIN_SESSION_SECRET && ADMIN_PATH.length >= 8);
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // keep constant-ish work
    crypto.timingSafeEqual(Buffer.alloc(ba.length), Buffer.alloc(ba.length));
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function signPayload(payloadB64) {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payloadB64).digest("base64url");
}

function makeSessionCookie() {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, exp: Date.now() + SESSION_TTL_MS }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionCookie(raw) {
  if (!raw || typeof raw !== "string") return false;
  const parts = raw.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = signPayload(payload);
  if (!timingSafeEqualStr(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || data.v !== 1 || typeof data.exp !== "number") return false;
    if (Date.now() > data.exp) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
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
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
  );
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
  const cookies = parseCookies(req);
  if (!verifySessionCookie(cookies[COOKIE_NAME])) {
    if (String(req.path || "").includes("/api/")) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    res.redirect(`/a/${ADMIN_PATH}/`);
    return;
  }
  next();
}

function mountAdmin(app) {
  if (!adminEnabled()) {
    console.log("Admin panel disabled (set ADMIN_PATH ≥8 chars, ADMIN_PASSWORD, ADMIN_SESSION_SECRET)");
    return false;
  }

  const adminDir = path.join(__dirname, "admin");
  const loginHtml = path.join(adminDir, "login.html");
  const appHtml = path.join(adminDir, "app.html");

  // Wrong /a/:path* → plain 404 (no hint that admin exists)
  app.use("/a/:path", (req, res, next) => {
    if (req.params.path !== ADMIN_PATH) {
      notFound(res);
      return;
    }
    next();
  });

  function serveLoginPage(req, res) {
    const cookies = parseCookies(req);
    if (verifySessionCookie(cookies[COOKIE_NAME])) {
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
    setSessionCookie(res, makeSessionCookie());
    return res.json({ ok: true, redirect: `/a/${ADMIN_PATH}/app` });
  });

  app.post("/a/:path/logout", gatePath, (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true, redirect: `/a/${ADMIN_PATH}/` });
  });

  app.get("/a/:path/app", gatePath, requireAuth, (_req, res) => {
    sendHtml(res, appHtml);
  });

  app.get("/a/:path/api/orders", gatePath, requireAuth, async (req, res) => {
    try {
      if (!getPool()) {
        return res.status(503).json({ detail: "База данных не подключена (DATABASE_URL)" });
      }
      const status = String(req.query.status || "").trim() || undefined;
      const q = String(req.query.q || "").trim() || undefined;
      const limit = Number(req.query.limit || 50);
      const offset = Number(req.query.offset || 0);
      const data = await listOrders({ status, q, limit, offset });
      res.json({ ...data, statuses: ORDER_STATUSES });
    } catch (err) {
      console.error("admin listOrders", err);
      res.status(500).json({ detail: "Ошибка загрузки заявок" });
    }
  });

  app.patch("/a/:path/api/orders/:id", gatePath, requireAuth, async (req, res) => {
    try {
      if (!getPool()) {
        return res.status(503).json({ detail: "База данных не подключена" });
      }
      const id = Number(req.params.id);
      const status = String((req.body && req.body.status) || "");
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ detail: "Некорректный id" });
      }
      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({ detail: "Некорректный статус" });
      }
      const row = await updateOrderStatus(id, status);
      if (!row) return res.status(404).json({ detail: "Заявка не найдена" });
      res.json({ ok: true, order: row });
    } catch (err) {
      console.error("admin updateOrderStatus", err);
      res.status(500).json({ detail: "Ошибка обновления" });
    }
  });

  console.log(`Admin panel enabled at /a/${ADMIN_PATH}/ (do not share this URL)`);
  return true;
}

module.exports = { mountAdmin, adminEnabled };
