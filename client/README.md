# Счётчик намазов

Клиентское React-приложение публикуется на GitHub Pages. Регистрация, вход, счётчики и история работают через отдельный HTTPS API-сервер с PostgreSQL; Pages сам серверную часть не запускает.

## Локальный запуск

Из папки `client`:

```powershell
npm ci
npm run dev
```

Для разработки Vite проксирует `/api` на `http://localhost:3001`. Запустите API отдельно из папки `server` командой `npm run dev`.

## GitHub Pages

1. Разверните API и PostgreSQL по инструкции [server/README.md](../server/README.md).
2. В Reg.ru удалите запись `A www → 109.172.94.72`, создайте `CNAME www → Khamirzoev.github.io` и добавьте `A api → 109.172.94.72`. Запись `A @` пока оставьте без изменений.
3. В настройках репозитория откройте **Settings → Pages** и задайте custom domain `www.khamirzoev.ru`; выберите **GitHub Actions** как источник. После проверки DNS включите **Enforce HTTPS**.
4. В **Settings → Secrets and variables → Actions → Variables** добавьте:
   - `VITE_API_URL` = `https://api.khamirzoev.ru`
   - `VITE_BASE_PATH` = `/`
5. Отправьте изменения в `main`; workflow соберёт и опубликует сайт на корне `www.khamirzoev.ru`.

Если custom domain ещё не настроен, `VITE_BASE_PATH` можно не задавать: workflow использует путь проекта `/mama/`. Сайт и API на поддоменах `www` и `api` будут одним сайтом для браузерных cookie.
