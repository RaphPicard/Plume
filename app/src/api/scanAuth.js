// src/api/scanAuth.js
const SCAN_SESSION_KEY = 'scan_session'

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return atob(padded)
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    return JSON.parse(decodeBase64Url(parts[1]))
  } catch {
    return null
  }
}

export function saveScanSession(token) {
  localStorage.setItem(SCAN_SESSION_KEY, JSON.stringify({ token }))
}

export function getScanSession() {
  const raw = localStorage.getItem(SCAN_SESSION_KEY)
  if (!raw) return null

  try {
    const { token } = JSON.parse(raw)
    if (!token) return null

    const payload = decodeJwtPayload(token)
    if (!payload || payload.role !== 'user') return null
    if (payload.exp && Date.now() >= payload.exp * 1000) return null

    return { token, payload }
  } catch {
    return null
  }
}

export function clearScanSession() {
  localStorage.removeItem(SCAN_SESSION_KEY)
}
