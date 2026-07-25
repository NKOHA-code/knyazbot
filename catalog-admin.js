const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

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

const IMPORT_HEADERS = [
  "id",
  "name",
  "category",
  "category_title",
  "badge",
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
    ["5. Фото после импорта загрузи в карточке товара (цвета сохранят старые фото, если id цвета совпал)."],
    ["6. Строку-подсказку внизу шаблона перед импортом можно удалить."],
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
    const gift = cell(row, "gift", "подарок");
    const note = cell(row, "note", "заметка");
    if (badge !== "") product.badge = badge || null;
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
  buildCatalogTemplateBuffer,
  importCatalogFromExcel,
  loadManagers,
  saveManagers,
  isAllowedAdminId,
  defaultManagers,
};
