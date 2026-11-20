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
const PRAYER_NAMES = ['Фаджр', 'Зухр', 'Аср', 'Магриб', 'Иша', 'Витр']
const EMPTY_COUNTS = Object.fromEntries(PRAYER_NAMES.map((name) => [name, 0]))

function sumPrayerCounts(counts) {
  return PRAYER_NAMES.reduce((sum, name) => sum + Number(counts?.[name] ?? 0), 0)
}

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

const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin))
  },
  credentials: true,
}))
app.use(express.json({ limit: '100kb' }))
const PgSession = connectPgSimple(session)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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
      target_count BIGINT NOT NULL DEFAULT 0,
      completed_count BIGINT NOT NULL DEFAULT 0,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE user_prayer_state
      ADD COLUMN IF NOT EXISTS target_count BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE user_prayer_state
      ADD COLUMN IF NOT EXISTS completed_count BIGINT NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS user_prayer_history (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      counts JSONB NOT NULL,
      is_batch BOOLEAN NOT NULL DEFAULT FALSE,
      saved_at TIMESTAMPTZ NOT NULL
    );

    ALTER TABLE user_prayer_history
      ADD COLUMN IF NOT EXISTS is_batch BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS user_prayer_history_user_saved_idx
      ON user_prayer_history (user_id, saved_at DESC);

    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await migrateLegacyPrayerProgress()
}

