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
// Vitesse linéaire selon la distance :
//   < FORWARD_MIN_DIST → vitesse 0 (arrêt + zone tampon)
//   >= FORWARD_MIN_DIST → vitesse MAX_SPEED (toujours plein gaz quand on avance)
const FORWARD_MIN_DIST = 1.0  // m — en-dessous: arrêt
const ANGLE_DEAD_ZONE  = 15   // ° — zone morte : en dessous on considère que la cible est en face
const MIN_CONF         = 0.75 // seuil de confiance minimal pour agir sur une détection
const MAX_ANGLE        = 35   // ° — angle max pour la rotation (au-delà, on tourne à fond)

const MAX_SPEED             = 50   // valeur max envoyée au chariot (0–50)
const TURN_SPEED_STATIONARY = 18   // vitesse de rotation sur place (cible proche, zone tampon)
const MIN_TURN_DIFF         = 6    // diff minimal pour garantir une rotation visible

// Vitesse de rotation en mouvement, plus douce quand la cible est loin
const TURN_SPEED_NEAR  = 25   // vitesse de rotation quand la cible est proche (~1m)
const TURN_SPEED_FAR   = 10   // vitesse de rotation quand la cible est loin (≥3m)
const TURN_DIST_NEAR   = 1.0  // m — distance à laquelle la rotation est max
const TURN_DIST_FAR    = 3.0  // m — distance à laquelle la rotation est min

// Vitesse linéaire : 0 si trop proche, MAX_SPEED sinon (toujours plein gaz)
function computeSpeed(distance) {
  if (distance < FORWARD_MIN_DIST) return 0
  return MAX_SPEED
}

// Vitesse de rotation en mouvement : plus douce quand la cible est loin
function computeTurnSpeed(distance) {
  if (distance <= TURN_DIST_NEAR) return TURN_SPEED_NEAR
  if (distance >= TURN_DIST_FAR)  return TURN_SPEED_FAR
  const ratio = (distance - TURN_DIST_NEAR) / (TURN_DIST_FAR - TURN_DIST_NEAR)
  return Math.round(TURN_SPEED_NEAR + (TURN_SPEED_FAR - TURN_SPEED_NEAR) * ratio)
}

// ── Calcul de la commande de mouvement ────────────────────────────────────────
function computeCmd(target) {
  const { distance, angle, conf } = target

  if (conf < MIN_CONF) return { speed: 0, angular: 0, turnSpeed: 0 }

  const speed = computeSpeed(distance)
  const turnSpeed = computeTurnSpeed(distance)

  // angle positif = cible à droite → angular négatif → 'right'
  // angle négatif = cible à gauche → angular positif → 'left'
  // Rotation linéaire entre ANGLE_DEAD_ZONE et MAX_ANGLE → 0 puis monte progressivement à 1
  let angular = 0
  if (Math.abs(angle) > ANGLE_DEAD_ZONE) {
    const adjustedAngle = Math.abs(angle) - ANGLE_DEAD_ZONE
    const range = MAX_ANGLE - ANGLE_DEAD_ZONE
    const sign = angle > 0 ? -1 : 1
    angular = sign * Math.min(1, adjustedAngle / range)
  }

  return { speed, angular, turnSpeed }
}

// ── Injection des commandes directionnelles dans la file batch ────────────────
// - Deduplication : on ne re-envoie pas la même commande deux fois de suite
// - Grace period sur les stops : on attend STOP_GRACE_FRAMES frames sans cible avant
//   de réellement stopper, pour absorber les pertes de détection ponctuelles.
// - Refresh périodique : même si la commande n'a pas changé, on la renvoie toutes
//   les CMD_REFRESH_MS pour garder le robot synchronisé (au cas où une trame se perd).
const STOP_GRACE_FRAMES = 5
const CMD_REFRESH_MS    = 1000
let lastCmdKey = null
let lastCmdTime = 0
let stopGraceCounter = 0

function enqueueIfChanged(rooms, action, args, cmdKey) {
  const now = Date.now()
  // Skip seulement si la commande est identique ET récente
  if (cmdKey === lastCmdKey && now - lastCmdTime < CMD_REFRESH_MS) return
  rooms.enqueueCmd(CART_ID, action, args)
  lastCmdKey = cmdKey
  lastCmdTime = now
}

// speed     : 0–MAX_SPEED (déjà scalé par computeCmd)
// angular   : -1–+1  (positif = gauche, négatif = droite)
// turnSpeed : vitesse de rotation à appliquer pendant les virages en mouvement
function enqueueMove(rooms, speed, angular, turnSpeed = 0) {
  if (speed === 0 && angular === 0) {
    stopGraceCounter++
    if (stopGraceCounter < STOP_GRACE_FRAMES) return  // on attend avant de stopper
    enqueueIfChanged(rooms, 'stop', [], 'stop')
    return
  }

  stopGraceCounter = 0  // reset dès qu'on bouge

  if (angular !== 0) {
    const direction = angular > 0 ? 'left' : 'right'
    // - cible proche (speed = 0) → rotation sur place à TURN_SPEED_STATIONARY
    // - cible en mouvement      → rotation à turnSpeed (plus doux quand cible loin)
    const effectiveSpeed = speed === 0
      ? TURN_SPEED_STATIONARY
      : turnSpeed
    const diff = Math.max(MIN_TURN_DIFF, Math.round(Math.abs(angular) * effectiveSpeed))
    enqueueIfChanged(rooms, 'move', [direction, effectiveSpeed, diff], `move:${direction}:${effectiveSpeed}:${diff}`)
  } else {
    enqueueIfChanged(rooms, 'move', ['forward', speed], `move:forward:${speed}`)
  }
}

// Permet de forcer un reset du dedup (quand on quitte auto_tracking par exemple)
function resetMoveDedup() {
  lastCmdKey = null
  lastCmdTime = 0
  stopGraceCounter = 0
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

      if (!rooms.isCartOnline(CART_ID)) return // guard : ne pas traiter les données si le chariot est hors ligne
      if (rooms.getCartStatus(CART_ID) !== 'auto_tracking'){ 
        resetMoveDedup() 
        return // guard : n'agir que si le mode de contrôle est auto_tracking
      }

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
      console.log(`[tracking-ws] cible — dist=${target.distance}m angle=${target.angle}° conf=${target.conf} → speed=${cmd.speed} angular=${cmd.angular.toFixed(2)}`)
      enqueueMove(rooms, cmd.speed, cmd.angular, cmd.turnSpeed)
    })

    ws.on('close', () => {
      console.log('[tracking-ws] Déconnecté du serveur caméra — reconnexion dans', RECONNECT_MS, 'ms')
      rooms.toAdmins('tracking_status', { cartId: CART_ID, online: false })
      // On ne stoppe le robot que s'il était en auto_tracking, sinon on touche pas à ce que l'admin envoie
      if (rooms.isCartOnline(CART_ID) && rooms.getCartStatus(CART_ID) === 'auto_tracking') {
        resetMoveDedup()
        rooms.enqueueCmd(CART_ID, 'stop', [])
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
