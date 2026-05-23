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
    body:    JSON.stringify({ cartId: CART_ID, cartSecret: CART_SECRET }), // on définit le cart_id du raspberry Pi dans config.js, et on utilise le cartSecret partagé avec le serveur (CART_SECRET dans .env) pour obtenir un token JWT auprès du serveur (server/index.js : route POST /cart-token) en envoyant { cartId, cartSecret } et en recevant { token } si le secret est valide, ou une erreur sinon
  })
  // reponse donnée par le serveur dans server/index.js : res.json({ token }) ou res.status(401).json({ error: 'Secret invalide' })
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

  const socket = io(SERVER_URL, { // avant d'accepter la connexion, le serveur Socket.IO (server/index.js) appelle authMiddleware (server/auth.js) qui vérifie le token et extrait cartId pour authentifier le chariot
    auth: { token }, // token envoyé dans socket.handshake.auth (server/auth.js : authMiddleware) pour authentifier le chariot auprès du serveur WebSocket
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
    console.log('Commande reçue :', JSON.stringify(cmd, null, 2))
    for (const command of cmd.cmds) {
      switch (command.action) {
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

        case 'move': {
          const [direction, speed, diff] = command.args
          if (direction === 'stop') { stopMotors(); break }
          if (tracking) move(direction, speed, diff)
          break
        }

        case 'return_to_base':
          tracking = false
          speed    = 0
          returnToBase()
          break
    }
  }
})


  // ── Boucle d'envoi des capteurs ─────────────────────────────────────────────

  function startSensorLoop() {
    if (sensorTimer) return  // déjà lancée
    sensorTimer = setInterval(() => { //envoie périodiquement les données de capteurs au serveur tant que le suivi est actif, et gère les alertes (ex: obstacle, batterie faible) en temps réel
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

      // Détecter les obstacles et émettre une alerte (seuil : 50 cm)
      if (distance < 50) {
        const severity = distance < 25 ? 'critical' : 'warning'
        socket.emit('obstacle_alert', { severity, distanceCm: distance })
      }

      // Données capteurs → serveur
      socket.emit('sensor_data', { // on envoie les sensor_data et position_update au server (server/events/cart.js) qui les relaie aux utilisateurs et admins concernés ; les données de capteurs sont aussi envoyées aux admins via rooms.toAdmins pour qu'ils puissent voir les données de tous les chariots dans le dashboard admin
        weightKg:      readWeight(),
        batteryPct:    battery,
        speedMs:       tracking ? speed : 0,
        distanceToUser: +(distance / 100).toFixed(2),  // distance obstacle en mètres (HC-SR04)
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

function move(direction, speed = 0, diff = 0) {
  console.log(`→ Déplacement : ${direction}, vitesse=${speed}, diff=${diff}`)
  // GPIO (à brancher) :
  //   'forward'  : les deux moteurs à speed
  //   'backward' : les deux moteurs en arrière à speed
  //   'left'     : moteur droit à speed, moteur gauche à (speed - diff)
  //   'right'    : moteur gauche à speed, moteur droit à (speed - diff)
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
