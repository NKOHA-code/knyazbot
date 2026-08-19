(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#02140a");
      tg.setBackgroundColor("#02140a");
    } catch (_) {
      /* older clients */
    }
  }

  const state = {
    catalog: null,
    categoryId: "all",
    product: null,
    colorId: null,
    storagePick: null,
    configId: null,
    paymentId: "cash",
  };

  const els = {
    categories: document.getElementById("categories"),
    listView: document.getElementById("list-view"),
    detailView: document.getElementById("detail-view"),
    productList: document.getElementById("product-list"),
    backBtn: document.getElementById("back-btn"),
    detailBadge: document.getElementById("detail-badge"),
    detailName: document.getElementById("detail-name"),
    detailNote: document.getElementById("detail-note"),
    detailGift: document.getElementById("detail-gift"),
    detailImage: document.getElementById("detail-image"),
    detailMedia: document.getElementById("detail-media"),
    detailGlow: document.getElementById("detail-glow"),
    colorList: document.getElementById("color-list"),
    colorName: document.getElementById("color-name"),
    storageList: document.getElementById("storage-list"),
    simBlock: document.getElementById("sim-block"),
    simList: document.getElementById("sim-list"),
    simName: document.getElementById("sim-name"),
    paymentList: document.getElementById("payment-list"),
    paymentName: document.getElementById("payment-name"),
    detailPrice: document.getElementById("detail-price"),
    detailStock: document.getElementById("detail-stock"),
    phone: document.getElementById("phone"),
    orderBtn: document.getElementById("order-btn"),
    toast: document.getElementById("toast"),
  };

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add("hidden"), 2800);
  }

  /** Belarus mobile: 375 + 9 digits = 12 digits */
  function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeByPhone(raw) {
    let d = digitsOnly(raw);
    if (d.startsWith("80") && d.length >= 11) d = "375" + d.slice(2);
    if (d.startsWith("0") && d.length === 10) d = "375" + d.slice(1);
    if (d.length === 9 && !d.startsWith("375")) d = "375" + d;
    if (d.length > 12) d = d.slice(0, 12);
    return d;
  }

  function formatByPhoneDisplay(raw) {
    const d = normalizeByPhone(raw);
    if (!d) return "";
    // build +375 XX XXX XX XX as user types
    let out = "+";
    if (d.length <= 3) return out + d;
    out += d.slice(0, 3); // 375
    const rest = d.slice(3); // up to 9
    if (!rest.length) return out;
    out += " " + rest.slice(0, 2);
    if (rest.length > 2) out += " " + rest.slice(2, 5);
    if (rest.length > 5) out += " " + rest.slice(5, 7);
    if (rest.length > 7) out += " " + rest.slice(7, 9);
    return out;
  }

  function isValidByPhone(raw) {
    return /^375\d{9}$/.test(normalizeByPhone(raw));
  }

  function phoneE164(raw) {
    const d = normalizeByPhone(raw);
    return d ? `+${d}` : "";
  }

  function bindPhoneInput() {
    if (!els.phone) return;
    els.phone.addEventListener("input", () => {
      const formatted = formatByPhoneDisplay(els.phone.value);
      els.phone.value = formatted;
    });
    els.phone.addEventListener("keydown", (e) => {
      // allow control keys
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        ["Backspace", "Delete", "Tab", "Escape", "Enter", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
      ) {
        return;
      }
      if (!/^\d$/.test(e.key)) {
        e.preventDefault();
        return;
      }
      // block extra digits beyond 12
      const d = normalizeByPhone(els.phone.value);
      const sel = els.phone.selectionStart !== els.phone.selectionEnd;
      if (!sel && d.length >= 12) e.preventDefault();
    });
    els.phone.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      els.phone.value = formatByPhoneDisplay(text);
    });
  }

  function priceText(price) {
    if (!price || price <= 0) return "уточнит менеджер";
    return `${price.toLocaleString("ru-RU")} BYN`;
  }

  function productsForCategory() {
    const products = state.catalog.products;
    if (state.categoryId === "all") return products;
    return products.filter((p) => p.category === state.categoryId);
  }

  function selectedConfig() {
    return state.product?.configs.find((c) => c.id === state.configId) || null;
  }

  function uniqueStorages(product) {
    const seen = new Set();
    const out = [];
    for (const c of product?.configs || []) {
      const s = String(c.storage || "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function configsForStorage(product, storage) {
    return (product?.configs || []).filter((c) => String(c.storage || "").trim() === String(storage || "").trim());
  }

  function storageMinPrice(product, storage) {
    const prices = configsForStorage(product, storage).map((c) => Number(c.price) || 0).filter((n) => n > 0);
    return prices.length ? Math.min(...prices) : 0;
  }

  function needsSimPick(product, storage) {
    const list = configsForStorage(product, storage);
    return list.length > 1 || list.some((c) => c.sim_type);
  }

  function configSimLabel(config) {
    return String(config?.sim_type || "").trim() || "Стандарт";
  }

  function syncConfigForStorage() {
    const p = state.product;
    if (!p || !state.storagePick) {
      state.configId = null;
      return;
    }
    const list = configsForStorage(p, state.storagePick);
    const current = list.find((c) => c.id === state.configId);
    if (current) return;
    state.configId = list.find((c) => c.in_stock)?.id || list[0]?.id || null;
  }

  function selectedColor() {
    return state.product?.colors.find((c) => c.id === state.colorId) || null;
  }

  function renderCategories() {
    const items = [{ id: "all", title: "Все", emoji: "✦" }, ...state.catalog.categories];
    els.categories.innerHTML = items
      .map(
        (c) =>
          `<button type="button" class="cat ${state.categoryId === c.id ? "active" : ""}" data-cat="${c.id}">${c.emoji} ${c.title}</button>`
      )
      .join("");
  }

  function isUploadImage(src) {
    return String(src || "").includes("/images/uploads/");
  }

  function productImage(product, colorId) {
    let src = "";
    if (colorId) {
      const color = product.colors.find((c) => c.id === colorId);
      if (color?.image) src = color.image;
    }
    if (!src) {
      const firstWithImage = product.colors?.find((c) => c.image);
      if (firstWithImage?.image) src = firstWithImage.image;
    }
    if (!src) src = product.image || "";
    if (!src) return "";
    if (src.includes("/images/uploads/")) {
      const sep = src.includes("?") ? "&" : "?";
      return `${src}${sep}t=${Date.now()}`;
    }
    return src.includes("?") ? src : `${src}?v=3`;
  }

  function setDetailImage(src, alt) {
    if (!src) {
      els.detailImage.removeAttribute("src");
      els.detailImage.alt = alt || "";
      return;
    }
    if (els.detailImage.src.endsWith(src) || els.detailImage.getAttribute("src") === src) {
      els.detailImage.alt = alt || "";
      return;
    }
    els.detailImage.style.opacity = "0.35";
    const img = new Image();
    img.onload = () => {
      els.detailImage.src = src;
      els.detailImage.alt = alt || "";
      els.detailImage.style.opacity = "1";
    };
    img.onerror = () => {
      els.detailImage.src = src;
      els.detailImage.style.opacity = "1";
    };
    img.src = src;
  }

  function defaultBadgeEmoji(badge) {
    const map = {
      Хит: "🔥",
      Новинка: "✨",
      Флагман: "👑",
      Топ: "⭐",
      Выгодно: "💰",
    };
    return map[String(badge || "").trim()] || "";
  }

  function formatBadge(p) {
    if (!p?.badge) return "";
    const em = p.badge_emoji || defaultBadgeEmoji(p.badge);
    return `${em ? em + " " : ""}${p.badge}`.trim();
  }

  function renderList() {
    const products = productsForCategory();
    els.productList.innerHTML = products
      .map((p) => {
        const swatches = p.colors
          .slice(0, 5)
          .map((c) => `<span class="swatch" style="background:${c.hex}" title="${c.name}"></span>`)
          .join("");
        const storages = [...new Set((p.configs || []).map((c) => c.storage).filter(Boolean))];
        const configs = storages.join(" · ");
        const badgeText = formatBadge(p);
        const badge = badgeText ? `<span class="badge">${badgeText}</span>` : "<span></span>";
        const img = productImage(p);
        const uploadPhoto = isUploadImage(img);
        return `
          <button type="button" class="card" data-product="${p.id}">
            <div class="card-photo${uploadPhoto ? " card-photo--upload" : ""}">
              ${img ? `<img src="${img}" alt="${p.name}" loading="lazy" />` : ""}
            </div>
            <div class="card-body">
              <div class="card-top">
                <h2 class="card-name">${p.name}</h2>
                ${badge}
              </div>
              <div class="card-meta">${configs}</div>
              <div class="swatches">${swatches}</div>
              <div class="card-price">${p.price_from}</div>
            </div>
          </button>
        `;
      })
      .join("");
  }

  function renderDetail() {
    const p = state.product;
    const color = selectedColor();
    const img = productImage(p, state.colorId);
    if (els.detailMedia) {
      els.detailMedia.classList.toggle("media--upload", isUploadImage(img));
    }
    els.detailName.textContent = p.name;
    els.detailNote.textContent = p.note || "";
    setDetailImage(img, `${p.name} · ${color?.name || ""}`.trim());
    els.detailGlow.style.background = color?.hex || "transparent";
    const badgeText = formatBadge(p);
    if (badgeText) {
      els.detailBadge.textContent = badgeText;
      els.detailBadge.classList.remove("hidden");
    } else {
      els.detailBadge.classList.add("hidden");
    }
    if (p.gift) {
      els.detailGift.textContent = `В подарок: ${p.gift}`;
      els.detailGift.classList.remove("hidden");
    } else {
      els.detailGift.classList.add("hidden");
    }

    els.colorList.innerHTML = p.colors
      .map(
        (c) =>
          `<button type="button" class="color-btn ${state.colorId === c.id ? "active" : ""}" data-color="${c.id}" style="background:${c.hex}" aria-label="${c.name}"></button>`
      )
      .join("");
    els.colorName.textContent = color?.name || "";

    const storages = uniqueStorages(p);
    if (!state.storagePick || !storages.includes(state.storagePick)) {
      state.storagePick = storages[0] || null;
    }
    syncConfigForStorage();

    els.storageList.innerHTML = storages
      .map((storage) => {
        const min = storageMinPrice(p, storage);
        const suffix = min > 0 ? ` · от ${min} BYN` : "";
        return `<button type="button" class="chip ${state.storagePick === storage ? "active" : ""}" data-storage="${storage}">${storage}${suffix}</button>`;
      })
      .join("");

    const simConfigs = configsForStorage(p, state.storagePick);
    const showSim = needsSimPick(p, state.storagePick);
    if (els.simBlock) els.simBlock.classList.toggle("hidden", !showSim);
    if (showSim) {
      els.simList.innerHTML = simConfigs
        .map((c) => {
          const label = configSimLabel(c);
          const pricePart = c.price > 0 ? `${c.price} BYN` : "уточнит менеджер";
          return `<button type="button" class="chip ${state.configId === c.id ? "active" : ""}" data-config="${c.id}" ${c.in_stock ? "" : "disabled"}>${label} · ${pricePart}</button>`;
        })
        .join("");
      const cfg = selectedConfig();
      if (els.simName) els.simName.textContent = cfg ? configSimLabel(cfg) : "";
    } else if (els.simList) {
      els.simList.innerHTML = "";
      if (els.simName) els.simName.textContent = "";
    }

    els.paymentList.innerHTML = (state.catalog.payments || [])
      .map(
        (pay) =>
          `<button type="button" class="chip ${state.paymentId === pay.id ? "active" : ""}" data-payment="${pay.id}">${pay.title}</button>`
      )
      .join("");
    const payTitle = (state.catalog.payments || []).find((p) => p.id === state.paymentId)?.title || "";
    if (els.paymentName) els.paymentName.textContent = payTitle ? `Выбрано: ${payTitle}` : "Выберите способ оплаты";

    updatePrice();
  }

  function updatePrice() {
    const config = selectedConfig();
    if (!config) {
      els.detailPrice.textContent = "—";
      els.detailStock.textContent = "";
      return;
    }
    els.detailPrice.textContent = priceText(config.price);
    els.detailStock.textContent = config.in_stock ? "В наличии" : "Под заказ";
    els.detailStock.classList.toggle("out", !config.in_stock);
  }

  function showList() {
    state.product = null;
    els.listView.classList.remove("hidden");
    els.detailView.classList.add("hidden");
    if (tg?.MainButton) tg.MainButton.hide();
  }

  function showDetail(productId) {
    const product = state.catalog.products.find((p) => p.id === productId);
    if (!product) return;
    state.product = product;
    state.colorId = product.colors[0]?.id || null;
    state.storagePick = uniqueStorages(product)[0] || null;
    const firstConfigs = configsForStorage(product, state.storagePick);
    state.configId = firstConfigs.find((c) => c.in_stock)?.id || firstConfigs[0]?.id || null;
    state.paymentId = "cash";
    els.listView.classList.add("hidden");
    els.detailView.classList.remove("hidden");
    renderDetail();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitOrder() {
    if (!state.product || !state.colorId || !state.configId || !state.storagePick) {
      toast("Выберите цвет, память и SIM");
      return;
    }
    if (!state.paymentId) {
      toast("Выберите способ оплаты");
      return;
    }
    const paymentTitle =
      (state.catalog.payments || []).find((p) => p.id === state.paymentId)?.title || state.paymentId;
    if (!isValidByPhone(els.phone.value)) {
      toast("Введите номер РБ: +375 и 9 цифр");
      els.phone.focus();
      return;
    }
    const phone = phoneE164(els.phone.value);

    els.orderBtn.disabled = true;
    els.orderBtn.textContent = "Отправляем…";
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: state.product.id,
          color_id: state.colorId,
          config_id: state.configId,
          payment_id: state.paymentId,
          payment_title: paymentTitle,
          phone,
          init_data: tg?.initData || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Не удалось отправить заявку");
      toast("Заявка принята. Менеджер скоро напишет.");
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
      if (tg?.close) {
        setTimeout(() => tg.close(), 1200);
      } else {
        showList();
      }
    } catch (err) {
      toast(err.message || "Ошибка отправки");
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
    } finally {
      els.orderBtn.disabled = false;
      els.orderBtn.textContent = "Оставить заявку";
    }
  }

  els.categories.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    state.categoryId = btn.dataset.cat;
    renderCategories();
    renderList();
    showList();
  });

  els.productList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-product]");
    if (!btn) return;
    showDetail(btn.dataset.product);
  });

  els.backBtn.addEventListener("click", showList);

  els.detailView.addEventListener("click", (e) => {
    const color = e.target.closest("[data-color]");
    if (color) {
      state.colorId = color.dataset.color;
      renderDetail();
      return;
    }
    const storage = e.target.closest("[data-storage]");
    if (storage) {
      state.storagePick = storage.dataset.storage;
      syncConfigForStorage();
      renderDetail();
      return;
    }
    const config = e.target.closest("[data-config]");
    if (config && !config.disabled) {
      state.configId = config.dataset.config;
      renderDetail();
      return;
    }
    const payment = e.target.closest("[data-payment]");
    if (payment) {
      state.paymentId = payment.getAttribute("data-payment") || payment.dataset.payment;
      renderDetail();
    }
  });

  els.orderBtn.addEventListener("click", submitOrder);

  async function boot() {
    const DEFAULT_PAYMENTS = [
      { id: "cash", title: "Наличные / карта" },
      { id: "installment", title: "Рассрочка" },
      { id: "leasing", title: "Лизинг" },
    ];
    const res = await fetch("/api/catalog");
    if (!res.ok) {
      // Fallback if API fails but static file is available
      const fallback = await fetch("/catalog.json");
      if (!fallback.ok) throw new Error("Не удалось загрузить каталог");
      state.catalog = await fallback.json();
    } else {
      state.catalog = await res.json();
    }
    if (!state.catalog.payments?.length) state.catalog.payments = DEFAULT_PAYMENTS;
    // normalize products if raw file without price_from
    state.catalog.products = (state.catalog.products || []).map((p) => {
      if (p.price_from) return p;
      const priced = (p.configs || []).map((c) => c.price).filter((n) => n > 0);
      const min = priced.length ? Math.min(...priced) : null;
      return {
        ...p,
        min_price: min,
        price_from: min == null ? "цену уточнит менеджер" : `от ${min} BYN`,
      };
    });
    renderCategories();
    renderList();
  }

  bindPhoneInput();
  boot().catch((err) => toast(err.message || "Ошибка загрузки"));
})();
