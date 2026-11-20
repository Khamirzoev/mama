import { useState } from 'react'
import axios from 'axios'

const api = axios.create({ withCredentials: true })

export function AuthForm({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const { data } = await api.post(endpoint, { email, password })
      onAuthenticated(data.user)
    } catch (requestError) {
      setError(requestError.response?.data?.error ?? 'Не удалось связаться с сервером')
    } finally {
      setSubmitting(false)
    }
  }

  function changeMode(nextMode) {
    setMode(nextMode)
    setError('')
  }

  return (
    <div className="app-shell">
      <section className="prayer-card auth-card">
        <header className="header">
          <span className="eyebrow">для любимой мамушки</span>
          <h1>Счётчик намазов</h1>
          <p>Войдите или создайте аккаунт</p>
        </header>
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-tabs" role="tablist" aria-label="Авторизация">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => changeMode('login')}
            >
              Войти
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={mode === 'register' ? 'active' : ''}
              onClick={() => changeMode('register')}
            >
              Регистрация
            </button>
          </div>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              maxLength={72}
            />
          </label>
          {mode === 'register' && (
            <p className="auth-hint">Минимум 8 символов</p>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="save-button auth-submit" type="submit" disabled={submitting}>
            {submitting
              ? 'Подождите…'
              : mode === 'register'
                ? 'Создать аккаунт'
                : 'Войти'}
          </button>
        </form>
      </section>
    </div>
  )
}
