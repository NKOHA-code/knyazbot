const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Bot, InlineKeyboard, Keyboard } = require("grammy");
const { initDb, saveOrder } = require("./db");
const { mountAdmin } = require("./admin-panel");
const { buildAdminOrderNotify, adminPanelBaseUrl } = require("./admin-order-notify");
const catalogAdmin = require("./catalog-admin");
const { startFxScheduler } = require("./fx-rates");

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID || 318629821);
const DOMAIN = (process.env.DOMAIN || "").trim();
const ADMIN_PATH = (process.env.ADMIN_PATH || "").trim().replace(/^\/+|\/+$/g, "");
const MANAGER_USERNAME = process.env.MANAGER_USERNAME || "knyaztut";
const MANAGER_PHONE = process.env.MANAGER_PHONE || "+375297330592";
const SHOP_ADDRESS = process.env.SHOP_ADDRESS || "Минск, Нововиленская 10";
const SHOP_NAME = process.env.SHOP_NAME || "КнязьMobile";
const ALLOW_INSECURE = String(process.env.ALLOW_INSECURE_ORDERS || "false").toLowerCase() === "true";

/**
 * Bothost auto-Dockerfile runs:
 *   node /app/http-wrapper.js & node app.js
 * so HTTP must live ONLY in http-wrapper.js, bot ONLY in app.js.
 */
const role = process.env.BOTHOST_ROLE || (require.main === module ? detectRole() : "unknown");

function detectRole() {
  const entry = path.basename(process.argv[1] || "");
  if (entry === "http-wrapper.js" || entry === "http_wrapper.js") return "http";
  if (entry === "app.js") return "bot";
  return "all";
}

function publicUrl() {
  if (DOMAIN) {
    if (DOMAIN.startsWith("http://") || DOMAIN.startsWith("https://")) return DOMAIN.replace(/\/$/, "");
    return `https://${DOMAIN}`.replace(/\/$/, "");
  }
  return `http://127.0.0.1:${PORT}`;
}

const PAYMENTS = [
  { id: "cash", title: "Наличные / карта" },
  { id: "installment", title: "Рассрочка" },
  { id: "leasing", title: "Лизинг" },
];
const PAYMENT_TITLES = Object.fromEntries(PAYMENTS.map((p) => [p.id, p.title]));

function readJsonFile(file) {
  let buf = fs.readFileSync(file);
  // Strip UTF-8 BOM bytes (EF BB BF) before decode — Windows editors often add it
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  let text = buf.toString("utf8");
  text = text.replace(/^[\uFEFF\u200B\u200C\u200D\u2060]+/, "").trim();
  return JSON.parse(text);
}

