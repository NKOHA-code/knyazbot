const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

/** Seed in git (reset on Update from Git). Live catalog lives in data/ (Bothost persists /app/data). */
const SEED_CATALOG = path.join(__dirname, "catalog", "catalog.json");
const DATA_CATALOG = path.join(__dirname, "data", "catalog.json");
const LEGACY_PUBLIC_CATALOG = path.join(__dirname, "public", "catalog.json");
const UPLOADS_DIR = path.join(__dirname, "data", "uploads");
const LEGACY_UPLOADS_DIR = path.join(__dirname, "public", "images", "uploads");

const MANAGERS_FILE = path.join(__dirname, "data", "managers.json");

function ensureDataDir() {
  const dir = path.join(__dirname, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/** Prefer persistent data/catalog.json; seed once from git catalog if missing. */
function ensureCatalogFile() {
  ensureDataDir();
  if (fs.existsSync(DATA_CATALOG)) return DATA_CATALOG;

  // One-time migrate from legacy locations (before git wipe preferred catalog/)
  const legacy = [LEGACY_PUBLIC_CATALOG, SEED_CATALOG].find((p) => fs.existsSync(p));
  if (legacy) {
    fs.copyFileSync(legacy, DATA_CATALOG);
    console.log("catalog seeded to data/catalog.json from", path.relative(__dirname, legacy));
    return DATA_CATALOG;
  }
  throw new Error("catalog.json not found (need catalog/catalog.json seed)");
}

function catalogPath() {
  return ensureCatalogFile();
}

function migrateLegacyUploads() {
  try {
    if (!fs.existsSync(LEGACY_UPLOADS_DIR)) return;
    ensureDataDir();
    for (const name of fs.readdirSync(LEGACY_UPLOADS_DIR)) {
      if (name === ".gitkeep") continue;
      const from = path.join(LEGACY_UPLOADS_DIR, name);
      const to = path.join(UPLOADS_DIR, name);
      if (fs.statSync(from).isFile() && !fs.existsSync(to)) {
        fs.copyFileSync(from, to);
      }
    }
  } catch (err) {
    console.error("upload migrate", err.message);
  }
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
  return { file, data: readJsonFile(file) };
}

/** Persist only to data/ — survives Bothost Update from Git. */
function saveCatalog(data) {
  ensureDataDir();
  writeJsonNoBom(DATA_CATALOG, data);
  return data;
}

function getCatalog() {
  migrateLegacyUploads();
  const data = loadRawCatalog().data;
  data.products = (data.products || [])
    .map((p, i) => ({
      ...p,
      hidden: Boolean(p.hidden),
      sort_order: Number.isFinite(Number(p.sort_order)) ? Number(p.sort_order) : i,
    }))
    .sort((a, b) => a.sort_order - b.sort_order || String(a.name).localeCompare(String(b.name), "ru"));
  try {
    data.fx = require("./fx-rates").getFxPublic();
  } catch (_) {
    data.fx = null;
  }
  return data;
}

function upsertProduct(product) {
  const { data } = loadRawCatalog();
  if (!product || !product.id) throw new Error("product.id required");
  const idx = data.products.findIndex((p) => p.id === product.id);
  if (idx >= 0) data.products[idx] = { ...data.products[idx], ...product };
  else {
    const maxSort = data.products.reduce((m, p) => Math.max(m, Number(p.sort_order) || 0), 0);
    data.products.push({ ...product, sort_order: product.sort_order ?? maxSort + 1, hidden: Boolean(product.hidden) });
  }
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
  if (patch.storage !== undefined) cfg.storage = String(patch.storage);
  if (patch.in_stock !== undefined) cfg.in_stock = Boolean(patch.in_stock);

  let fx;
  try {
    fx = require("./fx-rates");
  } catch (_) {
    fx = null;
  }
  const settings = fx ? fx.readFx() : { enabled: false };

  if (patch.price_fx !== undefined) {
    cfg.price_fx = Math.round(Number(patch.price_fx) * 100) / 100 || 0;
    if (settings.enabled && settings.rate != null) {
      fx.recalcConfigPrice(cfg, settings);
    }
  } else if (patch.price !== undefined) {
    cfg.price = Number(patch.price) || 0;
    if (settings.enabled && settings.rate != null) {
      cfg.price_fx = fx.fxFromByn(cfg.price, settings.rate, settings.rate_scale || 1);
    }
  }

  saveCatalog(data);
  return product;
}

function storageToId(storage) {
  const m = String(storage || "").match(/(\d+)/);
  return m ? m[1] : slugifyId(storage) || `cfg-${Date.now()}`;
}

function addConfig(productId, { storage, price, price_fx, in_stock } = {}) {
  const { data } = loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("product not found");
  const stor = String(storage || "").trim();
  if (!stor) throw new Error("Укажи память, например 512GB");
  if (!product.configs) product.configs = [];
  let id = storageToId(stor);
  if (product.configs.some((c) => c.id === id || c.storage === stor)) {
    throw new Error("Такой конфиг уже есть");
  }

  let fx;
  try {
    fx = require("./fx-rates");
  } catch (_) {
    fx = null;
  }
  const settings = fx ? fx.readFx() : { enabled: false };
  const cfg = {
    id,
    storage: stor,
    price: Number(price) || 0,
    in_stock: in_stock === undefined ? true : Boolean(in_stock),
  };
  if (price_fx !== undefined) {
    cfg.price_fx = Math.round(Number(price_fx) * 100) / 100 || 0;
    if (settings.enabled && settings.rate != null) fx.recalcConfigPrice(cfg, settings);
  } else if (settings.enabled && settings.rate != null) {
    cfg.price_fx = fx.fxFromByn(cfg.price, settings.rate, settings.rate_scale || 1);
  }
  product.configs.push(cfg);
  saveCatalog(data);
  return product;
}

function deleteConfig(productId, configId) {
  const { data } = loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("product not found");
  const before = (product.configs || []).length;
  product.configs = (product.configs || []).filter((c) => c.id !== configId);
  if (product.configs.length === before) return false;
  if (!product.configs.length) {
    throw new Error("Нужен хотя бы один конфиг");
  }
  saveCatalog(data);
  return true;
}

function addColor(productId, { id, name, hex } = {}) {
  const { data } = loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("product not found");
  const colorName = String(name || "").trim();
  if (!colorName) throw new Error("Укажи название цвета");
  let colorId = slugifyId(id || colorName);
  if (!colorId) colorId = `c-${Date.now()}`;
  if (!product.colors) product.colors = [];
  if (product.colors.some((c) => c.id === colorId)) throw new Error("Такой цвет уже есть");
  product.colors.push({
    id: colorId,
    name: colorName,
    hex: String(hex || "#888888").trim() || "#888888",
    image: null,
  });
  saveCatalog(data);
  return product;
}

function deleteColor(productId, colorId) {
  const { data } = loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("product not found");
  const before = (product.colors || []).length;
  product.colors = (product.colors || []).filter((c) => c.id !== colorId);
  if (product.colors.length === before) return false;
  if (!product.colors.length) throw new Error("Нужен хотя бы один цвет");
  if (product.image && !product.colors.some((c) => c.image === product.image)) {
    product.image = product.colors.find((c) => c.image)?.image || null;
  }
  saveCatalog(data);
  return true;
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

function detectImageExt(buffer, filenameHint = "upload.png") {
  if (buffer && buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return ".png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return ".gif";
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return ".bmp";
    if (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return ".webp";
    }
    // ISO BMFF (HEIC/AVIF): ....ftyp....
    if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
      const brand = buffer.toString("ascii", 8, 12).toLowerCase();
      if (brand.startsWith("heic") || brand.startsWith("heif") || brand === "mif1" || brand === "msf1") {
        throw new Error("HEIC с iPhone не подходит — сохрани как JPG или PNG");
      }
      if (brand.startsWith("avif") || brand === "avis") return ".avif";
    }
  }
  const ext = path.extname(filenameHint).toLowerCase() || ".png";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".jfif"].includes(ext)) {
    if (ext === ".jpeg" || ext === ".jfif") return ".jpg";
    return ext;
  }
  return ".png";
}

