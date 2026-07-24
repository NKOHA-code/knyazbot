from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import Message

from bot.config import settings
from bot.keyboards.menu import catalog_webapp_kb, main_menu_kb, manager_kb

router = Router(name="start")


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    text = (
        f"👑 Добро пожаловать в <b>{settings.shop_name}</b>!\n\n"
        "Откройте витрину: выберите модель, цвет и память — "
        "и оставьте заявку за минуту.\n\n"
        "Рассрочка и лизинг · доставка по РБ · гарантия"
    )
    await message.answer(text, reply_markup=main_menu_kb())
    await message.answer("Витрина с цветами и конфигурациями:", reply_markup=catalog_webapp_kb())


@router.message(Command("menu"))
@router.message(F.text == "📱 Открыть витрину")
async def open_catalog_hint(message: Message) -> None:
    # Reply keyboard WebApp button opens itself; this covers /menu and fallbacks.
    await message.answer(
        "Нажмите кнопку ниже, чтобы открыть витрину:",
        reply_markup=catalog_webapp_kb(),
    )


@router.message(F.text == "📍 Адрес и контакты")
async def contacts(message: Message) -> None:
    text = (
        f"<b>{settings.shop_name}</b>\n\n"
        f"📍 {settings.shop_address}\n"
        f"📞 {settings.manager_phone}\n"
        f"📲 @{settings.manager_username}\n\n"
        "Бесплатная доставка по Минску и всей Беларуси.\n"
        "Оплата при получении · любые проверки."
    )
    await message.answer(text, reply_markup=manager_kb())


@router.message(F.text == "👑 Менеджер")
async def manager(message: Message) -> None:
    await message.answer(
        "Нужен живой ответ? Напишите менеджеру — поможем с наличием, цветом и рассрочкой.",
        reply_markup=manager_kb(),
    )
