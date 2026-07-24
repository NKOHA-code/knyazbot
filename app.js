const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Bot, InlineKeyboard, Keyboard } = require("grammy");

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID || 318629821);
const DOMAIN = (process.env.DOMAIN || "").trim();
const MANAGER_USERNAME = process.env.MANAGER_USERNAME || "knyaztut";
const MANAGER_PHONE = process.env.MANAGER_PHONE || "+375297330592";
const SHOP_ADDRESS = process.env.SHOP_ADDRESS || "Минск, Нововиленская 10";
const SHOP_NAME = process.env.SHOP_NAME || "КнязьMobile";
const ALLOW_INSECURE = String(process.env.ALLOW_INSECURE_ORDERS || "false").toLowerCase() === "true";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
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

function loadCatalog() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "catalog.json"), "utf8"));
  const products = raw.products.map((p) => {
    const priced = (p.configs || []).map((c) => c.price).filter((n) => n > 0);
    const min = priced.length ? Math.min(...priced) : null;
    return {
      ...p,
      min_price: min,
      price_from: min == null ? "цену уточнит менеджер" : `от ${min} BYN`,
    };
  });
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

/** Validate Telegram WebApp initData (HMAC-SHA256). */
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

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const bot = new Bot(BOT_TOKEN);
const WEBAPP_URL = publicUrl();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/catalog", (_req, res) => {
  res.json(loadCatalog());
});

app.post("/api/order", async (req, res) => {
  try {
    const body = req.body || {};
    const productId = String(body.product_id || "");
    const colorId = String(body.color_id || "");
    const configId = String(body.config_id || "");
    const paymentId = String(body.payment_id || "");
    const phone = String(body.phone || "").trim();
    const initData = String(body.init_data || "");

    if (phone.length < 7) {
      return res.status(400).json({ detail: "Укажите телефон" });
    }

    const catalog = loadCatalog();
    const product = findProduct(catalog, productId);
    if (!product) return res.status(404).json({ detail: "Товар не найден" });

    const color = (product.colors || []).find((c) => c.id === colorId);
    const config = (product.configs || []).find((c) => c.id === configId);
    const payment = PAYMENT_TITLES[paymentId];
    if (!color || !config || !payment) {
      return res.status(400).json({ detail: "Выберите цвет, память и оплату" });
    }

    let user = parseInitData(initData, BOT_TOKEN);
    if (!user && !ALLOW_INSECURE) {
      return res.status(401).json({ detail: "Откройте витрину через Telegram" });
    }
    user = user || {};

    const userId = user.id || 0;
    const username = user.username ? `@${user.username}` : "без username";
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Клиент Mini App";

    const text =
      `🛒 <b>Новая заявка уКнязя</b>\n\n` +
      `📱 Товар: <b>${product.name}</b>\n` +
      `🎨 Цвет: ${color.name}\n` +
      `💾 Память: ${config.storage}\n` +
      `💰 Цена: ${priceText(config.price)}\n` +
      `💳 Оплата: ${payment}\n` +
      `📞 Телефон: <code>${phone}</code>\n\n` +
      `👤 Клиент: ${fullName} (${username})\n` +
      `🆔 ID: <code>${userId}</code>`;

    await bot.api.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: "HTML" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("order error", err);
    return res.status(500).json({ detail: "Ошибка отправки заявки" });
  }
});

function mainKeyboard() {
  return new Keyboard()
    .webApp("📱 Открыть витрину", WEBAPP_URL)
    .row()
    .text("❓ FAQ")
    .text("👑 Менеджер")
    .row()
    .text("📍 Адрес и контакты")
    .resized();
}

function managerKeyboard() {
  return new InlineKeyboard().url("Написать менеджеру", `https://t.me/${MANAGER_USERNAME}`);
}

function catalogKeyboard() {
  return new InlineKeyboard().webApp("Открыть витрину", WEBAPP_URL);
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    `👑 Добро пожаловать в <b>${SHOP_NAME}</b>!\n\n` +
      `Откройте витрину: выберите модель, цвет и память — и оставьте заявку за минуту.\n\n` +
      `Рассрочка и лизинг · доставка по РБ · гарантия`,
    { parse_mode: "HTML", reply_markup: mainKeyboard() }
  );
  await ctx.reply("Витрина с цветами и конфигурациями:", { reply_markup: catalogKeyboard() });
});

bot.command("menu", async (ctx) => {
  await ctx.reply("Нажмите кнопку ниже, чтобы открыть витрину:", { reply_markup: catalogKeyboard() });
});

bot.hears("❓ FAQ", async (ctx) => {
  const text =
    `<b>Частые вопросы</b>\n\n` +
    `<b>Это оригинал?</b>\nДа. Новая техника в заводской упаковке.\n\n` +
    `<b>Какая гарантия?</b>\n12 месяцев + сервис до 24–36 месяцев.\n\n` +
    `<b>Есть доставка?</b>\nБесплатно по Минску и всей Беларуси.\n\n` +
    `<b>Рассрочка и лизинг?</b>\nОдобряем почти всем. Сбер, Альфа, МТБанк.\n\n` +
    `<b>Где вы?</b>\n${SHOP_ADDRESS}\n📞 ${MANAGER_PHONE} · @${MANAGER_USERNAME}`;
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: managerKeyboard() });
});

bot.hears("📍 Адрес и контакты", async (ctx) => {
  await ctx.reply(
    `<b>${SHOP_NAME}</b>\n\n📍 ${SHOP_ADDRESS}\n📞 ${MANAGER_PHONE}\n📲 @${MANAGER_USERNAME}\n\n` +
      `Бесплатная доставка по Минску и всей Беларуси.`,
    { parse_mode: "HTML", reply_markup: managerKeyboard() }
  );
});

bot.hears("👑 Менеджер", async (ctx) => {
  await ctx.reply("Нужен живой ответ? Напишите менеджеру.", { reply_markup: managerKeyboard() });
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`${SHOP_NAME} HTTP on 0.0.0.0:${PORT} public URL: ${WEBAPP_URL}`);
  console.log(`PORT=${process.env.PORT || ""} DOMAIN=${DOMAIN}`);
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    bot.start({
      onStart: (info) => console.log(`Bot @${info.username} started (polling)`),
    });
  } catch (err) {
    console.error("Bot start failed", err);
    process.exit(1);
  }
});
