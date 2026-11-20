import './App.css'
import axios from 'axios'
import { useEffect, useState } from 'react'
import { AuthForm } from './components/AuthForm'
import { Save } from './components/save'
import { Schot } from './components/schot'
import { StorList } from './components/storList'

const PRAYERS = ['Фаджр', 'Зухр', 'Аср', 'Магриб', 'Иша', 'Витр']
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
})

function emptyCounts() {
  return Object.fromEntries(PRAYERS.map((name) => [name, 0]))
}

function getLocalData(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`mama-prayer-counter:${userId}`))
    const history = JSON.parse(
      localStorage.getItem(`mama-prayer-history:${userId}`) ?? '[]',
    )
    const targetCount = Number(saved?.targetCount)
    return {
      counts: saved?.counts ?? emptyCounts(),
      targetCount: Number.isSafeInteger(targetCount) && targetCount >= 0
        ? targetCount
        : 0,
      history: Array.isArray(history) ? history : [],
    }
  } catch {
    return { counts: emptyCounts(), targetCount: 0, history: [] }
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [counts, setCounts] = useState(emptyCounts)
  const [targetCount, setTargetCount] = useState(0)
  const [status, setStatus] = useState('')
  const [history, setHistory] = useState([])

  useEffect(() => {
    let active = true
    api.get('/api/auth/me')
      .then(({ data }) => {
        if (active) setUser(data.user)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setAuthLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let active = true
    const localData = getLocalData(user.id)

    async function loadFromServer() {
      try {
        const { data } = await api.get('/api/prayers')
        if (!active) return
        setCounts(data.counts ?? localData.counts)
        setTargetCount(data.targetCount ?? localData.targetCount)
        setHistory(
          Array.isArray(data.history) && data.history.length
            ? data.history
            : localData.history,
        )
        if (data.counts) setStatus('Данные загружены из PostgreSQL')
      } catch {
        if (active) {
          setCounts(localData.counts)
          setTargetCount(localData.targetCount)
          setHistory(localData.history)
          setStatus('Сервер недоступен: показан локальный кэш')
        }
      } finally {
        if (active) setLoadedUserId(user.id)
      }
    }
    loadFromServer()
    return () => {
      active = false
    }
  }, [user])

  const [today] = useState(() =>
    new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date())
  )

  function changeCount(name, nextValue) {
    setCounts((current) => ({
      ...current,
      [name]: Math.max(0, nextValue),
    }))
  }

  async function save() {
    if (!user) return
    const record = { counts, targetCount, savedAt: new Date().toISOString() }
    const storageKey = `mama-prayer-counter:${user.id}`
    const historyKey = `mama-prayer-history:${user.id}`
    const localHistory = [record, ...history].slice(0, 10)

    try {
      localStorage.setItem(storageKey, JSON.stringify(record))
      localStorage.setItem(historyKey, JSON.stringify(localHistory))
    } catch {
      // The server remains the primary storage if the browser cache is unavailable.
    }
    setHistory(localHistory)

    try {
      const { data } = await api.put('/api/prayers', { counts, targetCount })
      const nextHistory = [data, ...history].slice(0, 10)
      try {
        localStorage.setItem(storageKey, JSON.stringify(data))
        localStorage.setItem(historyKey, JSON.stringify(nextHistory))
      } catch {
        // Server save succeeded; only the optional browser cache could not update.
      }
      setHistory(nextHistory)
      setStatus('Сохранено в PostgreSQL')
    } catch {
      setStatus('Сервер недоступен: данные сохранены только в кэше браузера')
    }
  }

  async function reset() {
    if (!user) return
    const nextCounts = emptyCounts()
    setCounts(nextCounts)
    try {
      localStorage.setItem(
        `mama-prayer-counter:${user.id}`,
        JSON.stringify({ counts: nextCounts, targetCount }),
      )
    } catch {
      setStatus('Локальный кэш не удалось очистить')
    }

    try {
      await api.delete('/api/prayers', { data: { targetCount } })
      setStatus('Счётчики сброшены')
    } catch {
      setStatus('Сервер недоступен: очищен только локальный кэш')
    }
  }

  async function clearHistory() {
    if (!user) return
    try {
      localStorage.removeItem(`mama-prayer-history:${user.id}`)
    } catch {
      setStatus('Локальную историю не удалось очистить')
    }
    setHistory([])
    try {
      await api.delete('/api/prayers/history')
    } catch {
      setStatus('Сервер недоступен: история очищена только в браузере')
    }
  }

  async function logout() {
    try {
      await api.post('/api/auth/logout')
      setUser(null)
      setLoadedUserId(null)
      setCounts(emptyCounts())
      setTargetCount(0)
      setHistory([])
      setStatus('')
    } catch {
      setStatus('Не удалось выйти: сервер недоступен')
    }
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const remaining = Math.max(0, targetCount - total)
  const dataLoading = Boolean(user) && loadedUserId !== user.id

  if (authLoading) {
    return <div className="app-shell"><p className="loading-message">Загрузка…</p></div>
  }
  if (!user) {
    return <AuthForm onAuthenticated={setUser} />
  }

  return (
    <div className="app-shell">
      <div className="prayer-card">
        <header className="header">
          <span className="eyebrow">для любимой мамушки</span>
          <h1>Счётчик намазов</h1>
          <p>{today}</p>
          <div className="account-bar">
            <span>{user.email}</span>
            <button type="button" onClick={logout}>Выйти</button>
          </div>
        </header>

        <main className="main">
          {dataLoading && <p className="loading-message">Загрузка данных…</p>}
          <div className="prayer-list">
            {PRAYERS.map((name) => (
              <div className="prayer-row" key={name}>
                <h2>{name}</h2>
                <Schot
                  value={counts[name] ?? 0}
                  onChange={(nextValue) => changeCount(name, nextValue)}
                  disabled={dataLoading}
                />
              </div>
            ))}
          </div>

          <div className="target-field">
            <label htmlFor="target-prayers">Всего надо сделать намазов</label>
            <input
              id="target-prayers"
              type="number"
              min="0"
              step="1"
              value={targetCount}
              onChange={(event) => {
                const nextValue = Number(event.currentTarget.value)
                if (Number.isSafeInteger(nextValue) && nextValue >= 0) {
                  setTargetCount(nextValue)
                }
              }}
              disabled={dataLoading}
            />
          </div>

          <div className="summary">
            <span>Всего сделано намазов</span>
            <strong>{total}</strong>
          </div>

          <div className="actions">
            <Save onSave={save} disabled={dataLoading} />
            <button
              className="reset-button"
              type="button"
              onClick={reset}
              disabled={dataLoading}
            >
              Сбросить
            </button>
          </div>
          <p className="status" role="status">{status}</p>
          <StorList items={dataLoading ? [] : history} onClear={clearHistory} />
          <div className="summary" aria-live="polite">
            <span>Осталось сделать намазов</span>
            <strong>{remaining}</strong>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