function saveUploadedImage(buffer, filenameHint = "upload.png") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new Error("Пустой или повреждённый файл");
  }
  const safeExt = detectImageExt(buffer, filenameHint);
  const name = `up-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`;
  ensureDataDir();
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
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
  const byId = new Map();

  const add = (telegramId, name) => {
    const id = Number(telegramId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!byId.has(id)) {
      byId.set(id, {
        telegram_id: id,
        name: String(name || "").trim() || (id === Number(process.env.ADMIN_CHAT_ID || 0) ? "Владелец" : `Менеджер ${id}`),
      });
    }
  };

  // 1) ENV — всегда (Bothost ADMIN_USER_IDS)
  for (const m of defaultManagers()) add(m.telegram_id, m.name);

  // 2) файл data/managers.json — имена/доп. люди из админки
  try {
    if (fs.existsSync(MANAGERS_FILE)) {
      const data = readJsonFile(MANAGERS_FILE);
      if (Array.isArray(data)) {
        for (const m of data) add(m.telegram_id, m.name);
      }
    }
  } catch (_) {
    /* ignore */
  }

  // 3) владелец на всякий случай
  add(process.env.ADMIN_CHAT_ID, "Владелец");

  const list = [...byId.values()];
  return list.length ? list : defaultManagers();
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

