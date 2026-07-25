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
| Главный файл | `app.js` или `http-wrapper.js` |
| Свой Dockerfile | **НЕТ** |
| Веб / домен | **ДА** |
| Порт | **3000** |
| Версия Node | **22** (если в логах 18 — смени в настройках) |

> При включённом домене Bothost может запускать `http-wrapper.js`.
> В репозитории он есть и просто подключает `app.js`.

ENV:

```env
ADMIN_CHAT_ID=318629821
MANAGER_USERNAME=knyaztut
MANAGER_PHONE=+375297330592
SHOP_ADDRESS=Минск, Нововиленская 10
SHOP_NAME=КнязьMobile
ALLOW_INSECURE_ORDERS=false
DATABASE_URL=postgresql://...
PGSSL=false

# Скрытая админка заявок (не светить в канале/боте)
ADMIN_PATH=случайная_строка_16plus
ADMIN_PASSWORD=сильный_пароль
ADMIN_SESSION_SECRET=ещё_одна_случайная_строка_32
```

`DATABASE_URL` — строка из Bothost Postgres. Заявки пишутся в таблицу `orders` + дублируются админу в Telegram.

### Скрытая админка

После деплоя с `ADMIN_PATH` / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`:

- URL: `https://<домен>/a/<ADMIN_PATH>/`
- Неверный путь → обычный 404
- Вход: пароль **или** Telegram Mini App (ID из `ADMIN_USER_IDS` / `data/managers.json`)

Возможности:
- заявки: статусы, заметки, назначение менеджера, фильтры (день/неделя/товар), CSV
- каталог: цены, наличие, товары, цвета, загрузка фото
- статистика, шаблоны ответов (FAQ), список менеджеров
- уведомление в Telegram при смене статуса

Не публикуй ссылку в канале.

После деплоя: `https://<домен>/api/health` → `{"ok":true}`  
BotFather → Domain = хост без `https://` → `/start` у бота.
