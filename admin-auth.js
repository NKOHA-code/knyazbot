/**
 * Admin extras: password override, action log.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const PASSWORD_FILE = path.join(DATA_DIR, "admin-password.json");
const ACTIONS_FILE = path.join(DATA_DIR, "admin-actions.jsonl");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const check = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(String(hash), "hex");
    if (check.length !== expected.length) return false;
    return crypto.timingSafeEqual(check, expected);
  } catch (_) {
    return false;
  }
}

function loadPasswordOverride() {
  try {
    if (!fs.existsSync(PASSWORD_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(PASSWORD_FILE, "utf8"));
    if (raw?.salt && raw?.hash) return raw;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function setAdminPassword(newPassword) {
  const pwd = String(newPassword || "");
  if (pwd.length < 8) throw new Error("Пароль не короче 8 символов");
  ensureDataDir();
  const packed = hashPassword(pwd);
  fs.writeFileSync(PASSWORD_FILE, JSON.stringify({ ...packed, updated_at: new Date().toISOString() }, null, 2));
  return true;
}

function checkAdminPassword(input, envPassword) {
  const override = loadPasswordOverride();
  if (override) return verifyPassword(input, override.salt, override.hash);
  const a = Buffer.from(String(input));
  const b = Buffer.from(String(envPassword || ""));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(a.length), Buffer.alloc(a.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function logAction(entry) {
  try {
    ensureDataDir();
    const row = {
      at: new Date().toISOString(),
      actor: entry.actor || "admin",
      action: entry.action || "unknown",
      detail: entry.detail || "",
      meta: entry.meta || null,
    };
    fs.appendFileSync(ACTIONS_FILE, JSON.stringify(row) + "\n", "utf8");
  } catch (err) {
    console.error("logAction", err.message);
  }
}

function listActions(limit = 100) {
  try {
    if (!fs.existsSync(ACTIONS_FILE)) return [];
    const text = fs.readFileSync(ACTIONS_FILE, "utf8").trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return lines
      .slice(-n)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (_) {
    return [];
  }
}

module.exports = {
  checkAdminPassword,
  setAdminPassword,
  loadPasswordOverride,
  logAction,
  listActions,
};
