// seed-users.js
// Génère les hash bcrypt et insère les utilisateurs initiaux dans PostgreSQL.
//
//   node server/seed-users.js
//
// À lancer UNE SEULE FOIS après avoir créé la base avec schema.sql.

const { Pool } = require('pg')
const bcrypt   = require('bcryptjs')

const pg = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  database: process.env.PG_DB       || 'plume',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || '',
})

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