function loadCatalog() {
  const candidates = [
    path.join(__dirname, "catalog", "catalog.json"),
    path.join(__dirname, "public", "catalog.json"),
    path.join(__dirname, "data", "catalog.json"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    throw new Error("catalog.json not found (checked catalog/, public/, data/)");
  }
  console.log("catalog file:", file);
  const raw = readJsonFile(file);
  const products = raw.products
    .filter((p) => !p.hidden)
    .map((p) => {
    const priced = (p.configs || []).map((c) => c.price).filter((n) => n > 0);
    const min = priced.length ? Math.min(...priced) : null;
    return {
      ...p,
      min_price: min,
      price_from: min == null ? "цену уточнит менеджер" : `от ${min} BYN`,
    };
  })
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  return {
    categories: raw.categories,
    products,
    payments: PAYMENTS,
    shop: {
      name: SHOP_NAME,
      address: SHOP_ADDRESS,
      phone: MANAGER_PHONE,
      manager: MANAGER_USERNAME,
    },
  };
}

function findProduct(catalog, productId) {
  return catalog.products.find((p) => p.id === productId) || null;
}

function priceText(price) {
  if (!price || price <= 0) return "уточнит менеджер";
  return `${price} BYN`;
}

function parseInitData(initData, botToken) {
  if (!initData) return null;
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
  return userRaw ? JSON.parse(userRaw) : {};
}

async function startHttp(botForNotify) {
  console.log("КнязьMobile build=2026-08-01c (persist-catalog-uploads)");
  await initDb();
  try {
    const cat = loadCatalog();
    console.log("catalog OK products=", cat.products.length, "file=data/catalog.json");
  } catch (err) {
    console.error("catalog preload failed", err.message);
  }
  startFxScheduler();
  const app = express();
  // 32mb: photo as base64 is ~4/3 of file size; 15MB file ≈ 20MB+ JSON
  app.use(express.json({ limit: "32mb" }));
  app.use(express.urlencoded({ extended: false, limit: "32mb" }));
  mountAdmin(app);
  // Persistent uploads (Bothost keeps /app/data across Git updates)
  app.use("/images/uploads", express.static(path.join(__dirname, "data", "uploads")));
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/health", async (_req, res) => {
    let db = false;
    try {
      const { getPool } = require("./db");
      const pool = getPool();
      if (pool) {
        await pool.query("SELECT 1");
        db = true;
      }
    } catch (_) {
      db = false;
    }
    res.json({ ok: true, role: "http", db });
  });
  app.get("/health", (_req, res) => res.json({ ok: true, role: "http" }));
  app.get("/api/catalog", (_req, res) => {
    try {
      res.json(loadCatalog());
    } catch (err) {
      console.error("catalog load failed", err);
      res.status(500).json({ detail: String(err.message || err) });
    }
  });

  app.post("/api/order", async (req, res) => {
    try {
      if (!BOT_TOKEN) return res.status(500).json({ detail: "BOT_TOKEN missing" });
      const body = req.body || {};
      let phone = String(body.phone || "").trim();
      let phoneDigits = phone.replace(/\D/g, "");
      if (phoneDigits.startsWith("80") && phoneDigits.length >= 11) {
        phoneDigits = "375" + phoneDigits.slice(2);
      }
      if (phoneDigits.startsWith("0") && phoneDigits.length === 10) {
        phoneDigits = "375" + phoneDigits.slice(1);
      }
      if (phoneDigits.length === 9 && !phoneDigits.startsWith("375")) {
        phoneDigits = "375" + phoneDigits;
      }
      if (!/^375\d{9}$/.test(phoneDigits)) {
        return res.status(400).json({ detail: "Укажите номер РБ: +375 и 9 цифр" });
      }
      phone = `+${phoneDigits}`;

      const catalog = loadCatalog();
      const product = findProduct(catalog, String(body.product_id || ""));
      if (!product) return res.status(404).json({ detail: "Товар не найден" });

      const color = (product.colors || []).find((c) => c.id === String(body.color_id || ""));
      const config = (product.configs || []).find((c) => c.id === String(body.config_id || ""));
      const paymentId = String(body.payment_id || "").trim();
      const paymentsList = catalog.payments?.length ? catalog.payments : PAYMENTS;
      const paymentRow = paymentsList.find((p) => p.id === paymentId);
      const paymentTitle =
        paymentRow?.title ||
        PAYMENT_TITLES[paymentId] ||
        "";
      if (!color || !config || !paymentId || !paymentTitle) {
        return res.status(400).json({ detail: "Выберите цвет, память и оплату" });
      }
      console.log("order payment", { paymentId, paymentTitle, product: product.id });

      let user = parseInitData(String(body.init_data || ""), BOT_TOKEN);
      if (!user && !ALLOW_INSECURE) {
        return res.status(401).json({ detail: "Откройте витрину через Telegram" });
      }
      user = user || {};
      const userId = user.id || 0;
      const username = user.username || null;
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Клиент Mini App";

      let orderId = null;
      try {
        const saved = await saveOrder({
          product_id: product.id,
          product_name: product.name,
          color_id: color.id,
          color_name: color.name,
          config_id: config.id,
          storage: config.storage,
          price: config.price || 0,
          payment_id: paymentId,
          payment_title: paymentTitle,
          phone,
          telegram_user_id: userId || null,
          telegram_username: username,
          telegram_full_name: fullName,
        });
        orderId = saved?.id || null;
      } catch (dbErr) {
        console.error("saveOrder failed", dbErr);
      }

      const notifyBase = {
        orderId,
        productName: product.name,
        colorName: color.name,
        storage: config.storage,
        priceText: priceText(config.price),
        payment: paymentTitle,
        phone,
        fullName,
        username,
        userId,
      };
      const adminUrl = adminPanelBaseUrl(publicUrl(), ADMIN_PATH);
      const notifyManagers = buildAdminOrderNotify(notifyBase, {
        shopName: SHOP_NAME,
        includeAdminButton: false,
      });
      const notifyOwner = buildAdminOrderNotify(notifyBase, {
        shopName: SHOP_NAME,
        adminUrl,
        includeAdminButton: true,
      });

      const notifier = botForNotify || new Bot(BOT_TOKEN);
      const chatIds = new Set([ADMIN_CHAT_ID].filter(Boolean));
      for (const m of catalogAdmin.loadManagers()) {
        const id = Number(m.telegram_id);
        if (Number.isFinite(id) && id > 0) chatIds.add(id);
      }
      for (const chatId of chatIds) {
        try {
          const payload = Number(chatId) === Number(ADMIN_CHAT_ID) ? notifyOwner : notifyManagers;
          await notifier.api.sendMessage(chatId, payload.text, {
            parse_mode: "HTML",
            reply_markup: payload.reply_markup,
            disable_web_page_preview: true,
          });
        } catch (notifyErr) {
          console.error("notify manager", chatId, notifyErr.message);
        }
      }
      return res.json({ ok: true, order_id: orderId });
    } catch (err) {
      console.error("order error", err);
      return res.status(500).json({ detail: "Ошибка отправки заявки" });
    }
  });

  // body-parser PayloadTooLargeError is thrown before route handlers
  app.use((err, _req, res, next) => {
    if (!err) return next();
    if (err.type === "entity.too.large" || err.status === 413 || err.name === "PayloadTooLargeError") {
      return res.status(413).json({ detail: "Файл слишком большой (макс. 15 МБ)" });
    }
    console.error("http error", err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ detail: err.message || "Ошибка сервера" });
  });

  await new Promise((resolve) => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`${SHOP_NAME} HTTP-only on 0.0.0.0:${PORT} url=${publicUrl()}`);
      resolve();
    });
  });
}

