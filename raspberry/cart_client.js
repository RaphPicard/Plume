// raspberry/cart_client.js
// Script principal du chariot Raspberry Pi.
// À lancer au démarrage de la carte : node cart_client.js
//
// Dépendances : npm install socket.io-client node-fetch
// (node-fetch uniquement si Node < 18 ; Node 18+ a fetch natif)

const { io }    = require('socket.io-client')
const { SERVER_URL, CART_ID, CART_SECRET, SENSOR_INTERVAL_MS } = require('./config')

const { readIMU }      = require('./sensors/imu')
const { readWeight }   = require('./sensors/weight')
const { readBattery }  = require('./sensors/battery')
const { readDistance } = require('./sensors/distance')

// ── 1. Récupérer le JWT auprès du serveur ────────────────────────────────────

async function fetchToken() {
  const res = await fetch(`${SERVER_URL}/cart-token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ cartId: CART_ID, cartSecret: CART_SECRET }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Impossible d'obtenir le token : ${err.error || res.status}`)
  }
  const { token } = await res.json()
  return token
}

// ── 2. Connexion WebSocket + boucle capteurs ─────────────────────────────────

async function main() {
  let token
  try {
    token = await fetchToken()
    console.log(`[auth] Token JWT obtenu pour ${CART_ID}`)
  } catch (err) {
    console.error('[auth]', err.message)
    process.exit(1)
  }

  const socket = io(SERVER_URL, {
    auth: { token },
    reconnection:        true,
    reconnectionDelay:   2000,
    reconnectionDelayMax:30000,
    reconnectionAttempts:Infinity,
  })

  let tracking     = false   // true dès que start_tracking reçu
  let sensorTimer  = null
  let speed        = 0       // vitesse courante (m/s), modifiée par les commandes

  // ── Connexion établie ───────────────────────────────────────────────────────
  socket.on('connect', () => {
    console.log(`[ws] Connecté au serveur (id=${socket.id})`)
    startSensorLoop()
  })

  // ── Reconnexion après coupure ───────────────────────────────────────────────
  socket.on('reconnect', (attempt) => {
    console.log(`[ws] Reconnecté après ${attempt} tentative(s)`)
    startSensorLoop()
  })

  socket.on('disconnect', (reason) => {
    console.warn('[ws] Déconnecté :', reason)
    stopSensorLoop()
  })

  socket.on('connect_error', (err) => {
    console.error('[ws] Erreur connexion :', err.message)
  })

  // ── Commandes reçues du serveur ─────────────────────────────────────────────
  socket.on('cmd', (cmd) => {
    console.log('[cmd]', cmd)
    switch (cmd.action) {
      case 'start_tracking':
        tracking = true
        console.log('→ Suivi démarré')
        break

      case 'stop_tracking':
      case 'stop':
        tracking = false
        speed    = 0
        stopMotors()
        break

      case 'move':
        if (tracking) move(cmd.direction)
        break

      case 'return_to_base':
        tracking = false
        speed    = 0
        returnToBase()
        break
    }
  })

  // ── Boucle d'envoi des capteurs ─────────────────────────────────────────────

  function startSensorLoop() {
    if (sensorTimer) return  // déjà lancée
    sensorTimer = setInterval(() => {
      const battery = readBattery()

      // Retour automatique à la base si batterie critique
      if (battery <= 5 && tracking) {
        console.warn('[batterie] Niveau critique — retour à la base')
        socket.emit('cmd', { action: 'return_to_base' })  // se signale à lui-même pour cohérence
        tracking = false
        returnToBase()
      }

      const imu      = readIMU()
      const distance = readDistance()

      // Détecter les obstacles et émettre une alerte
      if (distance < 30) {
        const severity = distance < 15 ? 'critical' : 'warning'
        socket.emit('obstacle_alert', { severity, distanceCm: distance })
      }

      // Données capteurs → serveur
      socket.emit('sensor_data', {
        weightKg:   readWeight(),
        batteryPct: battery,
        speedMs:    tracking ? speed : 0,
        ...imu,
      })

      // Position simulée (à remplacer par lecture GPS/UWB réelle)
      if (tracking) {
        socket.emit('position_update', {
          x: +(Math.random() * 100).toFixed(1),
          y: +(Math.random() * 100).toFixed(1),
        })
      }
    }, SENSOR_INTERVAL_MS)
  }

  function stopSensorLoop() {
    if (sensorTimer) {
      clearInterval(sensorTimer)
      sensorTimer = null
    }
  }
}

// ── 3. Contrôle des moteurs (stubs GPIO) ─────────────────────────────────────
// Remplacer ces fonctions par les appels GPIO réels (onoff, pigpio, etc.)

function move(direction) {
  console.log(`→ Déplacement : ${direction}`)
  // Ex avec pigpio :
  //   motorLeft.write(direction === 'forward' || direction === 'right' ? 1 : 0)
  //   motorRight.write(direction === 'forward' || direction === 'left'  ? 1 : 0)
}

function stopMotors() {
  console.log('→ Moteurs arrêtés')
  // motorLeft.write(0) ; motorRight.write(0)
}

function returnToBase() {
  console.log('→ Retour à la base (navigation autonome à implémenter)')
  // Ici : logique de navigation autonome ou simple arrêt moteurs
  stopMotors()
}

// ── Démarrage ─────────────────────────────────────────────────────────────────
main()
