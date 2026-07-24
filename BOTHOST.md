# Деплой на Bothost

Инструкция под [создание бота](https://bothost.ru/create-bot.php) и [быстрый старт](https://bothost.ru/docs/getting-started).

## 1. Репозиторий

1. Создай пустой репозиторий на GitHub/GitLab.
2. Залей этот проект (без `.env` и `.venv`).
3. В корне должны быть: `main.py`, `requirements.txt`, `Dockerfile`, папки `bot/` и `webapp/`.

## 2. Форма Bothost

На [bothost.ru/create-bot.php](https://bothost.ru/create-bot.php):

| Поле | Значение |
|------|----------|
| Название | КнязьMobile |
| Платформа | Telegram |
| Библиотека | aiogram |
| Bot Token | токен от BotFather |
| Git URL | ссылка на репозиторий |
| Ветка | `main` |
| Главный файл | `main.py` |
| Использовать собственный Dockerfile | да |
| Включить веб-интерфейс / webhook / домен | **да** (нужно для Mini App) |
| Порт | `8765` (или тот же, что в `PORT`) |

## 3. Переменные окружения

Bothost сам даёт `BOT_TOKEN` (из формы), `PORT`, `DOMAIN`.

Добавь вручную (на Basic/Pro — через env в панели):

```env
ADMIN_CHAT_ID=318629821
MANAGER_USERNAME=knyaztut
MANAGER_PHONE=+375297330592
SHOP_ADDRESS=Минск, Нововиленская 10
SHOP_NAME=КнязьMobile
ALLOW_INSECURE_ORDERS=false
```

`WEBAPP_URL` можно не указывать: бот возьмёт `https://$DOMAIN`.

## 4. Важно про тариф

- Mini App требует **HTTPS-домен** Bothost.
- На Free автодомен/веб-интерфейс часто недоступны — для витрины нужен **Basic** и включённый веб-доступ.
- Без домена бот (FAQ/менеджер) работать может, витрина в Telegram — нет.

## 5. После деплоя

1. Дождись статуса running, проверь логи.
2. Открой `https://<твой-домен>/api/health` → `{"ok": true}`.
3. В [@BotFather](https://t.me/BotFather) → `/mybots` → Bot Settings → Domain укажи хост без `https://`.
4. Напиши боту `/start` → **Открыть витрину**.

Документация: [домены и порты](https://bothost.ru/docs/domains-and-ports), [env](https://bothost.ru/docs/environment-variables), [Dockerfile](https://bothost.ru/docs/custom-dockerfile).