async function migrateLegacyPrayerProgress() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const migration = await client.query(
      'SELECT 1 FROM app_migrations WHERE name = $1',
      ['saved-prayer-batches-v1'],
    )

    if (migration.rowCount === 0) {
      const historyResult = await client.query(`
        SELECT id, user_id, counts, saved_at
        FROM user_prayer_history
        ORDER BY user_id, saved_at, id
      `)
      const previousCounts = new Map()
      const completedByUser = new Map()

      for (const record of historyResult.rows) {
        const userId = String(record.user_id)
        const previous = previousCounts.get(userId)
        const batchCounts = {}
        for (const name of PRAYER_NAMES) {
          const current = Number(record.counts?.[name] ?? 0)
          batchCounts[name] = previous && current >= previous[name]
            ? current - previous[name]
            : current
        }
        previousCounts.set(userId, record.counts)
        completedByUser.set(
          userId,
          (completedByUser.get(userId) ?? 0) + sumPrayerCounts(batchCounts),
        )
        await client.query(
          `
            UPDATE user_prayer_history
            SET counts = $1::jsonb, is_batch = TRUE
            WHERE id = $2
          `,
          [JSON.stringify(batchCounts), record.id],
        )
      }

      const stateResult = await client.query(
        'SELECT user_id, counts FROM user_prayer_state',
      )
      const existingUsers = new Set()
      for (const state of stateResult.rows) {
        const userId = String(state.user_id)
        existingUsers.add(userId)
        const completedCount = completedByUser.has(userId)
          ? completedByUser.get(userId)
          : sumPrayerCounts(state.counts)
        await client.query(
          `
            UPDATE user_prayer_state
            SET counts = '{}'::jsonb, completed_count = $2::bigint
            WHERE user_id = $1
          `,
          [state.user_id, completedCount],
        )
      }

      for (const [userId, completedCount] of completedByUser) {
        if (existingUsers.has(userId)) continue
        const latest = historyResult.rows
          .filter((record) => String(record.user_id) === userId)
          .at(-1)
        await client.query(
          `
            INSERT INTO user_prayer_state (
              user_id, counts, target_count, completed_count, saved_at
            )
            VALUES ($1, '{}'::jsonb, 0, $2::bigint, $3)
          `,
          [userId, completedCount, latest?.saved_at ?? new Date()],
        )
      }

      await client.query(
        'INSERT INTO app_migrations (name) VALUES ($1)',
        ['saved-prayer-batches-v1'],
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
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
        SELECT counts, target_count, completed_count, saved_at
        FROM user_prayer_state
        WHERE user_id = $1
      `, [request.session.userId]),
      pool.query(`
        SELECT id, counts, saved_at
        FROM user_prayer_history
        WHERE user_id = $1
        ORDER BY saved_at DESC, id DESC
        LIMIT 10
      `, [request.session.userId]),
    ])

    const state = stateResult.rows[0]
    response.json({
      counts: { ...EMPTY_COUNTS, ...(state?.counts ?? {}) },
      targetCount: state ? Number(state.target_count) : null,
      completedCount: state ? Number(state.completed_count) : null,
      savedAt: state?.saved_at ?? null,
      history: historyResult.rows.map((item) => ({
        id: item.id,
        counts: item.counts,
        savedAt: item.saved_at,
      })),
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/prayers', async (request, response, next) => {
  const { counts, targetCount } = request.body ?? {}

  if (
    targetCount !== undefined &&
    (!Number.isSafeInteger(targetCount) || targetCount < 0)
  ) {
    return response.status(400).json({
      error: 'targetCount must be a non-negative safe integer',
    })
  }

  if (
    !counts ||
    typeof counts !== 'object' ||
    PRAYER_NAMES.some(
      (name) => !Number.isSafeInteger(counts[name]) || counts[name] < 0,
    )
  ) {
    return response.status(400).json({
      error: 'counts must contain non-negative safe integers for every prayer',
    })
  }

  const batchTotal = sumPrayerCounts(counts)
  if (!Number.isSafeInteger(batchTotal)) {
    return response.status(400).json({ error: 'The saved batch is too large' })
  }

  const savedAt = new Date()

  try {
    const client = await pool.connect()
    let historyRecord = null
    let state
    try {
      await client.query('BEGIN')
      const stateResult = await client.query(
        `
          INSERT INTO user_prayer_state (
            user_id, counts, target_count, completed_count, saved_at
          )
          VALUES ($1, '{}'::jsonb, COALESCE($2::bigint, 0), $3::bigint, $4)
          ON CONFLICT (user_id) DO UPDATE
          SET counts = '{}'::jsonb,
              target_count = COALESCE($2::bigint, user_prayer_state.target_count),
              completed_count = user_prayer_state.completed_count + $3::bigint,
              saved_at = EXCLUDED.saved_at
          RETURNING target_count, completed_count
        `,
        [request.session.userId, targetCount ?? null, batchTotal, savedAt],
      )
      state = stateResult.rows[0]
      if (batchTotal > 0) {
        const historyResult = await client.query(
          `
            INSERT INTO user_prayer_history (user_id, counts, is_batch, saved_at)
            VALUES ($1, $2::jsonb, TRUE, $3)
            RETURNING id, saved_at
          `,
          [request.session.userId, JSON.stringify(counts), savedAt],
        )
        historyRecord = historyResult.rows[0]
        await client.query(
          `
            DELETE FROM user_prayer_history
            WHERE id IN (
              SELECT id
              FROM user_prayer_history
              WHERE user_id = $1
              ORDER BY id DESC
              OFFSET 10
            )
          `,
          [request.session.userId],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    response.json({
      savedBatch: historyRecord
        ? {
            id: historyRecord.id,
            counts,
            savedAt: historyRecord.saved_at,
          }
        : null,
      counts: EMPTY_COUNTS,
      targetCount: Number(state.target_count),
      completedCount: Number(state.completed_count),
      savedAt: historyRecord?.saved_at ?? savedAt,
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/prayers', async (request, response, next) => {
  const { targetCount } = request.body ?? {}
  if (
    targetCount !== undefined &&
    (!Number.isSafeInteger(targetCount) || targetCount < 0)
  ) {
    return response.status(400).json({
      error: 'targetCount must be a non-negative safe integer',
    })
  }

  try {
    await pool.query(
      `
        INSERT INTO user_prayer_state (
          user_id, counts, target_count, completed_count, saved_at
        )
        VALUES ($1, '{}'::jsonb, COALESCE($2::bigint, 0), 0, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET counts = '{}'::jsonb,
            target_count = COALESCE($2::bigint, user_prayer_state.target_count),
            saved_at = NOW()
      `,
      [request.session.userId, targetCount ?? null],
    )
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.delete('/api/prayers/history/:historyId', async (request, response, next) => {
  const { historyId } = request.params
  if (!/^\d+$/.test(historyId)) {
    return response.status(400).json({ error: 'Invalid save id' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT user_id FROM user_prayer_state WHERE user_id = $1 FOR UPDATE',
      [request.session.userId],
    )
    const historyResult = await client.query(
      `
        SELECT counts, is_batch
        FROM user_prayer_history
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
      `,
      [historyId, request.session.userId],
    )
    if (!historyResult.rows[0]) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Сохранение не найдено' })
    }

    const record = historyResult.rows[0]
    const batchTotal = record.is_batch ? sumPrayerCounts(record.counts) : 0
    await client.query(
      'DELETE FROM user_prayer_history WHERE id = $1 AND user_id = $2',
      [historyId, request.session.userId],
    )
    if (batchTotal > 0) {
      await client.query(
        `
          UPDATE user_prayer_state
          SET completed_count = GREATEST(0, completed_count - $2::bigint)
          WHERE user_id = $1
        `,
        [request.session.userId, batchTotal],
      )
    }
    const stateResult = await client.query(
      'SELECT completed_count FROM user_prayer_state WHERE user_id = $1',
      [request.session.userId],
    )
    await client.query('COMMIT')
    response.json({
      completedCount: Number(stateResult.rows[0]?.completed_count ?? 0),
    })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

app.delete('/api/prayers/history', async (request, response, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT user_id FROM user_prayer_state WHERE user_id = $1 FOR UPDATE',
      [request.session.userId],
    )
    await client.query(
      'DELETE FROM user_prayer_history WHERE user_id = $1',
      [request.session.userId],
    )
    await client.query(
      'UPDATE user_prayer_state SET completed_count = 0 WHERE user_id = $1',
      [request.session.userId],
    )
    await client.query('COMMIT')
    response.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
})

initDatabase()
  .then(() => {
    app.listen(port, '127.0.0.1', () => {
      console.log(`Server running on http://localhost:${port}`)
    })
  })
  .catch((error) => {
    console.error('PostgreSQL initialization failed:', error)
    process.exitCode = 1
  })