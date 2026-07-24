# КнязьMobile — Telegram bot + Mini App

Витрина техники с цветом, памятью и заявкой менеджеру.

## Локально

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# заполни BOT_TOKEN и ADMIN_CHAT_ID
python main.py
```

Для Mini App локально нужен HTTPS-туннель (cloudflared/ngrok) и `WEBAPP_URL` в `.env`.

## Bothost

См. [BOTHOST.md](BOTHOST.md) — деплой через [bothost.ru/create-bot.php](https://bothost.ru/create-bot.php).

## Структура

- `main.py` — точка входа
- `bot/` — aiogram + API
- `webapp/` — Mini App (HTML/CSS/JS + images)
- `bot/data/catalog.json` — прайс, цвета, конфиги, пути к фото
