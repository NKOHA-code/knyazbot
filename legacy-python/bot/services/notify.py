from aiogram import Bot
from aiogram.enums import ParseMode

from bot.config import settings


async def notify_admins(bot: Bot, text: str) -> None:
    await bot.send_message(
        chat_id=settings.admin_chat_id,
        text=text,
        parse_mode=ParseMode.HTML,
        disable_web_page_preview=True,
    )


def format_order_notification(
    *,
    user_id: int,
    username: str | None,
    full_name: str,
    product_name: str,
    color_name: str,
    storage: str,
    price_text: str,
    payment: str,
    phone: str,
) -> str:
    username_line = f"@{username}" if username else "без username"
    return (
        "🛒 <b>Новая заявка уКнязя</b>\n\n"
        f"📱 Товар: <b>{product_name}</b>\n"
        f"🎨 Цвет: {color_name}\n"
        f"💾 Память: {storage}\n"
        f"💰 Цена: {price_text}\n"
        f"💳 Оплата: {payment}\n"
        f"📞 Телефон: <code>{phone}</code>\n\n"
        f"👤 Клиент: {full_name} ({username_line})\n"
        f"🆔 ID: <code>{user_id}</code>\n"
        f"✉️ Написать: <a href=\"tg://user?id={user_id}\">открыть чат</a>"
    )
