const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CATALOG_CANDIDATES = [
  path.join(__dirname, "catalog", "catalog.json"),
  path.join(__dirname, "public", "catalog.json"),
  path.join(__dirname, "data", "catalog.json"),
];

const MANAGERS_FILE = path.join(__dirname, "data", "managers.json");

function catalogPath() {
  const existing = CATALOG_CANDIDATES.find((p) => fs.existsSync(p));
  return existing || CATALOG_CANDIDATES[0];
}

function readJsonFile(file) {
  let buf = fs.readFileSync(file);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  return JSON.parse(buf.toString("utf8").replace(/^[\uFEFF\u200B]+/, "").trim());
}

function writeJsonNoBom(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(file, text, "utf8");
}

function loadRawCatalog() {
  const file = catalogPath();
  if (!fs.existsSync(file)) throw new Error("catalog.json not found");
  return { file, data: readJsonFile(file) };
}

function syncCatalogCopies(data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  const buf = Buffer.from(text, "utf8");
  for (const p of CATALOG_CANDIDATES) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, buf);
  }
}

function saveCatalog(data) {
  syncCatalogCopies(data);
  return data;
}

function getCatalog() {
  return loadRawCatalog().data;
}

function upsertProduct(product) {
  const { data } = loadRawCatalog();
  if (!product || !product.id) throw new Error("product.id required");
  const idx = data.products.findIndex((p) => p.id === product.id);
  if (idx >= 0) data.products[idx] = { ...data.products[idx], ...product };
  else data.products.push(product);
  saveCatalog(data);
  return data.products.find((p) => p.id === product.id);
}

function deleteProduct(productId) {
  const { data } = loadRawCatalog();
  const before = data.products.length;
  data.products = data.products.filter((p) => p.id !== productId);
  if (data.products.length === before) return false;
  saveCatalog(data);
  return true;
}

function slugifyId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function upsertCategory(category) {
  const { data } = loadRawCatalog();
  if (!data.categories) data.categories = [];
  const title = String(category?.title || "").trim();
  if (!title) throw new Error("Название категории обязательно");
  let id = String(category?.id || "").trim() || slugifyId(title);
  id = slugifyId(id);
  if (!id) throw new Error("Некорректный id категории");
  const emoji = String(category?.emoji || "✦").trim().slice(0, 8) || "✦";
  const idx = data.categories.findIndex((c) => c.id === id);
  const row = { id, title, emoji };
  if (idx >= 0) data.categories[idx] = { ...data.categories[idx], ...row };
  else data.categories.push(row);
  saveCatalog(data);
  return data.categories.find((c) => c.id === id);
}

function deleteCategory(categoryId) {
  const { data } = loadRawCatalog();
  const id = String(categoryId || "");
  const used = (data.products || []).some((p) => p.category === id);
  if (used) throw new Error("Сначала перенеси или удали товары из этой категории");
  const before = (data.categories || []).length;
  data.categories = (data.categories || []).filter((c) => c.id !== id);
  if (data.categories.length === before) return false;
  saveCatalog(data);
  return true;
}

function patchConfig(productId, configId, patch) {
  const { data } = loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("product not found");
  const cfg = (product.configs || []).find((c) => c.id === configId);
  if (!cfg) throw new Error("config not found");
  if (patch.price !== undefined) cfg.price = Number(patch.price) || 0;
  if (patch.in_stock !== undefined) cfg.in_stock = Boolean(patch.in_stock);
  if (patch.storage !== undefined) cfg.storage = String(patch.storage);
  saveCatalog(data);
  return product;
}

function patchColor(productId, colorId, patch) {
  const { data } = loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("product not found");
  const color = (product.colors || []).find((c) => c.id === colorId);
  if (!color) throw new Error("color not found");
  if (patch.name !== undefined) color.name = String(patch.name);
  if (patch.hex !== undefined) color.hex = String(patch.hex);
  if (patch.image !== undefined) color.image = patch.image;
  // keep product.image in sync with first color if needed
  if (product.colors[0]?.id === colorId && color.image) product.image = color.image;
  saveCatalog(data);
  return product;
}

function saveUploadedImage(buffer, filenameHint = "upload.png") {
  const ext = path.extname(filenameHint).toLowerCase() || ".png";
  const safeExt = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext) ? ext : ".png";
  const name = `up-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`;
  const dir = path.join(__dirname, "public", "images", "uploads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buffer);
  return `/images/uploads/${name}`;
}

function defaultManagers() {
  const ids = String(process.env.ADMIN_USER_IDS || process.env.ADMIN_CHAT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.map((id) => ({
    telegram_id: Number(id),
    name: id === String(process.env.ADMIN_CHAT_ID || "") ? "Владелец" : `Менеджер ${id}`,
  }));
}

function loadManagers() {
  try {
    if (fs.existsSync(MANAGERS_FILE)) {
      const data = readJsonFile(MANAGERS_FILE);
      if (Array.isArray(data) && data.length) return data;
    }
  } catch (_) {
    /* ignore */
  }
  return defaultManagers();
}

function saveManagers(list) {
  writeJsonNoBom(MANAGERS_FILE, list);
  return list;
}

function isAllowedAdminId(telegramId) {
  const id = Number(telegramId);
  if (!Number.isFinite(id) || id <= 0) return false;
  return loadManagers().some((m) => Number(m.telegram_id) === id);
}

module.exports = {
  getCatalog,
  saveCatalog,
  upsertProduct,
  deleteProduct,
  upsertCategory,
  deleteCategory,
  patchConfig,
  patchColor,
  saveUploadedImage,
  loadManagers,
  saveManagers,
  isAllowedAdminId,
  defaultManagers,
};
