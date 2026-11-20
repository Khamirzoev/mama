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
2. В GitHub откройте **Settings → Secrets and variables → Actions → Variables** и добавьте переменную `VITE_API_URL` со значением HTTPS-адреса API, например `https://api.example.com` (без завершающего `/`).
3. В **Settings → Pages** выберите источник **GitHub Actions**.
4. Отправьте изменения в ветку `main`. Workflow автоматически соберёт и опубликует сайт.

Workflow задаёт путь сайта по имени репозитория. Для надёжной работы входа настройте собственный домен для Pages и API на поддомене этого же домена, чтобы браузер не блокировал cookie как сторонние.
