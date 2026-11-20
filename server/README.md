# Развёртывание API и PostgreSQL на Ubuntu

GitHub Pages размещает только клиент. Для регистрации и сохранения данных нужен этот API и PostgreSQL на сервере. Порт PostgreSQL `5432` оставляйте закрытым для внешнего доступа: API подключается к базе по `127.0.0.1`.

## Установка базы

Подключитесь к серверу:

```bash
ssh USER@109.172.94.72
```

Установите и запустите PostgreSQL:

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Создайте отдельного пользователя базы и саму базу. Команда запросит пароль интерактивно:

```bash
sudo -u postgres createuser --pwprompt prayer_app
sudo -u postgres createdb --owner=prayer_app prayer_counter
```

Таблицы аккаунтов, счётчиков и истории сервер создаёт автоматически при первом запуске. Не открывайте порт `5432` в firewall и не настраивайте PostgreSQL на прослушивание внешнего IP.

## HTTPS и API

Для сайта на GitHub Pages API должен быть доступен по HTTPS: браузеры блокируют запросы с HTTPS-сайта к API по обычному HTTP. Для этого проекта используйте `api.khamirzoev.ru` с DNS A-записью на IP сервера и TLS-сертификатом. Сайт будет на `www.khamirzoev.ru`; эти поддомены одного домена позволяют браузеру передавать cookie авторизации.

На сервере настройте reverse proxy (например, Nginx) на `127.0.0.1:3001` и запустите Node API как systemd-службу. В каталоге `server` установите production-зависимости:

```bash
npm ci --omit=dev
```

Создайте `server/.env` на сервере и заполните:

```env
PORT=3001
NODE_ENV=production
CLIENT_ORIGIN=https://www.khamirzoev.ru
DATABASE_URL=postgresql://prayer_app:ВАШ_ПАРОЛЬ@127.0.0.1:5432/prayer_counter
SESSION_SECRET=СЛУЧАЙНЫЙ_СЕКРЕТ_НЕ_КОРОЧЕ_32_СИМВОЛОВ
```

Секрет для сессий можно сгенерировать командой `openssl rand -hex 32`. Не используйте пароль `1234` для публичного сервера и не добавляйте `.env` в Git.

В настройках GitHub репозитория добавьте **Settings → Secrets and variables → Actions → Variables → New repository variable**:

- `VITE_API_URL` — `https://api.khamirzoev.ru` (без завершающего `/`).
- `VITE_BASE_PATH` — `/` при использовании custom domain `www.khamirzoev.ru`.

В `CLIENT_ORIGIN` укажите точный HTTPS origin сайта, без пути. Workflow Pages соберёт клиент с адресом API из `VITE_API_URL`.
