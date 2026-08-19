/**
 * Admin-only: forward/send photo to bot with caption → catalog image.
 */
const catalogAdmin = require("./catalog-admin");

function isPhotoAdmin(telegramId) {
  return catalogAdmin.isAllowedAdminId(telegramId);
}

function findColorByLabel(product, label) {
  const s = String(label || "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  const colors = product.colors || [];
  let hit = colors.find((c) => c.id === catalogAdminSlug(s));
  if (hit) return hit;
  hit = colors.find((c) => String(c.name || "").trim().toLowerCase() === low);
  if (hit) return hit;
  hit = colors.find(
    (c) =>
      String(c.name || "")
        .trim()
        .toLowerCase()
        .includes(low) || low.includes(String(c.name || "").trim().toLowerCase())
  );
  return hit || null;
}

function matchPhotoCaption(caption) {
  const text = String(caption || "").trim();
  if (!text) return null;
  const { data } = catalogAdmin.loadRawCatalog();
  const products = data.products || [];
  const low = text.toLowerCase();

  const byId = products.find((p) => p.id === text || p.id === catalogAdminSlug(text));
  if (byId) return { product: byId, color: null };

  const sorted = [...products].sort(
    (a, b) => String(b.name || "").length - String(a.name || "").length
  );

  for (const product of sorted) {
    const name = String(product.name || "").trim();
    const nameLow = name.toLowerCase();
    if (!name) continue;

    if (low === nameLow) return { product, color: null };

    if (low.startsWith(nameLow + " ") || low.startsWith(nameLow + "-")) {
      const rest = text.slice(name.length).replace(/^[\s-]+/, "");
      const color = findColorByLabel(product, rest);
      if (color) return { product, color };
      if (!rest) return { product, color: null };
    }

    const idLow = String(product.id || "").toLowerCase();
    if (idLow && (low.startsWith(idLow + " ") || low.startsWith(idLow + "-"))) {
      const rest = text.slice(product.id.length).replace(/^[\s-]+/, "");
      const color = findColorByLabel(product, rest);
      if (color) return { product, color };
    }
  }

  return null;
}

function catalogAdminSlug(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function applyPhotoFromBuffer(productId, colorId, buffer, filenameHint = "tg-photo.jpg") {
  const url = catalogAdmin.saveUploadedImage(buffer, filenameHint);
  const { data } = catalogAdmin.loadRawCatalog();
  const product = data.products.find((p) => p.id === productId);
  if (!product) throw new Error("Товар не найден");

  let color = null;
  if (colorId) {
    color = (product.colors || []).find((c) => c.id === colorId);
    if (!color) throw new Error("Цвет не найден");
    color.image = url;
    if (product.colors?.[0]?.id === colorId || !product.image) {
      product.image = url;
    }
  } else {
    product.image = url;
    const target = (product.colors || []).find((c) => !c.image) || product.colors?.[0];
    if (target) target.image = url;
  }

  catalogAdmin.saveCatalog(data);
  return { url, product, color };
}

async function downloadTelegramFile(api, fileId, botToken) {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram не вернул путь к файлу");
  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать файл (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const name = file.file_path.split("/").pop() || "tg-photo.jpg";
  return { buffer, name };
}

function photoHelpText() {
  return (
    `📷 <b>Фото в каталог</b> (только админ)\n\n` +
    `Перешлите или отправьте фото <b>с подписью</b>:\n` +
    `• <code>iPhone 17</code> — главное фото товара\n` +
    `• <code>iphone-17</code> — по ID\n` +
    `• <code>iPhone 17 Black</code> — фото цвета\n\n` +
    `Файл сохранится в каталог на витрине.`
  );
}

async function handleAdminPhotoMessage(ctx, botToken) {
  const userId = ctx.from?.id;
  if (!isPhotoAdmin(userId)) return false;

  const caption = String(ctx.message?.caption || ctx.message?.text || "").trim();
  if (!caption) {
    await ctx.reply("Добавьте подпись к фото.\n\nПример: iPhone 17 Black", {
      reply_parameters: { message_id: ctx.message.message_id },
    });
    return true;
  }

  let fileId = null;
  let filename = "tg-photo.jpg";

  if (ctx.message.photo?.length) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    fileId = photo.file_id;
    filename = `${catalogAdminSlug(caption) || "photo"}.jpg`;
  } else if (ctx.message.document) {
    const doc = ctx.message.document;
    const mime = String(doc.mime_type || "").toLowerCase();
    if (!mime.startsWith("image/")) {
      await ctx.reply("Нужен файл-картинка (PNG, JPG, WEBP…).");
      return true;
    }
    fileId = doc.file_id;
    filename = doc.file_name || filename;
  } else {
    return false;
  }

  try {
    const match = matchPhotoCaption(caption);
    if (!match) {
      await ctx.reply(
        `Не нашёл товар по подписи:\n<b>${escapeHtml(caption)}</b>\n\n` +
          `Примеры:\n• iPhone 17\n• iphone-17\n• iPhone 17 Black`,
        { parse_mode: "HTML" }
      );
      return true;
    }

    const { buffer, name } = await downloadTelegramFile(ctx.api, fileId, botToken);
    const hint = name || filename;
    const result = applyPhotoFromBuffer(
      match.product.id,
      match.color?.id || null,
      buffer,
      hint
    );

    const where = match.color
      ? `${match.product.name} · ${match.color.name}`
      : match.product.name;
    console.log(`photo import ${where} by ${userId} → ${result.url}`);
    await ctx.reply(`✅ Фото сохранено: <b>${escapeHtml(where)}</b>`, { parse_mode: "HTML" });
    return true;
  } catch (err) {
    console.error("photo import failed", err.message || err);
    await ctx.reply(`❌ ${err.message || "Не удалось сохранить фото"}`);
    return true;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mountPhotoImportHandlers(bot, botToken) {
  bot.command(["photo", "фото"], async (ctx) => {
    if (!isPhotoAdmin(ctx.from?.id)) return;
    await ctx.reply(photoHelpText(), { parse_mode: "HTML" });
  });

  bot.on("message:photo", async (ctx) => {
    await handleAdminPhotoMessage(ctx, botToken);
  });

  bot.on("message:document", async (ctx) => {
    const mime = String(ctx.message.document?.mime_type || "").toLowerCase();
    if (!mime.startsWith("image/")) return;
    await handleAdminPhotoMessage(ctx, botToken);
  });
}

module.exports = {
  isPhotoAdmin,
  matchPhotoCaption,
  applyPhotoFromBuffer,
  mountPhotoImportHandlers,
  photoHelpText,
};
