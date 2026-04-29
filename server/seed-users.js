// seed-users.js
// Génère les hash bcrypt et insère les utilisateurs initiaux dans PostgreSQL.
//
//   node server/seed-users.js
//
// À lancer UNE SEULE FOIS après avoir créé la base avec schema.sql.

const { Pool } = require('pg')
const bcrypt   = require('bcryptjs')

const pg = new Pool({
  host:     process.env.PG_HOST,
  database: process.env.PG_DB,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
})

if (!process.env.PG_HOST || !process.env.PG_DB || !process.env.PG_USER || !process.env.PG_PASSWORD) {
  throw new Error('[seed-users] PG_HOST, PG_DB, PG_USER et PG_PASSWORD doivent être définis dans .env')
}

const USERS = [
  { username: 'raphou', password: 'raphou', role: 'admin' },
  { username: 'evan',   password: 'evan',   role: 'user'  },
]

async function seed() {
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10)
    await pg.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET password_hash = $2, role = $3`,
      [u.username, hash, u.role]
    )
    console.log(`✓ ${u.username} (${u.role}) inséré`)
  }
  await pg.end()
}

seed().catch((err) => { console.error(err); process.exit(1) })
