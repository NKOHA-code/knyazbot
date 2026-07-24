# Деплой на Bothost (Node.js 22 — как в их Mini App гайде)

Bothost для Mini App ждёт структуру:

```
app.js
package.json
public/
data/catalog.json
```

## Создать бота

https://bothost.ru/create-bot.php

| Поле | Значение |
|------|----------|
| Язык | **Node.js** |
| Версия | **22** (или latest) |
| Название | КнязьMobile |
| Bot Token | токен BotFather |
| Git URL | https://github.com/NKOHA-code/knyazbot.git |
| Ветка | main |
| Главный файл | `app.js` (или пусто — возьмёт `npm start`) |
| Свой Dockerfile | **НЕТ** |
| Веб / домен | **ДА** |
| Порт | **3000** |

ENV:

```env
ADMIN_CHAT_ID=318629821
MANAGER_USERNAME=knyaztut
MANAGER_PHONE=+375297330592
SHOP_ADDRESS=Минск, Нововиленская 10
SHOP_NAME=КнязьMobile
ALLOW_INSECURE_ORDERS=false
```

После деплоя: `https://<домен>/api/health` → `{"ok":true}`  
BotFather → Domain = хост без `https://` → `/start` у бота.
