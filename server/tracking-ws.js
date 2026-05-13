// server/tracking-ws.js
// Client WebSocket qui se connecte au serveur caméra (Python/RPi) sur :
//   ws://<CAMERA_WS_URL>/data   (ex: ws://192.168.1.42:8001/data)
//
// Format des données reçues :
//   { mode: "idle"|"registering"|"tracking", persons: [{is_target, distance, angle, conf, similarity}] }
//
// Les commandes de mouvement sont injectées dans la file batch du chariot C-042
// via rooms.enqueueCmd(), envoyées au prochain flush (event "cmd").

const WebSocket = require('ws')

const CART_ID         = 'C-042'
const RECONNECT_MS    = 3000   // délai avant reconnexion automatique

// ── Paramètres de suivi ────────────────────────────────────────────────────────
const TARGET_DIST     = 1.5  // m — distance idéale de suivi (le chariot s'arrête ici)
const MAX_DIST        = 3.5  // m — au-delà, vitesse maximale
const MIN_DIST        = 0.8  // m — arrêt de sécurité si la cible est trop proche
const ANGLE_DEAD_ZONE = 2    // ° — zone morte : pas de rotation en-dessous de ce seuil
const MIN_CONF        = 0.85  // seuil de confiance minimal pour agir sur une détection
const MAX_ANGLE       = 30   // ° — angle max pour la rotation (au-delà, on tourne à fond)

const MAX_SPEED = 50  // valeur max envoyée au chariot (0–50)

// ── Calcul de la commande de mouvement ────────────────────────────────────────
// Retourne { speed, angular } normalisés en 0–1 (usage interne)
function computeCmd(target) {
  const { distance, angle, conf } = target

  if (conf < MIN_CONF) return { speed: 0, angular: 0 }

  let speed = 0
  if (distance > TARGET_DIST) {
    speed = Math.min(1, (distance - TARGET_DIST) / (MAX_DIST - TARGET_DIST))
  }
  if (distance < MIN_DIST) speed = 0  // arrêt de sécurité
  speed = Math.round(speed * MAX_SPEED)  // normalisation en 0–MAX_SPEED pour le chariots

  // angle positif = cible à droite → angular négatif → 'right'
  // angle négatif = cible à gauche → angular positif → 'left'
  let angular = 0
  if (Math.abs(angle) > ANGLE_DEAD_ZONE) {
    angular = Math.max(-1, Math.min(1, -angle / MAX_ANGLE))
  }

  return { speed, angular }
}

// ── Injection des commandes directionnelles dans la file batch ────────────────
// speed : 0–MAX_SPEED (déjà scalé par computeCmd)
// angular : -1–+1  (positif = gauche, négatif = droite)
function enqueueMove(rooms, speed, angular) {
  if (speed === 0 && angular === 0) {
    rooms.enqueueCmd(CART_ID, 'move', ['stop'])
    return
  }
  if (angular !== 0) {
    const direction = angular > 0 ? 'left' : 'right'
    const diff = Math.round(Math.abs(angular) * MAX_SPEED)
    rooms.enqueueCmd(CART_ID, 'move', [direction, speed, diff])
  } else {
    rooms.enqueueCmd(CART_ID, 'move', ['forward', speed])
  }
}

// ── Connexion au serveur caméra avec reconnexion automatique ──────────────────
function initTrackingWs(rooms) {
  const CAMERA_WS_URL = process.env.CAMERA_WS_URL
  if (!CAMERA_WS_URL) {
    console.warn('[tracking-ws] CAMERA_WS_URL non défini dans .env — tracking désactivé')
    return
  }

  function connect() {
    const url = `${CAMERA_WS_URL}/data`
    console.log(`[tracking-ws] Connexion à ${url}…`)
    const ws = new WebSocket(url)

    ws.on('open', () => {
      console.log('[tracking-ws] Connecté au serveur caméra')
      rooms.toAdmins('tracking_status', { cartId: CART_ID, online: true })
    })

    ws.on('message', (raw) => {
      let data
      try { data = JSON.parse(raw) } catch { return }

      const { mode, persons = [] } = data
      console.log(`[tracking-ws] mode=${mode} | ${persons.length} personne(s)`)

      rooms.toAdmins('tracking_update', { cartId: CART_ID, mode, persons })

      if (!rooms.isCartOnline(CART_ID)) return

      if (mode !== 'tracking') {
        enqueueMove(rooms, 0, 0)
        return
      }

      const target = persons.find(p => p.is_target)
      if (!target) {
        enqueueMove(rooms, 0, 0)
        return
      }

      const cmd = computeCmd(target)
      enqueueMove(rooms, cmd.speed, cmd.angular)
    })

    ws.on('close', () => {
      console.log('[tracking-ws] Déconnecté du serveur caméra — reconnexion dans', RECONNECT_MS, 'ms')
      rooms.toAdmins('tracking_status', { cartId: CART_ID, online: false })
      if (rooms.isCartOnline(CART_ID)) {
        enqueueMove(rooms, 0, 0)
      }
      setTimeout(connect, RECONNECT_MS)
    })

    ws.on('error', (err) => {
      console.error('[tracking-ws] Erreur:', err.message)
      // 'close' sera émis après, la reconnexion se fait là
    })
  }

  connect()
}

module.exports = { initTrackingWs }
