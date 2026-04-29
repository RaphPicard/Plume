// server/db.js
//
// Deux bases de données :
//   • Redis     — état temps-réel des chariots (rapide, clé/valeur)
//   • PostgreSQL — persistance : utilisateurs, registre des chariots
//
// Toute la logique reste ici ; le reste du code ne change pas.

// avant c'était codé en dur :
// const carts = {
//   'C-042': { ownerId: null, status: 'available' },
//   'C-001': { ownerId: null, status: 'available' },
//   'C-002': { ownerId: null, status: 'available' },
// }

const { Pool } = require('pg')
const Redis    = require('ioredis')

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pg = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB       || 'plume',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || '',
})

// ── Redis ─────────────────────────────────────────────────────────────────────
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
})

redis.on('error', (err) => console.error('[Redis]', err.message))
pg.on('error',   (err) => console.error('[PG]',    err.message))

// ─────────────────────────────────────────────────────────────────────────────
// Chariots  (état temps-réel dans Redis)
// Clé Redis : "cart:<cartId>"  →  JSON { ownerId, status }
// ─────────────────────────────────────────────────────────────────────────────

// ---- Lecture d'un chariot ----
async function getCartState(cartId) {
  const raw = await redis.get(`cart:${cartId}`)
  if (raw) return JSON.parse(raw)

  // Redis ne connaît pas encore ce chariot : vérifier qu'il existe en PostgreSQL
  const { rows } = await pg.query('SELECT cart_id FROM carts WHERE cart_id = $1', [cartId])
  if (rows.length === 0) return null

  // Le chariot existe mais n'a pas encore d'état Redis → disponible par défaut
  return { ownerId: null, status: 'available' }
}

// ---- Lier un utilisateur à un chariot ----
async function setCartOwner(cartId, userId) {
  await redis.set(`cart:${cartId}`, JSON.stringify({ ownerId: userId, status: 'in_use' }))
}

// ---- Libérer un chariot ----
async function clearCartOwner(cartId) {
  await redis.set(`cart:${cartId}`, JSON.stringify({ ownerId: null, status: 'available' }))
}

// ---- Liste complète (pour le dashboard admin) ----
// Les IDs officiels viennent de PostgreSQL ; l'état courant vient de Redis.
async function getAllCarts() {
  const { rows } = await pg.query('SELECT cart_id FROM carts ORDER BY cart_id')

  return Promise.all(
    rows.map(async ({ cart_id }) => {
      const raw   = await redis.get(`cart:${cart_id}`)
      const state = raw ? JSON.parse(raw) : { ownerId: null, status: 'available' }
      return { cartId: cart_id, ...state }
    })
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilisateurs  (PostgreSQL)
// ─────────────────────────────────────────────────────────────────────────────

// Retourne { id, username, password_hash, role } ou null
async function getUserByUsername(username) {
  const { rows } = await pg.query(
    'SELECT id, username, password_hash, role FROM users WHERE username = $1',  // INJECTION SQL ???
    [username]
  )
  return rows[0] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { getCartState, setCartOwner, clearCartOwner, getAllCarts, getUserByUsername }
