// src/api/config.js
// Toutes les URLs et ports sont configurables via le fichier `.env` (variables VITE_*).
// Pour modifier, change `.env` et redémarre Vite — pas besoin de toucher au code.

const env = import.meta.env

// Détecte si on est dans Capacitor (app native iOS/Android via WebView).
// Dans ce cas, window.location.hostname ne pointe pas vers un vrai serveur :
// on doit utiliser une IP/host fixe configurée.
function isCapacitor() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
}

// ── Serveur Node.js ──────────────────────────────────────────────────────────
// Priorité :
// 1. VITE_NATIVE_SERVER_HOST si on est dans Capacitor (app iOS/Android)
// 2. VITE_SERVER_HOST si défini (force une cible spécifique)
// 3. window.location.hostname (utile depuis un navigateur mobile via Tailscale)
// 4. localhost en dernier recours
function getServerHost() {
  if (isCapacitor()) {
    return env.VITE_NATIVE_SERVER_HOST || '100.73.190.84'
  }
  if (env.VITE_SERVER_HOST) return env.VITE_SERVER_HOST
  const host = window.location.hostname
  if (!host || window.location.protocol === 'file:') return 'localhost'
  return host
}

const SERVER_PORT = env.VITE_SERVER_PORT || '3000'
export const SERVER_URL = `http://${getServerHost()}:${SERVER_PORT}`

// ── Serveur Python — API commandes (POST /command/register, WS /command, /data)
const VIDEO_HOST = env.VITE_VIDEO_HOST || '100.81.175.3'
const VIDEO_PORT = env.VITE_VIDEO_PORT || '8001'
export const VIDEO_URL = `http://${VIDEO_HOST}:${VIDEO_PORT}`
export const VIDEO_WS_URL = `ws://${VIDEO_HOST}:${VIDEO_PORT}`

// ── Serveur Python — streams MJPEG (/stream/raw, /stream/annotated)
const STREAM_HOST = env.VITE_STREAM_HOST || '100.81.175.3'
const STREAM_PORT = env.VITE_STREAM_PORT || '5500'
const STREAM_BASE = `http://${STREAM_HOST}:${STREAM_PORT}`
export const STREAM_URLS = {
  raw:       `${STREAM_BASE}/stream/raw`,
  annotated: `${STREAM_BASE}/stream/annotated`,
}
