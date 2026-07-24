from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import web
from aiogram import Bot
from aiogram.utils.web_app import safe_parse_webapp_init_data

from bot.config import settings
from bot.services.catalog import catalog_payload, get_product
from bot.services.notify import format_order_notification, notify_admins

WEBAPP_DIR = Path(__file__).resolve().parent.parent.parent / "webapp"
logger = logging.getLogger(__name__)

PAYMENT_TITLES = {
    "cash": "Наличные / карта",
    "installment": "Рассрочка",
    "leasing": "Лизинг",
}


def create_web_app(bot: Bot) -> web.Application:
    app = web.Application()
    app["bot"] = bot
    app.router.add_get("/", handle_index)
    app.router.add_get("/api/catalog", handle_catalog)
    app.router.add_get("/api/health", handle_health)
    app.router.add_post("/api/order", handle_order)
    app.router.add_static("/webapp/", WEBAPP_DIR, name="webapp")
    return app


async def handle_index(_: web.Request) -> web.Response:
    return web.FileResponse(WEBAPP_DIR / "index.html")


async def handle_catalog(_: web.Request) -> web.Response:
    payload = catalog_payload()
    payload["shop"] = {
        "name": settings.shop_name,
        "address": settings.shop_address,
        "phone": settings.manager_phone,
        "manager": settings.manager_username,
    }
    return web.json_response(payload)


async def handle_health(_: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def handle_order(request: web.Request) -> web.Response:
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"detail": "Некорректный JSON"}, status=400)

    product_id = str(data.get("product_id") or "")
    color_id = str(data.get("color_id") or "")
    config_id = str(data.get("config_id") or "")
    payment_id = str(data.get("payment_id") or "")
    phone = str(data.get("phone") or "").strip()
    init_data = str(data.get("init_data") or "")

    if len(phone) < 7:
        return web.json_response({"detail": "Укажите телефон"}, status=400)

    product = get_product(product_id)
    if product is None:
        return web.json_response({"detail": "Товар не найден"}, status=404)

    color = product.get_color(color_id)
    config = product.get_config(config_id)
    payment = PAYMENT_TITLES.get(payment_id)
    if color is None or config is None or payment is None:
        return web.json_response({"detail": "Выберите цвет, память и оплату"}, status=400)

    user_id = 0
    username = None
    full_name = "Клиент Mini App"

    if init_data:
        try:
            webapp_user = safe_parse_webapp_init_data(settings.bot_token, init_data)
            if webapp_user.user:
                user = webapp_user.user
                user_id = user.id
                username = user.username
                parts = [user.first_name or "", user.last_name or ""]
                full_name = " ".join(p for p in parts if p).strip() or full_name
        except Exception:
            logger.warning("Invalid Mini App initData")
            if not settings.allow_insecure_orders:
                return web.json_response({"detail": "Откройте витрину через Telegram"}, status=401)
    elif not settings.allow_insecure_orders:
        return web.json_response({"detail": "Откройте витрину через Telegram"}, status=401)

    text = format_order_notification(
        user_id=user_id,
        username=username,
        full_name=full_name,
        product_name=product.name,
        color_name=color.name,
        storage=config.storage,
        price_text=config.price_text(),
        payment=payment,
        phone=phone,
    )
    await notify_admins(request.app["bot"], text)
    return web.json_response({"ok": True})
