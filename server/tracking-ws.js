// server/tracking-ws.js
// WebSocket serveur sur le path /data : reçoit les données de tracking caméra
// et émet des commandes de mouvement directes vers le chariot concerné.
//
// Le serveur caméra (Python/RPi) se connecte à :
//   ws://<backend>:3000/data?cartId=C-001&secret=<CAMERA_SECRET>
//
// Format des données reçues :
//   { mode: "idle"|"registering"|"tracking", persons: [{is_target, distance, angle, conf, similarity}] }
//
// Commande émise vers le chariot (event "tracking_cmd") :
//   { speed: 0.0–1.0, angular: -1.0–1.0, mode }
//   speed   : vitesse linéaire avant (0 = arrêt)
//   angular : rotation (-1 = droite max, +1 = gauche max)

const { WebSocketServer } = require('ws')
const { parse: parseUrl }  = require('url')

// ── Paramètres de suivi ────────────────────────────────────────────────────────
const TARGET_DIST     = 1.5  // m — distance idéale de suivi (le chariot s'arrête ici)
const MAX_DIST        = 3.5  // m — au-delà, vitesse maximale
const MIN_DIST        = 0.8  // m — arrêt de sécurité si la cible est trop proche
const ANGLE_DEAD_ZONE = 8    // ° — zone morte : pas de rotation en-dessous de ce seuil
const MIN_CONF        = 0.5  // seuil de confiance minimal pour agir sur une détection

// ── Calcul de la commande de mouvement ────────────────────────────────────────
// Retourne { speed, angular } à partir des données d'une personne cible.
function computeCmd(target) {
  const { distance, angle, conf } = target

  if (conf < MIN_CONF) return { speed: 0, angular: 0 }

  // Vitesse linéaire : 0 à TARGET_DIST, proportionnelle jusqu'à MAX_DIST, plein gaz après
  let speed = 0
  if (distance > TARGET_DIST) {
    speed = Math.min(1, (distance - TARGET_DIST) / (MAX_DIST - TARGET_DIST))
  }
  if (distance < MIN_DIST) speed = 0  // arrêt de sécurité

  // Vitesse angulaire : angle négatif = cible à gauche → angular positif (tourner à gauche)
  let angular = 0
  if (Math.abs(angle) > ANGLE_DEAD_ZONE) {
    angular = Math.max(-1, Math.min(1, -angle / 45))
  }

  return { speed, angular }
}

// ── Initialisation du serveur WebSocket /data ─────────────────────────────────
function initTrackingWs(httpServer, rooms) {
  const CAMERA_SECRET = process.env.CAMERA_SECRET
  if (!CAMERA_SECRET) {
    console.warn('[tracking-ws] CAMERA_SECRET non défini dans .env — WebSocket /data désactivé')
    return
  }

  const wss = new WebSocketServer({ server: httpServer, path: '/data' })

  wss.on('connection', (ws, req) => {
    const { query } = parseUrl(req.url, true)
    const { cartId, secret } = query

    if (!cartId || secret !== CAMERA_SECRET) {
      ws.close(4001, 'Unauthorized')
      return
    }

    console.log(`[tracking-ws] Caméra connectée → chariot ${cartId}`)
    rooms.toAdmins('tracking_status', { cartId, online: true })

    ws.on('message', (raw) => {
      let data
      try { data = JSON.parse(raw) } catch { return }

      const { mode, persons = [] } = data

      // Diffuser l'état brut aux admins pour le monitoring
      rooms.toAdmins('tracking_update', { cartId, mode, persons })

      if (!rooms.isCartOnline(cartId)) return

      if (mode !== 'tracking') {
        // Hors suivi actif : arrêt immédiat du chariot
        rooms.io.to(rooms.cartRoom(cartId)).emit('tracking_cmd', { speed: 0, angular: 0, mode })
        return
      }

      const target = persons.find(p => p.is_target)
      if (!target) {
        // Suivi actif mais cible perdue : arrêt
        rooms.io.to(rooms.cartRoom(cartId)).emit('tracking_cmd', { speed: 0, angular: 0, mode })
        return
      }

      const cmd = computeCmd(target)
      rooms.io.to(rooms.cartRoom(cartId)).emit('tracking_cmd', { ...cmd, mode })
    })

    ws.on('close', () => {
      console.log(`[tracking-ws] Caméra déconnectée → chariot ${cartId}`)
      rooms.toAdmins('tracking_status', { cartId, online: false })
      // Sécurité : arrêt du chariot si la caméra se déconnecte inopinément
      if (rooms.isCartOnline(cartId)) {
        rooms.io.to(rooms.cartRoom(cartId)).emit('tracking_cmd', { speed: 0, angular: 0, mode: 'idle' })
      }
    })

    ws.on('error', (err) => {
      console.error(`[tracking-ws] Erreur caméra ${cartId}:`, err.message)
    })
  })

  console.log('[tracking-ws] WebSocket /data prêt')
}

module.exports = { initTrackingWs }
