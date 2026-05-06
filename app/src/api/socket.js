// src/api/socket.js
// Ce module gère la connexion WebSocket avec le serveur via Socket.IO
// Centralise les events et fonctions métiers simples
import { io } from 'socket.io-client'

const SERVER_URL = 'http://localhost:3000'

// Le socket est créé UNE seule fois (singleton)
// on le crée sans se connecter automatiquement
const socket = io(SERVER_URL, {
  autoConnect: false,  // on se connecte manuellement après login
})

let currentSocketToken = null

// --- Connexion / déconnexion ---

export function connectSocket(token) {  //appelé dans ScanView.vue après un login réussi (QR code ou manuel)
  if (socket.connected && currentSocketToken === token) {
    return Promise.resolve()
  }

  if (socket.connected) {
    socket.disconnect()
  }

  currentSocketToken = token
  socket.auth = { token }
  socket.connect()

  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve()
      return
    }

    const handleConnect = () => {
      cleanup()
      resolve()
    }

    const handleConnectError = (error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      socket.off('connect', handleConnect)
      socket.off('connect_error', handleConnectError)
    }

    socket.once('connect', handleConnect)
    socket.once('connect_error', handleConnectError)
  })
}

export function disconnectSocket() {
  currentSocketToken = null
  socket.disconnect()
}


// --- Actions utilisateur ---

export function unlockCart(cartId) {    // appelé dans ScanView.vue par handleUnlockCart, après le scan du QR code du chariot. Le serveur va vérifier que ce cartId est bien associé à l'utilisateur (via le token JWT) et va répondre si le déverrouillage est autorisé ou pas.
  return new Promise((resolve, reject) => {
    socket.emit('unlock_cart', { cartId }, (response) => {
      if (response.ok) resolve(response)
      else reject(new Error(response.error))
    })
  })
}

export function stopCart() {  //appelé dans TrackingView.vue par handleStopCart, quand l'utilisateur appuie sur le bouton "Terminer le trajet". Le serveur va marquer le chariot comme inactif et notifier les admins.
  return new Promise((resolve) => {
    socket.emit('stop_cart', {}, resolve)
  })
}


// --- Watch cart (pré-session) ---

export function watchCart(cartId) {
  socket.emit('watch_cart', { cartId })
}

export function unwatchCart(cartId) {
  socket.emit('unwatch_cart', { cartId })
}

export function onCartAvailability(callback) {
  socket.on('cart_availability', callback)
  return () => socket.off('cart_availability', callback)
}

// --- Pairing ---

export function requestPairing(cartId) {
  return new Promise((resolve, reject) => {
    socket.emit('request_pairing', { cartId }, (response) => {
      if (response.ok) resolve(response)
      else reject(new Error(response.error))
    })
  })
}

export function cancelPairing(cartId) {
  socket.emit('cancel_pairing', { cartId })
}

export function onPairingConfirmed(callback) {
  socket.once('pairing_confirmed', callback)
  return () => socket.off('pairing_confirmed', callback)
}

export function onPairingTimeout(callback) {
  socket.once('pairing_timeout', callback)
  return () => socket.off('pairing_timeout', callback)
}

// --- Écouter les events (retourne une fonction pour se désabonner) ---

export function onCartStatus(callback) {  //appelé dans ScanView.vue 
  socket.on('cart_status', callback)      // on s'ABONNE à l'event 'cart_status' envoyé par le serveur (dans events/user.js) pour recevoir les mises à jour du chariot assigné à l'utilisateur (position, capteurs, etc) et MAJ du store : cartStatus.value = status
  return () => socket.off('cart_status', callback) 
} // ecoute les data envoyé par le simulate-cart.js



export function onAlert(callback) { //appelé dans ScanView.vue 
  socket.on('alert', callback)
  return () => socket.off('alert', callback)  //.off = se désabonner de l'event 'cart_status' pour éviter les fuites de mémoire et les mises à jour indésirables quand le composant est démonté ou que l'utilisateur change de chariot
}

export function onConnected(callback) { //appelé dans ScanView.vue 
  socket.on('connect', callback)
  return () => socket.off('connect', callback)
}

export function onConnectError(callback) {    //appelé dans ScanView.vue
  socket.on('connect_error', callback)
  return () => socket.off('connect_error', callback)
}



// ----------------------------- ADMIN ---------------------------




// --- Listeners admin (retournent une fonction pour se désabonner) ---

export function onCartOnline(callback) {
  socket.on('cart_online', callback)
  return () => socket.off('cart_online', callback)
}

export function onCartOffline(callback) {
  socket.on('cart_offline', callback)
  return () => socket.off('cart_offline', callback)
}

export function onSensorUpdate(callback) {
  socket.on('sensor_update', callback)
  return () => socket.off('sensor_update', callback)
}

export function onCartPosition(callback) {
  socket.on('cart_position', callback)
  return () => socket.off('cart_position', callback)
}

// --- Listeners admin (suite) ---

export function onCartStatusUpdate(callback) {
  socket.on('cart_status_update', callback)
  return () => socket.off('cart_status_update', callback)
}

export function onKicked(callback) {
  socket.on('kicked', callback)
  return () => socket.off('kicked', callback)
}

// --- Actions admin ---

export function getFleet() {
  return new Promise((resolve) => {
    socket.emit('admin:get_fleet', {}, (response) => resolve(response.carts))
  })
}

export function adminKickCart(cartId) {
  socket.emit('admin:kick_cart', { cartId })
}

export function adminForceStop(cartId) {
  socket.emit('admin:force_stop', { cartId })
}

export function adminMove(cartId, direction) {
  // direction: 'forward' | 'backward' | 'left' | 'right' | 'stop'
  socket.emit('admin:move', { cartId, direction })  //l'event admin:move est dans server/events/admin.js, c'est lui qui va envoyer les commandes de mouvement au simulate-cart.js
}

export function adminRecall(cartId) {
  socket.emit('admin:recall', { cartId })
}