const IMPORT_HEADERS = [
  "id",
  "name",
  "category",
  "category_title",
  "badge",
  "badge_emoji",
  "gift",
  "note",
  "color_id",
  "color_name",
  "color_hex",
  "storage",
  "price",
  "in_stock",
];

function cell(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
      return String(row[k]).trim();
    }
  }
  return "";
}

function parseStock(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return true;
  return !["0", "false", "нет", "no", "n", "out", "-" ].includes(s);
}

function storageToConfigId(storage) {
  const m = String(storage || "").match(/(\d+)/);
  return m ? m[1] : slugifyId(storage) || "cfg";
}

function buildCatalogTemplateBuffer() {
  const example = [
    {
      id: "iphone-17",
      name: "iPhone 17",
      category: "iphone",
      category_title: "iPhone",
      badge: "Хит",
      badge_emoji: "🔥",
      gift: "чехол + защитное стекло",
      note: "Новый оригинал, заводская упаковка",
      color_id: "black",
      color_name: "Black",
      color_hex: "#1c1c1e",
      storage: "256GB",
      price: 2150,
      in_stock: "да",
    },
    {
      id: "iphone-17",
      name: "iPhone 17",
      category: "iphone",
      category_title: "iPhone",
      badge: "Хит",
      badge_emoji: "🔥",
      gift: "чехол + защитное стекло",
      note: "Новый оригинал, заводская упаковка",
      color_id: "black",
      color_name: "Black",
      color_hex: "#1c1c1e",
      storage: "512GB",
      price: 2490,
      in_stock: "да",
    },
    {
      id: "iphone-17",
      name: "iPhone 17",
      category: "iphone",
      category_title: "iPhone",
      badge: "Хит",
      badge_emoji: "🔥",
      gift: "чехол + защитное стекло",
      note: "Новый оригинал, заводская упаковка",
      color_id: "white",
      color_name: "White",
      color_hex: "#f2f2f7",
      storage: "256GB",
      price: 2150,
      in_stock: "да",
    },
  ];
  const help = [
    {
      id: "← id товара (латиница)",
      name: "Название на витрине",
      category: "id категории",
      category_title: "если категории нет — создастся",
      badge: "Хит / Новинка / пусто",
      badge_emoji: "🔥 / ✨ / пусто",
      gift: "подзаголовок",
      note: "заметка",
      color_id: "black",
      color_name: "Black",
      color_hex: "#1c1c1e",
      storage: "256GB",
      price: 0,
      in_stock: "да / нет",
    },
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([...example, ...help], { header: IMPORT_HEADERS });
  ws["!cols"] = IMPORT_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "catalog");
  const noteRows = [
    ["Как заполнять"],
    ["1. Одна строка = одна комбинация цвет + память."],
    ["2. Один и тот же id товара повторяй в нескольких строках для цветов и конфигов."],
    ["3. category — латиницей (iphone). category_title — название на русском/как на витрине."],
    ["4. in_stock: да / нет (или 1 / 0)."],
    ["5. badge_emoji — смайлик рядом с бейджем (🔥, ✨, 💎…)."],
    ["6. Фото после импорта загрузи в карточке товара (цвета сохранят старые фото, если id цвета совпал)."],
    ["7. Строку-подсказку внизу шаблона перед импортом можно удалить."],
  ];
  const wsHelp = XLSX.utils.aoa_to_sheet(noteRows);
  wsHelp["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsHelp, "инструкция");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function importCatalogFromExcel(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => String(n).toLowerCase() === "catalog") || wb.SheetNames[0];
  if (!sheetName) throw new Error("В файле нет листа");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  if (!rows.length) throw new Error("Пустой файл — нет строк данных");

  const { data } = loadRawCatalog();
  if (!data.categories) data.categories = [];
  if (!data.products) data.products = [];

  const productsMap = new Map();
  let skipped = 0;

  for (const row of rows) {
    const id = slugifyId(cell(row, "id", "product_id", "ID"));
    const name = cell(row, "name", "название", "Name");
    if (!id || !name) {
      skipped += 1;
      continue;
    }
    if (id.startsWith("←") || name.toLowerCase().includes("название на витрине")) {
      skipped += 1;
      continue;
    }

    let category = slugifyId(cell(row, "category", "категория"));
    const categoryTitle = cell(row, "category_title", "category_name", "категория_название") || category;
    if (!category && categoryTitle) category = slugifyId(categoryTitle);
    if (!category) throw new Error(`У товара ${id} не указана категория`);

    if (!data.categories.some((c) => c.id === category)) {
      data.categories.push({
        id: category,
        title: categoryTitle || category,
        emoji: "✦",
      });
    }

    if (!productsMap.has(id)) {
      const existing = data.products.find((p) => p.id === id);
      productsMap.set(id, {
        id,
        category,
        name,
        badge: cell(row, "badge", "бейдж") || null,
        badge_emoji: cell(row, "badge_emoji", "emoji", "смайлик") || null,
        gift: cell(row, "gift", "подарок") || null,
        note: cell(row, "note", "заметка") || null,
        colors: existing ? [...(existing.colors || [])] : [],
        configs: existing ? [...(existing.configs || [])] : [],
        image: existing?.image || null,
      });
    }

    const product = productsMap.get(id);
    product.name = name;
    product.category = category;
    const badge = cell(row, "badge", "бейдж");
    const badgeEmoji = cell(row, "badge_emoji", "emoji", "смайлик");
    const gift = cell(row, "gift", "подарок");
    const note = cell(row, "note", "заметка");
    if (badge !== "") product.badge = badge || null;
    if (badgeEmoji !== "") product.badge_emoji = badgeEmoji || null;
    if (gift !== "") product.gift = gift || null;
    if (note !== "") product.note = note || null;

    const colorName = cell(row, "color_name", "цвет", "color");
    const colorId = slugifyId(cell(row, "color_id", "цвет_id") || colorName) || "default";
    const colorHex = cell(row, "color_hex", "hex") || "#888888";
    if (colorName || cell(row, "color_id")) {
      const cIdx = product.colors.findIndex((c) => c.id === colorId);
      const prev = cIdx >= 0 ? product.colors[cIdx] : null;
      const colorRow = {
        id: colorId,
        name: colorName || prev?.name || colorId,
        hex: colorHex || prev?.hex || "#888888",
        image: prev?.image || null,
      };
      if (cIdx >= 0) product.colors[cIdx] = colorRow;
      else product.colors.push(colorRow);
    }

    const storage = cell(row, "storage", "память", "config");
    if (storage) {
      const cfgId = storageToConfigId(storage);
      const price = Number(cell(row, "price", "цена")) || 0;
      const inStock = parseStock(cell(row, "in_stock", "наличие", "stock"));
      const cfgIdx = product.configs.findIndex((c) => c.id === cfgId || c.storage === storage);
      const cfgRow = { id: cfgId, storage, price, in_stock: inStock };
      if (cfgIdx >= 0) product.configs[cfgIdx] = cfgRow;
      else product.configs.push(cfgRow);
    }
  }

  if (!productsMap.size) throw new Error("Не найдено ни одной валидной строки товара");

  let created = 0;
  let updated = 0;
  for (const product of productsMap.values()) {
    if (!product.colors.length) {
      product.colors = [{ id: "default", name: "Default", hex: "#888888", image: null }];
    }
    if (!product.configs.length) {
      product.configs = [{ id: "256", storage: "256GB", price: 0, in_stock: true }];
    }
    if (!product.image) product.image = product.colors.find((c) => c.image)?.image || null;

    const idx = data.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) {
      data.products[idx] = product;
      updated += 1;
    } else {
      data.products.push(product);
      created += 1;
    }
  }

  saveCatalog(data);
  return {
    ok: true,
    created,
    updated,
    skipped,
    products: productsMap.size,
    categories: data.categories.length,
  };
}

