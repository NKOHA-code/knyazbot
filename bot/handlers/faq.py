from aiogram import F, Router
from aiogram.types import Message

from bot.config import settings
from bot.keyboards.menu import manager_kb

router = Router(name="faq")

FAQ_TEXT = (
    "<b>Частые вопросы</b>\n\n"
    "<b>Это оригинал?</b>\n"
    "Да. Новая техника в заводской упаковке, не восстановленная и не активированная.\n\n"
    "<b>Какая гарантия?</b>\n"
    "12 месяцев гарантии + до 24–36 месяцев сервисного обслуживания (по модели).\n\n"
    "<b>Есть доставка?</b>\n"
    "Бесплатно по Минску и всей Беларуси. Оплата по факту получения, любые проверки.\n\n"
    "<b>Рассрочка и лизинг?</b>\n"
    "Одобряем почти всем. Минимум документов. Партнёры: Сбер, Альфа («Красная карта»), МТБанк («Халва»).\n\n"
    "<b>Можно сдать старый телефон?</b>\n"
    "Да, есть выкуп / trade-in — детали у менеджера.\n\n"
    f"<b>Где вы?</b>\n"
    f"{settings.shop_address}\n"
    f"📞 {settings.manager_phone} · @{settings.manager_username}"
)


@router.message(F.text == "❓ FAQ")
async def show_faq(message: Message) -> None:
    await message.answer(FAQ_TEXT, reply_markup=manager_kb())
