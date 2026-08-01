/**
 * Manual FX: base prices in foreign currency → BYN via admin-set rate.
 * Rate is static until you change it in settings.
 */
const fs = require("fs");
const path = require("path");

const FX_FILE = path.join(__dirname, "data", "fx-settings.json");
const NBRB_URL = "https://api.nbrb.by/exrates/rates";

function catalogAdmin() {
  return require("./catalog-admin");
}

const DEFAULTS = {
  enabled: false,
  currency: "USD",
  markup_percent: 0,
  round_to: 1,
  rate: null, // BYN for `rate_scale` units of currency
  rate_scale: 1,
  rate_date: null,
  updated_at: null,
  last_error: null,
  source: "manual",
};

function readFx() {
  try {
    if (!fs.existsSync(FX_FILE)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(FX_FILE, "utf8"));
    return { ...DEFAULTS, ...raw, source: "manual" };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function writeFx(settings) {
  const dir = path.dirname(FX_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = { ...settings, source: "manual" };
  fs.writeFileSync(FX_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

function getFxPublic(settings = readFx()) {
  const scale = Number(settings.rate_scale) || 1;
  const rate = settings.rate != null ? Number(settings.rate) : null;
  return {
    enabled: Boolean(settings.enabled),
    currency: settings.currency || "USD",
    markup_percent: Number(settings.markup_percent) || 0,
    round_to: Number(settings.round_to) || 1,
    rate,
    rate_scale: scale,
    rate_date: settings.rate_date || null,
    updated_at: settings.updated_at,
    last_error: settings.last_error || null,
    source: "manual",
    byn_per_unit: rate != null && scale ? rate / scale : null,
  };
}

/** Optional helper: suggest official NBRB rate (does not auto-apply). */
async function fetchNbrbRate(currency = "USD") {
  const code = String(currency || "USD").toUpperCase();
  const url = `${NBRB_URL}/${encodeURIComponent(code)}?parammode=2`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`НБРБ HTTP ${res.status}`);
  const data = await res.json();
  const rate = Number(data.Cur_OfficialRate);
  const scale = Number(data.Cur_Scale) || 1;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("НБРБ: пустой курс");
  return {
    currency: data.Cur_Abbreviation || code,
    rate,
    scale,
    date: data.Date || null,
    name: data.Cur_Name || code,
  };
}

function bynFromFx(priceFx, rate, scale, markupPercent, roundTo) {
  const fx = Number(priceFx);
  if (!Number.isFinite(fx) || fx <= 0) return 0;
  const perUnit = Number(rate) / (Number(scale) || 1);
  const markup = 1 + (Number(markupPercent) || 0) / 100;
  const raw = fx * perUnit * markup;
  const step = Math.max(1, Number(roundTo) || 1);
  return Math.max(0, Math.round(raw / step) * step);
}

function fxFromByn(priceByn, rate, scale) {
  const byn = Number(priceByn);
  if (!Number.isFinite(byn) || byn <= 0) return 0;
  const perUnit = Number(rate) / (Number(scale) || 1);
  if (!perUnit) return 0;
  return Math.round((byn / perUnit) * 100) / 100;
}

function ensurePriceFx(data, rate, scale) {
  let seeded = 0;
  for (const p of data.products || []) {
    for (const cfg of p.configs || []) {
      if (cfg.price_fx == null || !Number.isFinite(Number(cfg.price_fx))) {
        cfg.price_fx = fxFromByn(cfg.price, rate, scale);
        seeded += 1;
      }
    }
  }
  return seeded;
}

function applyRateToCatalog(settings) {
  const rate = Number(settings.rate);
  const scale = Number(settings.rate_scale) || 1;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Укажите курс (число > 0)");
  }
  const ca = catalogAdmin();
  const { data } = ca.loadRawCatalog();
  ensurePriceFx(data, rate, scale);

  let updated = 0;
  for (const p of data.products || []) {
    for (const cfg of p.configs || []) {
      const next = bynFromFx(
        cfg.price_fx,
        rate,
        scale,
        settings.markup_percent,
        settings.round_to
      );
      if (Number(cfg.price) !== next) {
        cfg.price = next;
        updated += 1;
      } else {
        cfg.price = next;
      }
    }
    const priced = (p.configs || []).map((c) => c.price).filter((n) => n > 0);
    if (priced.length) {
      const min = Math.min(...priced);
      p.min_price = min;
      p.price_from = `от ${min} BYN`;
    }
  }
  ca.saveCatalog(data);
  return { configs: updated };
}

/** Recalculate catalog using the stored manual rate. */
function refreshFx({ forceSeed = false } = {}) {
  const settings = readFx();
  if (!settings.enabled && !forceSeed) {
    return { ok: true, skipped: true, fx: getFxPublic(settings) };
  }
  if (settings.rate == null || !(Number(settings.rate) > 0)) {
    throw new Error("Сначала укажите свой курс и сохраните");
  }
  try {
    const next = {
      ...settings,
      rate_scale: Number(settings.rate_scale) || 1,
      updated_at: new Date().toISOString(),
      last_error: null,
      source: "manual",
    };
    const result = applyRateToCatalog(next);
    writeFx(next);
    console.log(
      `FX manual ${next.currency}=${next.rate}/${next.rate_scale} markup=${next.markup_percent}% configs≈${result.configs}`
    );
    return { ok: true, fx: getFxPublic(next), ...result };
  } catch (err) {
    const failed = {
      ...settings,
      last_error: String(err.message || err),
    };
    writeFx(failed);
    console.error("FX apply failed", err.message || err);
    throw err;
  }
}

function updateFxSettings(patch = {}) {
  const cur = readFx();
  const next = { ...cur, source: "manual" };

  if (patch.currency != null) {
    const c = String(patch.currency).toUpperCase().trim();
    if (!["USD", "EUR", "RUB", "CNY"].includes(c)) {
      throw new Error("Валюта: USD, EUR, RUB или CNY");
    }
    next.currency = c;
  }
  if (patch.markup_percent != null) {
    const m = Number(patch.markup_percent);
    if (!Number.isFinite(m) || m < -50 || m > 200) throw new Error("Наценка: от -50 до 200%");
    next.markup_percent = m;
  }
  if (patch.round_to != null) {
    const r = Number(patch.round_to);
    if (![1, 5, 10].includes(r)) throw new Error("Округление: 1, 5 или 10");
    next.round_to = r;
  }
  if (patch.enabled != null) next.enabled = Boolean(patch.enabled);

  if (patch.rate != null && String(patch.rate).trim() !== "") {
    const rate = Number(String(patch.rate).replace(",", "."));
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Курс должен быть числом > 0");
    next.rate = rate;
  }
  if (patch.rate_scale != null && String(patch.rate_scale).trim() !== "") {
    const scale = Number(patch.rate_scale);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Кратность курса должна быть > 0");
    next.rate_scale = scale;
  } else if (next.currency === "RUB" && (next.rate_scale == null || next.rate_scale === 1)) {
    // keep existing scale; default RUB often 100 — don't force here
  }

  if (!next.rate_scale || next.rate_scale <= 0) next.rate_scale = 1;

  writeFx(next);

  if (next.enabled) {
    if (!(Number(next.rate) > 0)) {
      throw new Error("Чтобы включить привязку, укажите курс");
    }
    return refreshFx({ forceSeed: true });
  }
  return { ok: true, fx: getFxPublic(next), disabled: true };
}

function recalcConfigPrice(cfg, settings = readFx()) {
  if (!settings.enabled || settings.rate == null) return cfg;
  cfg.price = bynFromFx(
    cfg.price_fx != null ? cfg.price_fx : cfg.price,
    settings.rate,
    settings.rate_scale || 1,
    settings.markup_percent,
    settings.round_to
  );
  return cfg;
}

function startFxScheduler() {
  const s = readFx();
  console.log(
    s.enabled
      ? `FX manual mode ON ${s.currency}=${s.rate}/${s.rate_scale || 1}`
      : "FX manual mode idle (disabled)"
  );
}

function stopFxScheduler() {}

module.exports = {
  readFx,
  writeFx,
  getFxPublic,
  fetchNbrbRate,
  refreshFx,
  updateFxSettings,
  bynFromFx,
  fxFromByn,
  recalcConfigPrice,
  startFxScheduler,
  stopFxScheduler,
  ensurePriceFx,
};