function duplicateProduct(productId) {
  const { data } = loadRawCatalog();
  const src = data.products.find((p) => p.id === productId);
  if (!src) throw new Error("Товар не найден");
  let base = `${src.id}-copy`;
  let n = 1;
  let id = base;
  while (data.products.some((p) => p.id === id)) {
    n += 1;
    id = `${base}${n}`;
  }
  const maxSort = data.products.reduce((m, p) => Math.max(m, Number(p.sort_order) || 0), 0);
  const copy = {
    ...JSON.parse(JSON.stringify(src)),
    id,
    name: `${src.name} (копия)`,
    sort_order: maxSort + 1,
    hidden: true,
  };
  data.products.push(copy);
  saveCatalog(data);
  return copy;
}

function setProductHidden(productId, hidden) {
  const { data } = loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("Товар не найден");
  product.hidden = Boolean(hidden);
  saveCatalog(data);
  return product;
}

function moveProduct(productId, direction) {
  const { data } = loadRawCatalog();
  const products = [...data.products].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.name).localeCompare(String(b.name), "ru")
  );
  products.forEach((p, i) => {
    p.sort_order = i;
  });
  const idx = products.findIndex((p) => p.id === productId);
  if (idx < 0) throw new Error("Товар не найден");
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith >= 0 && swapWith < products.length) {
    const tmp = products[idx];
    products[idx] = products[swapWith];
    products[swapWith] = tmp;
    products.forEach((p, i) => {
      p.sort_order = i;
    });
  }
  data.products = products;
  saveCatalog(data);
  return products.find((p) => p.id === productId);
}

