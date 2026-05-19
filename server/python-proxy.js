// server/python-proxy.js
// Proxy WebSocket : se connecte au serveur Python (CAMERA_WS_URL/command depuis .env)
// et relaie tous les messages aux clients via Socket.IO.

const WebSocket = require('ws')

const PYTHON_WS_URL = `${process.env.CAMERA_WS_URL || 'ws://100.81.175.3:8001'}/command`
const RECONNECT_DELAY_MS = 3000

let pythonWs = null
let _io = null

function init(io) {
  _io = io
  connect()
}

function connect() {
  console.log('[python-proxy] Connexion à', PYTHON_WS_URL)
  pythonWs = new WebSocket(PYTHON_WS_URL)

  pythonWs.on('open', () => {
    console.log('[python-proxy] Connecté au serveur Python')
    // Reset le tracking au démarrage / à la reconnexion
    pythonWs.send(JSON.stringify({ cmd: 'reset' }))
    console.log('[python-proxy] Commande reset envoyée au démarrage')
  })

  pythonWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      console.log('[python-proxy] Message:', msg)
      // Broadcast à tous les clients connectés
      if (_io) _io.emit('command_status', msg)
    } catch (e) {
      console.error('[python-proxy] Parse error:', e.message)
    }
  })

  pythonWs.on('close', () => {
    console.log(`[python-proxy] Déconnecté. Reconnexion dans ${RECONNECT_DELAY_MS}ms`)
    setTimeout(connect, RECONNECT_DELAY_MS)
  })

  pythonWs.on('error', (err) => {
    console.error('[python-proxy] Erreur:', err.message)
  })
}

// Envoie une commande JSON au serveur Python via le WebSocket
function sendCommand(cmd) {
  if (!pythonWs || pythonWs.readyState !== WebSocket.OPEN) {
    console.warn('[python-proxy] WS non connecté, commande ignorée:', cmd)
    return false
  }
  try {
    pythonWs.send(JSON.stringify(cmd))
    console.log('[python-proxy] Commande envoyée:', cmd)
    return true
  } catch (e) {
    console.error('[python-proxy] Erreur envoi commande:', e.message)
    return false
  }
}

module.exports = { init, sendCommand }
