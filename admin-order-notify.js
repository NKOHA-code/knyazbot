/**
 * Build HTML text + inline keyboard for admin order notifications.
 */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function telHref(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits.replace(/^\+/, "")}`;
}

/**
 * @param {object} order
 * @param {object} opts
 * @param {string} [opts.shopName]
 * @param {string} [opts.adminUrl]
 * @returns {{ text: string, reply_markup: { inline_keyboard: object[][] } }}
 */
function buildAdminOrderNotify(order, opts = {}) {
  const shopName = opts.shopName || "КнязьMobile";
  const adminUrl = (opts.adminUrl || "").replace(/\/$/, "");
  const idPart = order.orderId ? ` #${order.orderId}` : "";
  const phone = String(order.phone || "").trim();
  const tel = telHref(phone);
  const phoneHtml = tel
    ? `<a href="tel:${escapeHtml(tel)}">${escapeHtml(phone)}</a>`
    : escapeHtml(phone || "—");

  const username = order.username ? String(order.username).replace(/^@/, "") : "";
  const fullName = escapeHtml(order.fullName || "Клиент");
  const userId = order.userId && String(order.userId) !== "0" ? String(order.userId) : "";
  const clientLine = username
    ? `Клиент: ${fullName} · <a href="https://t.me/${escapeHtml(username)}">@${escapeHtml(username)}</a>`
    : `Клиент: ${fullName} · без username`;
  const idHtml = userId
    ? `<a href="tg://user?id=${escapeHtml(userId)}"><code>${escapeHtml(userId)}</code></a>`
    : `<code>—</code>`;

  const text =
    `<b>Новая заявка${idPart}</b> · ${escapeHtml(shopName)}\n\n` +
    `📱 Товар: <b>${escapeHtml(order.productName || "")}</b>\n` +
    `🎨 Цвет: ${escapeHtml(order.colorName || "")}\n` +
    `💾 Память: ${escapeHtml(order.storage || "")}\n` +
    (order.simType ? `📶 SIM: ${escapeHtml(order.simType)}\n` : "") +
    `💰 Цена: ${escapeHtml(order.priceText || "")}\n` +
    `💳 Оплата: <b>${escapeHtml(order.payment || "не указана")}</b>\n` +
    `📞 Телефон: ${phoneHtml}\n\n` +
    `👤 ${clientLine}\n` +
    `🆔 ID: ${idHtml}`;

  const row = [];
  if (username) {
    row.push({ text: "Написать", url: `https://t.me/${username}` });
  } else if (userId) {
    row.push({ text: "Написать", url: `tg://user?id=${userId}` });
  }
  // Admin link only when explicitly requested (owner chat) — do not leak ADMIN_PATH to everyone
  if (opts.includeAdminButton && adminUrl) {
    row.push({ text: "Открыть админку", url: `${adminUrl}/app` });
  }
  const reply_markup = row.length ? { inline_keyboard: [row] } : { inline_keyboard: [] };

  return { text, reply_markup };
}

function adminPanelBaseUrl(publicBase, adminPath) {
  const base = String(publicBase || "").replace(/\/$/, "");
  const ap = String(adminPath || "").trim().replace(/^\/+|\/+$/g, "");
  if (!base || !ap) return "";
  return `${base}/a/${ap}`;
}

module.exports = {
  escapeHtml,
  buildAdminOrderNotify,
  adminPanelBaseUrl,
};