function bulkAdjustPrices({ mode, value, category, product_ids } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Некорректное значение");
  const { data } = loadRawCatalog();
  let ids = null;
  if (Array.isArray(product_ids) && product_ids.length) {
    ids = new Set(product_ids.map(String));
  }
  let touched = 0;
  for (const p of data.products || []) {
    if (ids && !ids.has(p.id)) continue;
    if (category && p.category !== category) continue;
    for (const cfg of p.configs || []) {
      let price = Number(cfg.price) || 0;
      if (mode === "percent") price = Math.round(price * (1 + amount / 100));
      else if (mode === "add") price = Math.round(price + amount);
      else if (mode === "set") price = Math.round(amount);
      else throw new Error("mode: percent | add | set");
      cfg.price = Math.max(0, price);
    }
    touched += 1;
  }
  saveCatalog(data);
  return { ok: true, products: touched };
}

function buildCatalogExportBuffer() {
  const data = getCatalog();
  const rows = [];
  for (const p of data.products || []) {
    const colors = p.colors?.length ? p.colors : [{ id: "", name: "", hex: "" }];
    const configs = p.configs?.length ? p.configs : [{ storage: "", price: 0, in_stock: true }];
    for (const color of colors) {
      for (const cfg of configs) {
        rows.push({
          id: p.id,
          name: p.name,
          category: p.category,
          category_title: (data.categories || []).find((c) => c.id === p.category)?.title || p.category,
          badge: p.badge || "",
          badge_emoji: p.badge_emoji || "",
          gift: p.gift || "",
          note: p.note || "",
          color_id: color.id || "",
          color_name: color.name || "",
          color_hex: color.hex || "",
          storage: cfg.storage || "",
          price: cfg.price || 0,
          in_stock: cfg.in_stock ? "да" : "нет",
          hidden: p.hidden ? "да" : "нет",
          sort_order: p.sort_order ?? 0,
        });
      }
    }
  }
  const wb = XLSX.utils.book_new();
  const headers = [
    ...IMPORT_HEADERS,
    "hidden",
    "sort_order",
  ];
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ id: "", name: "" }], { header: headers });
  XLSX.utils.book_append_sheet(wb, ws, "catalog");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const PRICE_HEADERS = ["product_id", "name", "storage", "price", "price_fx", "in_stock"];

/** Daily price list: one row per product + storage (no colors). */
function buildPricesExportBuffer() {
  const data = getCatalog();
  const fx = data.fx || {};
  const rows = [];
  for (const p of data.products || []) {
    for (const cfg of p.configs || []) {
      rows.push({
        product_id: p.id,
        name: p.name,
        storage: cfg.storage || "",
        price: cfg.price || 0,
        price_fx: cfg.price_fx != null ? cfg.price_fx : "",
        in_stock: cfg.in_stock ? "да" : "нет",
      });
    }
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ product_id: "", storage: "", price: 0 }], {
    header: PRICE_HEADERS,
  });
  ws["!cols"] = PRICE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "prices");
  const notes = [
    ["Ежедневный прайс (только цены)"],
    ["1. Меняй колонку price (BYN на витрине)."],
    ["2. Если включён курс НБРБ — можно править price_fx (USD/EUR), тогда BYN пересчитается."],
    ["3. Не меняй product_id и storage — по ним ищется конфиг."],
    ["4. Новые товары этим файлом не создаются — только обновление цен."],
    [`5. Сейчас FX: ${fx.enabled ? "вкл " + (fx.currency || "USD") : "выкл"}.`],
  ];
  const wsHelp = XLSX.utils.aoa_to_sheet(notes);
  wsHelp["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsHelp, "инструкция");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function buildPricesTemplateBuffer() {
  return buildPricesExportBuffer();
}

