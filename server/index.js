import 'dotenv/config'
import bcrypt from 'bcryptjs'
import connectPgSimple from 'connect-pg-simple'
import cors from 'cors'
import express from 'express'
import session from 'express-session'
import pg from 'pg'

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT) || 3001
const sessionSecret = process.env.SESSION_SECRET

if (
  !sessionSecret ||
  sessionSecret.length < 32 ||
  sessionSecret === 'replace-this-with-a-long-random-secret'
) {
  throw new Error('SESSION_SECRET must contain at least 32 characters')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.PGHOST
    ? {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      }
    : {}),
})

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json({ limit: '100kb' }))
const PgSession = connectPgSimple(session)
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}))

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_prayer_state (
      user_id BIGINT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_prayer_history (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      counts JSONB NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS user_prayer_history_user_saved_idx
      ON user_prayer_history (user_id, saved_at DESC);
  `)
}

function requireAuth(request, response, next) {
  if (!request.session.userId) {
    return response.status(401).json({ error: 'Требуется войти в аккаунт' })
  }
  next()
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok', database: 'postgres' })
  } catch (error) {
    response.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.post('/api/auth/register', async (request, response, next) => {
  const body = request.body ?? {}
  const email = typeof body.email === 'string'
    ? body.email.trim().toLowerCase()
    : ''
  const password = body.password

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return response.status(400).json({ error: 'Введите корректный email' })
  }
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    return response.status(400).json({
      error: 'Пароль должен содержать от 8 до 72 символов',
    })
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await pool.query(
      'INSERT INTO app_users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash],
    )
    await regenerateSession(request)
    request.session.userId = result.rows[0].id
    await saveSession(request)
    response.status(201).json({ user: result.rows[0] })
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ error: 'Этот email уже зарегистрирован' })
    }
    next(error)
  }
})

app.post('/api/auth/login', async (request, response, next) => {
  const body = request.body ?? {}
  const email = typeof body.email === 'string'
    ? body.email.trim().toLowerCase()
    : ''
  const password = body.password

  if (typeof password !== 'string') {
    return response.status(400).json({ error: 'Введите email и пароль' })
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash FROM app_users WHERE email = $1',
      [email],
    )
    const user = result.rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return response.status(401).json({ error: 'Неверный email или пароль' })
    }

    await regenerateSession(request)
    request.session.userId = user.id
    await saveSession(request)
    response.json({ user: { id: user.id, email: user.email } })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(
      'SELECT id, email FROM app_users WHERE id = $1',
      [request.session.userId],
    )
    if (!result.rows[0]) {
      await destroySession(request)
      return response.status(401).json({ error: 'Аккаунт не найден' })
    }
    response.json({ user: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    if (request.session.userId) await destroySession(request)
    response.clearCookie('connect.sid')
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use('/api/prayers', requireAuth)

app.get('/api/prayers', async (request, response, next) => {
  try {
    const [stateResult, historyResult] = await Promise.all([
      pool.query(`
        SELECT counts, saved_at
        FROM user_prayer_state
        WHERE user_id = $1
      `, [request.session.userId]),
      pool.query(`
        SELECT counts, saved_at
        FROM user_prayer_history
        WHERE user_id = $1
        ORDER BY saved_at DESC
        LIMIT 10
      `, [request.session.userId]),
    ])

    const state = stateResult.rows[0]
    response.json({
      counts: state?.counts ?? null,
      savedAt: state?.saved_at ?? null,
      history: historyResult.rows.map((item) => ({
        counts: item.counts,
        savedAt: item.saved_at,
      })),
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/prayers', async (request, response, next) => {
  const { counts } = request.body ?? {}
  const prayerNames = ['Фаджр', 'Зухр', 'Аср', 'Магриб', 'Иша', 'Витр']

  if (
    !counts ||
    typeof counts !== 'object' ||
    prayerNames.some(
      (name) => !Number.isInteger(counts[name]) || counts[name] < 0,
    )
  ) {
    return response.status(400).json({
      error: 'counts must contain non-negative integer values for every prayer',
    })
  }

  const savedAt = new Date()

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `
          INSERT INTO user_prayer_state (user_id, counts, saved_at)
          VALUES ($1, $2::jsonb, $3)
          ON CONFLICT (user_id) DO UPDATE
          SET counts = EXCLUDED.counts,
              saved_at = EXCLUDED.saved_at
        `,
        [request.session.userId, JSON.stringify(counts), savedAt],
      )
      await client.query(
        'INSERT INTO user_prayer_history (user_id, counts, saved_at) VALUES ($1, $2::jsonb, $3)',
        [request.session.userId, JSON.stringify(counts), savedAt],
      )
      await client.query(
        `
          DELETE FROM user_prayer_history
          WHERE id IN (
            SELECT id
            FROM user_prayer_history
            WHERE user_id = $1
            ORDER BY saved_at DESC
            OFFSET 10
          )
        `,
        [request.session.userId],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    response.json({ counts, savedAt })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/prayers', async (request, response, next) => {
  try {
    await pool.query('DELETE FROM user_prayer_state WHERE user_id = $1', [
      request.session.userId,
    ])
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.delete('/api/prayers/history', async (request, response, next) => {
  try {
    await pool.query('DELETE FROM user_prayer_history WHERE user_id = $1', [
      request.session.userId,
    ])
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
})

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`)
    })
  })
  .catch((error) => {
    console.error('PostgreSQL initialization failed:', error)
    process.exitCode = 1
  })