async function startBot() {
  if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  const bot = new Bot(BOT_TOKEN);
  const WEBAPP_URL = publicUrl();

  const mainKeyboard = () =>
    new Keyboard()
      .webApp("📱 Открыть витрину", WEBAPP_URL)
      .row()
      .text("❓ FAQ")
      .text("👑 Менеджер")
      .row()
      .text("📍 Адрес и контакты")
      .resized();

  const managerKeyboard = () =>
    new InlineKeyboard().url("Написать менеджеру", `https://t.me/${MANAGER_USERNAME}`);

  const catalogKeyboard = () => new InlineKeyboard().webApp("Открыть витрину", WEBAPP_URL);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      `👑 Добро пожаловать в <b>${SHOP_NAME}</b>!\n\n` +
        `Откройте витрину: модель, цвет и память — заявка за минуту.\n\n` +
        `Рассрочка и лизинг · доставка по РБ · гарантия`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() }
    );
    await ctx.reply("Витрина:", { reply_markup: catalogKeyboard() });
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply("Открыть витрину:", { reply_markup: catalogKeyboard() });
  });

  bot.hears("❓ FAQ", async (ctx) => {
    await ctx.reply(
      `<b>Частые вопросы</b>\n\n` +
        `<b>Оригинал?</b> Да, заводская упаковка.\n\n` +
        `<b>Гарантия?</b> 12 мес + сервис 24–36.\n\n` +
        `<b>Доставка?</b> Бесплатно по РБ.\n\n` +
        `<b>Где?</b> ${SHOP_ADDRESS}\n📞 ${MANAGER_PHONE} · @${MANAGER_USERNAME}`,
      { parse_mode: "HTML", reply_markup: managerKeyboard() }
    );
  });

  bot.hears("📍 Адрес и контакты", async (ctx) => {
    await ctx.reply(
      `<b>${SHOP_NAME}</b>\n\n📍 ${SHOP_ADDRESS}\n📞 ${MANAGER_PHONE}\n📲 @${MANAGER_USERNAME}`,
      { parse_mode: "HTML", reply_markup: managerKeyboard() }
    );
  });

  bot.hears("👑 Менеджер", async (ctx) => {
    await ctx.reply("Напишите менеджеру:", { reply_markup: managerKeyboard() });
  });

  await bot.api.deleteWebhook({ drop_pending_updates: true });
  bot.start({
    onStart: (info) => console.log(`Bot-only @${info.username} started (polling)`),
  });
}

async function main() {
  console.log(`role=${role} PORT=${process.env.PORT || ""} DOMAIN=${DOMAIN}`);
  if (role === "http") {
    await startHttp();
    return;
  }
  if (role === "bot") {
    await startBot();
    return;
  }
  // Local/dev: both in one process
  const bot = BOT_TOKEN ? new Bot(BOT_TOKEN) : null;
  await startHttp(bot);
  if (bot) await startBot();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
