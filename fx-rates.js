/**
 * NBRB FX: base prices in foreign currency → BYN via official rate.
 * Hourly refresh in the HTTP process.
 */
const fs = require("fs");
const path = require("path");

const FX_FILE = path.join(__dirname, "data", "fx-settings.json");
const NBRB_URL = "https://api.nbrb.by/exrates/rates";
const HOUR_MS = 60 * 60 * 1000;

function catalogAdmin() {
  return require("./catalog-admin");
}

const DEFAULTS = {
  enabled: false,
  currency: "USD",
  markup_percent: 0,
  round_to: 1,
  rate: null,
  rate_scale: 1,
  rate_date: null,
  updated_at: null,
  last_error: null,
};

let timer = null;

function readFx() {
  try {
    if (!fs.existsSync(FX_FILE)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(FX_FILE, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function writeFx(settings) {
  const dir = path.dirname(FX_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FX_FILE, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return settings;
}

function getFxPublic(settings = readFx()) {
  return {
    enabled: Boolean(settings.enabled),
    currency: settings.currency || "USD",
    markup_percent: Number(settings.markup_percent) || 0,
    round_to: Number(settings.round_to) || 1,
    rate: settings.rate,
    rate_scale: settings.rate_scale || 1,
    rate_date: settings.rate_date,
    updated_at: settings.updated_at,
    last_error: settings.last_error || null,
    byn_per_unit:
      settings.rate != null && settings.rate_scale
        ? Number(settings.rate) / Number(settings.rate_scale)
        : null,
  };
}

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

/** Ensure every config has price_fx; seed from BYN using current rate if missing. */
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

function applyRateToCatalog(settings, rateInfo) {
  const ca = catalogAdmin();
  const { data } = ca.loadRawCatalog();
  const rate = rateInfo.rate;
  const scale = rateInfo.scale;
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

async function refreshFx({ forceSeed = false } = {}) {
  const settings = readFx();
  if (!settings.enabled && !forceSeed) {
    return { ok: true, skipped: true, fx: getFxPublic(settings) };
  }
  try {
    const rateInfo = await fetchNbrbRate(settings.currency);
    const next = {
      ...settings,
      rate: rateInfo.rate,
      rate_scale: rateInfo.scale,
      rate_date: rateInfo.date,
      currency: rateInfo.currency || settings.currency,
      updated_at: new Date().toISOString(),
      last_error: null,
    };
    const result = applyRateToCatalog(next, rateInfo);
    writeFx(next);
    console.log(
      `FX NBRB ${next.currency}=${next.rate}/${next.rate_scale} markup=${next.markup_percent}% configs≈${result.configs}`
    );
    return { ok: true, fx: getFxPublic(next), ...result };
  } catch (err) {
    const failed = {
      ...settings,
      last_error: String(err.message || err),
      updated_at: settings.updated_at,
    };
    writeFx(failed);
    console.error("FX refresh failed", err.message || err);
    throw err;
  }
}

async function updateFxSettings(patch = {}) {
  const cur = readFx();
  const next = { ...cur };

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

  writeFx(next);

  if (next.enabled) {
    // On enable or currency change: seed missing price_fx then recalculate BYN
    return refreshFx({ forceSeed: true });
  }
  return { ok: true, fx: getFxPublic(next), disabled: true };
}

/** Recalculate one config after price_fx edit (uses stored rate). */
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
  if (timer) clearInterval(timer);
  const boot = async () => {
    const s = readFx();
    if (!s.enabled) {
      console.log("FX scheduler idle (disabled)");
      return;
    }
    try {
      await refreshFx();
    } catch (_) {
      /* logged */
    }
  };
  boot();
  timer = setInterval(() => {
    const s = readFx();
    if (!s.enabled) return;
    refreshFx().catch(() => {});
  }, HOUR_MS);
  if (timer.unref) timer.unref();
  console.log("FX scheduler: every 1h (NBRB)");
}

function stopFxScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

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
