import asyncio
import logging
import os

import aiohttp
from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from bot.config import settings
from bot.handlers import setup_routers
from bot.web.app import create_web_app


async def _self_check(port: int) -> None:
    url = f"http://127.0.0.1:{port}/api/health"
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                body = await resp.text()
                logging.info("self-check %s -> %s %s", url, resp.status, body)
    except Exception:
        logging.exception("self-check failed for %s", url)


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher(storage=MemoryStorage())
    setup_routers(dp)

    app = create_web_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    port = settings.listen_port
    site = web.TCPSite(runner, "0.0.0.0", port, reuse_address=True)
    await site.start()

    logging.info("%s bot started", settings.shop_name)
    logging.info(
        "Mini App listening on 0.0.0.0:%s public URL: %s (PORT=%s DOMAIN=%s)",
        port,
        settings.public_webapp_url,
        os.getenv("PORT"),
        os.getenv("DOMAIN"),
    )
    await _self_check(port)

    await bot.delete_webhook(drop_pending_updates=True)

    try:
        await dp.start_polling(bot)
    finally:
        await runner.cleanup()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
