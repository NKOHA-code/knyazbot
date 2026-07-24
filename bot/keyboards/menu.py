from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup, WebAppInfo
from aiogram.utils.keyboard import ReplyKeyboardBuilder

from bot.config import settings

PAYMENT_OPTIONS = {
    "cash": "Наличные / карта",
    "installment": "Рассрочка",
    "leasing": "Лизинг",
}


def main_menu_kb() -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    builder.row(
        KeyboardButton(
            text="📱 Открыть витрину",
            web_app=WebAppInfo(url=settings.public_webapp_url),
        )
    )
    builder.row(KeyboardButton(text="❓ FAQ"), KeyboardButton(text="👑 Менеджер"))
    builder.row(KeyboardButton(text="📍 Адрес и контакты"))
    return builder.as_markup(resize_keyboard=True)


def catalog_webapp_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть витрину",
                    web_app=WebAppInfo(url=settings.public_webapp_url),
                )
            ]
        ]
    )


def manager_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Написать менеджеру",
                    url=f"https://t.me/{settings.manager_username}",
                )
            ]
        ]
    )
