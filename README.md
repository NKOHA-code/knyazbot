# КнязьMobile — Telegram bot + Mini App

Стек под Bothost: **Node.js 22** + Express + Grammy (как в [их гайде Mini App](https://bothost.ru/docs/)).

## Структура

```
app.js          # HTTP + Telegram bot
package.json
public/         # Mini App (обязательно public/)
data/catalog.json
```

## Локально

```bash
npm install
cp .env.example .env
npm start
```

## Bothost

См. [BOTHOST.md](BOTHOST.md) — язык **Node.js 22**, порт **3000**, без Dockerfile.
