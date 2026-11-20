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
      completedCount: Number.isSafeInteger(saved?.completedCount) &&
        saved.completedCount >= 0
        ? saved.completedCount
        : 0,
      history: Array.isArray(history) ? history : [],
    }
  } catch {
    return {
      counts: emptyCounts(),
      targetCount: 0,
      completedCount: 0,
      history: [],
    }
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [counts, setCounts] = useState(emptyCounts)
  const [targetCount, setTargetCount] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [saving, setSaving] = useState(false)
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
        setCompletedCount(data.completedCount ?? localData.completedCount)
        setHistory(Array.isArray(data.history) ? data.history : localData.history)
        if (data.counts) setStatus('Данные загружены из PostgreSQL')
      } catch {
        if (active) {
          setCounts(localData.counts)
          setTargetCount(localData.targetCount)
          setCompletedCount(localData.completedCount)
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
    if (!user || saving) return
    const batchCounts = counts
    const batchTotal = Object.values(batchCounts).reduce((sum, value) => sum + value, 0)
    const savedAt = new Date().toISOString()
    const storageKey = `mama-prayer-counter:${user.id}`
    const historyKey = `mama-prayer-history:${user.id}`
    const localRecord = { counts: batchCounts, savedAt }
    const localHistory = batchTotal > 0
      ? [localRecord, ...history].slice(0, 10)
      : history
    const nextCompletedCount = completedCount + batchTotal
    const nextCounts = emptyCounts()

    setSaving(true)
    setCounts(nextCounts)
    setCompletedCount(nextCompletedCount)
    setHistory(localHistory)
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        counts: nextCounts,
        targetCount,
        completedCount: nextCompletedCount,
        savedAt,
      }))
      localStorage.setItem(historyKey, JSON.stringify(localHistory))
    } catch {
      // The server remains the primary storage if the browser cache is unavailable.
    }

    try {
      const { data } = await api.put('/api/prayers', {
        counts: batchCounts,
        targetCount,
      })
      const nextHistory = data.savedBatch
        ? [data.savedBatch, ...history].slice(0, 10)
        : history
      setCounts(data.counts ?? nextCounts)
      setCompletedCount(data.completedCount)
      setTargetCount(data.targetCount)
      setHistory(nextHistory)
      try {
        localStorage.setItem(storageKey, JSON.stringify(data))
        localStorage.setItem(historyKey, JSON.stringify(nextHistory))
      } catch {
        // Server save succeeded; only the optional browser cache could not update.
      }
      setStatus('Партия сохранена в PostgreSQL')
    } catch {
      setStatus('Сервер недоступен: партия сохранена только в кэше браузера')
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (!user) return
    const nextCounts = emptyCounts()
    setCounts(nextCounts)
    try {
      localStorage.setItem(
        `mama-prayer-counter:${user.id}`,
        JSON.stringify({ counts: nextCounts, targetCount, completedCount }),
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
    setCompletedCount(0)
    setHistory([])
    try {
      localStorage.removeItem(`mama-prayer-history:${user.id}`)
      localStorage.setItem(
        `mama-prayer-counter:${user.id}`,
        JSON.stringify({ counts, targetCount, completedCount: 0 }),
      )
    } catch {
      setStatus('Локальный кэш не удалось очистить')
    }
    try {
      await api.delete('/api/prayers/history')
      setStatus('История и сохранённый прогресс очищены')
    } catch {
      setStatus('Сервер недоступен: история очищена только в браузере')
    }
  }

  async function deleteSave(item) {
    if (!user) return
    const savedCount = Object.values(item.counts).reduce(
      (sum, value) => sum + value,
      0,
    )
    let nextCompletedCount

    if (item.id) {
      try {
        const { data } = await api.delete(`/api/prayers/history/${item.id}`)
        nextCompletedCount = data.completedCount
      } catch {
        setStatus('Не удалось удалить сохранение с сервера')
        return
      }
    } else {
      nextCompletedCount = Math.max(0, completedCount - savedCount)
    }

    const nextHistory = history.filter((record) => (
      item.id
        ? String(record.id) !== String(item.id)
        : record.savedAt !== item.savedAt
    ))
    setHistory(nextHistory)
    setCompletedCount(nextCompletedCount)
    try {
      localStorage.setItem(
        `mama-prayer-counter:${user.id}`,
        JSON.stringify({ counts, targetCount, completedCount: nextCompletedCount }),
      )
      localStorage.setItem(
        `mama-prayer-history:${user.id}`,
        JSON.stringify(nextHistory),
      )
      setStatus('Сохранение удалено')
    } catch {
      setStatus('Сохранение удалено, но локальный кэш не обновлён')
    }
  }

  async function logout() {
    try {
      await api.post('/api/auth/logout')
      setUser(null)
      setLoadedUserId(null)
      setCounts(emptyCounts())
      setTargetCount(0)
      setCompletedCount(0)
      setHistory([])
      setStatus('')
    } catch {
      setStatus('Не удалось выйти: сервер недоступен')
    }
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const totalDone = completedCount + total
  const remaining = Math.max(0, targetCount - totalDone)
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
                  disabled={dataLoading || saving}
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
              disabled={dataLoading || saving}
            />
          </div>

          <div className="summary">
            <span>Всего сделано намазов</span>
            <strong>{totalDone}</strong>
          </div>

          <div className="actions">
            <Save onSave={save} disabled={dataLoading || saving} />
            <button
              className="reset-button"
              type="button"
              onClick={reset}
              disabled={dataLoading || saving}
            >
              Сбросить
            </button>
          </div>
          <p className="status" role="status">{status}</p>
          <StorList
            items={dataLoading ? [] : history}
            onClear={clearHistory}
            onDelete={deleteSave}
            showClear={completedCount > 0}
          />
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
