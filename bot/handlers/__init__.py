from aiogram import Dispatcher

from bot.handlers import faq, start


def setup_routers(dp: Dispatcher) -> None:
    dp.include_router(start.router)
    dp.include_router(faq.router)
