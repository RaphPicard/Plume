const fs = require('fs')
const path = require('path')

let loaded = false

function parseEnvFile(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    let value = trimmed.slice(equalsIndex + 1).trim()

    if (!key || process.env[key] !== undefined) continue

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

function loadEnv() {
  if (loaded) return
  loaded = true

  const envPath = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return

  parseEnvFile(fs.readFileSync(envPath, 'utf8'))
}

module.exports = { loadEnv }