import './App.css'
import { Schot } from './components/schot'
import { Save } from './components/save'
import { StorList } from './components/storList'
import { AuthForm } from './components/AuthForm'
import axios from 'axios'
import { useEffect, useState } from 'react'

const PRAYERS = ['Фаджр', 'Зухр', 'Аср', 'Магриб', 'Иша', 'Витр']
const api = axios.create({ withCredentials: true })

function emptyCounts() {
  return Object.fromEntries(PRAYERS.map((name) => [name, 0]))
}

function getLocalData(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`mama-prayer-counter:${userId}`))
    const history = JSON.parse(localStorage.getItem(`mama-prayer-history:${userId}`) ?? '[]')
    return {
      counts: saved?.counts ?? emptyCounts(),
      history: Array.isArray(history) ? history : [],
    }
  } catch {
    return { counts: emptyCounts(), history: [] }
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [counts, setCounts] = useState(emptyCounts)
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
        setHistory(
          Array.isArray(data.history) && data.history.length
            ? data.history
            : localData.history,
        )
        if (data.counts) setStatus('Данные загружены из базы')
      } catch {
        if (active) {
          setCounts(localData.counts)
          setHistory(localData.history)
          setStatus('Сервер недоступен: показаны данные устройства')
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
    const record = {
      counts,
      savedAt: new Date().toISOString(),
    }
    const storageKey = `mama-prayer-counter:${user.id}`
    const historyKey = `mama-prayer-history:${user.id}`
    localStorage.setItem(storageKey, JSON.stringify(record))
    const nextHistory = [record, ...history].slice(0, 10)
    localStorage.setItem(historyKey, JSON.stringify(nextHistory))
    setHistory(nextHistory)

    try {
      const { data } = await api.put('/api/prayers', { counts })
      const serverHistory = [data, ...history].slice(0, 10)
      localStorage.setItem(storageKey, JSON.stringify(data))
      localStorage.setItem(historyKey, JSON.stringify(serverHistory))
      setHistory(serverHistory)
      setStatus('Сохранено в PostgreSQL')
    } catch {
      setStatus('Сохранено на устройстве')
    }
  }

  async function reset() {
    if (!user) return
    setCounts(emptyCounts())
    localStorage.removeItem(`mama-prayer-counter:${user.id}`)
    setStatus('Счётчики сброшены на устройстве')
    try {
      await api.delete('/api/prayers')
      setStatus('Счётчики сброшены')
    } catch {
      setStatus('Сервер недоступен: локальные данные сброшены')
    }
  }

  async function logout() {
    try {
      await api.post('/api/auth/logout')
      setUser(null)
      setLoadedUserId(null)
      setCounts(emptyCounts())
      setHistory([])
      setStatus('')
    } catch {
      setStatus('Не удалось выйти: сервер недоступен')
    }
  }

  async function clearHistory() {
    if (!user) return
    localStorage.removeItem(`mama-prayer-history:${user.id}`)
    setHistory([])
    try {
      await api.delete('/api/prayers/history')
    } catch {
      setStatus('История очищена на устройстве, но не на сервере')
    }
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
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
                />
              </div>
            ))}
          </div>

          <div className="summary">
            <span>Всего ракаатов</span>
            <strong>{total}</strong>
          </div>

          <div className="actions">
            <Save onSave={save} />
            <button className="reset-button" type="button" onClick={reset}>
              Сбросить
            </button>
          </div>
          <p className="status" role="status">{status}</p>
          <StorList items={history} onClear={clearHistory} />
        </main>
      </div>
    </div>
  )
}

export default App