function findConfigByStorage(product, storageRaw) {
  const storage = String(storageRaw || "").trim();
  if (!storage) return null;
  const configs = product.configs || [];
  let cfg = configs.find((c) => String(c.storage || "").trim().toLowerCase() === storage.toLowerCase());
  if (cfg) return cfg;
  const idHint = storageToConfigId(storage);
  cfg = configs.find((c) => String(c.id) === idHint);
  if (cfg) return cfg;
  const digits = (storage.match(/(\d+)/) || [])[1];
  if (digits) {
    cfg = configs.find((c) => String(c.storage || "").includes(digits) || String(c.id) === digits);
  }
  return cfg || null;
}

function importPricesOnly(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName =
    wb.SheetNames.find((n) => ["prices", "price", "цены", "прайс"].includes(String(n).toLowerCase())) ||
    wb.SheetNames[0];
  if (!sheetName) throw new Error("В файле нет листа");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  if (!rows.length) throw new Error("Пустой файл — нет строк");

  let fxMod = null;
  let fxSettings = { enabled: false };
  try {
    fxMod = require("./fx-rates");
    fxSettings = fxMod.readFx();
  } catch (_) {
    /* optional */
  }

  const { data } = loadRawCatalog();
  const byId = new Map((data.products || []).map((p) => [p.id, p]));
  let updated = 0;
  const missing = [];

  for (const row of rows) {
    const productId = slugifyId(cell(row, "product_id", "id", "ID"));
    const storage = cell(row, "storage", "память", "config", "конфиг");
    if (!productId || !storage) continue;
    if (productId.startsWith("←")) continue;

    const product = byId.get(productId);
    if (!product) {
      missing.push(`${productId} / ${storage}`);
      continue;
    }
    const cfg = findConfigByStorage(product, storage);
    if (!cfg) {
      missing.push(`${productId} / ${storage}`);
      continue;
    }

    const priceRaw = cell(row, "price", "цена", "price_byn");
    const fxRaw = cell(row, "price_fx", "usd", "eur", "цена_fx", "base_price");
    const stockRaw = cell(row, "in_stock", "наличие", "stock");

    let touched = false;
    if (fxRaw !== "") {
      const fxVal = Number(String(fxRaw).replace(",", "."));
      if (Number.isFinite(fxVal)) {
        cfg.price_fx = Math.round(fxVal * 100) / 100;
        if (fxSettings.enabled && fxSettings.rate != null && fxMod) {
          fxMod.recalcConfigPrice(cfg, fxSettings);
        }
        touched = true;
      }
    } else if (priceRaw !== "") {
      const byn = Number(String(priceRaw).replace(",", "."));
      if (Number.isFinite(byn)) {
        cfg.price = Math.max(0, Math.round(byn));
        if (fxSettings.enabled && fxSettings.rate != null && fxMod) {
          cfg.price_fx = fxMod.fxFromByn(cfg.price, fxSettings.rate, fxSettings.rate_scale || 1);
        }
        touched = true;
      }
    }

    if (stockRaw !== "") {
      cfg.in_stock = parseStock(stockRaw);
      touched = true;
    }

    if (touched) {
      updated += 1;
      const priced = (product.configs || []).map((c) => c.price).filter((n) => n > 0);
      if (priced.length) {
        const min = Math.min(...priced);
        product.min_price = min;
        product.price_from = `от ${min} BYN`;
      }
    }
  }

  saveCatalog(data);
  return {
    ok: true,
    updated,
    missing: missing.slice(0, 30),
    missing_total: missing.length,
  };
}

module.exports = {
  getCatalog,
  saveCatalog,
  loadRawCatalog,
  upsertProduct,
  deleteProduct,
  upsertCategory,
  deleteCategory,
  patchConfig,
  addConfig,
  deleteConfig,
  patchColor,
  addColor,
  deleteColor,
  saveUploadedImage,
  buildCatalogTemplateBuffer,
  buildCatalogExportBuffer,
  buildPricesExportBuffer,
  buildPricesTemplateBuffer,
  importCatalogFromExcel,
  importPricesOnly,
  duplicateProduct,
  setProductHidden,
  moveProduct,
  bulkAdjustPrices,
  loadManagers,
  saveManagers,
  isAllowedAdminId,
  defaultManagers,
};
