(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#12110f");
      tg.setBackgroundColor("#12110f");
    } catch (_) {
      /* older clients */
    }
  }

  const state = {
    catalog: null,
    categoryId: "all",
    product: null,
    colorId: null,
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
    detailGlow: document.getElementById("detail-glow"),
    colorList: document.getElementById("color-list"),
    colorName: document.getElementById("color-name"),
    configList: document.getElementById("config-list"),
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
    // bust Telegram/WebView cache after regenerating color art
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

  function renderList() {
    const products = productsForCategory();
    els.productList.innerHTML = products
      .map((p) => {
        const swatches = p.colors
          .slice(0, 5)
          .map((c) => `<span class="swatch" style="background:${c.hex}" title="${c.name}"></span>`)
          .join("");
        const configs = p.configs.map((c) => c.storage).join(" · ");
        const badge = p.badge ? `<span class="badge">${p.badge}</span>` : "<span></span>";
        const img = productImage(p);
        return `
          <button type="button" class="card" data-product="${p.id}">
            <div class="card-photo">
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
    els.detailName.textContent = p.name;
    els.detailNote.textContent = p.note || "";
    setDetailImage(img, `${p.name} · ${color?.name || ""}`.trim());
    els.detailGlow.style.background = color?.hex || "transparent";
    if (p.badge) {
      els.detailBadge.textContent = p.badge;
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

    els.configList.innerHTML = p.configs
      .map((c) => {
        const label = c.price > 0 ? `${c.storage} · ${c.price} BYN` : `${c.storage} · цена у менеджера`;
        return `<button type="button" class="chip ${state.configId === c.id ? "active" : ""}" data-config="${c.id}" ${c.in_stock ? "" : "disabled"}>${label}</button>`;
      })
      .join("");

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
    state.configId = product.configs.find((c) => c.in_stock)?.id || product.configs[0]?.id || null;
    state.paymentId = "cash";
    els.listView.classList.add("hidden");
    els.detailView.classList.remove("hidden");
    renderDetail();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitOrder() {
    const phone = els.phone.value.trim();
    if (!state.product || !state.colorId || !state.configId) {
      toast("Выберите цвет и конфигурацию");
      return;
    }
    if (!state.paymentId) {
      toast("Выберите способ оплаты");
      return;
    }
    const paymentTitle =
      (state.catalog.payments || []).find((p) => p.id === state.paymentId)?.title || state.paymentId;
    if (phone.length < 7) {
      toast("Укажите телефон для связи");
      els.phone.focus();
      return;
    }

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

  boot().catch((err) => toast(err.message || "Ошибка загрузки"));
})();
