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

// --- Connexion / déconnexion ---

export function connectSocket(token) {  //appelé dans ScanView.vue après un login réussi (QR code ou manuel)
  socket.auth = { token }
  socket.connect()
}

export function disconnectSocket() {
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

// --- Écouter les events (retourne une fonction pour se désabonner) ---

export function onCartStatus(callback) {  //appelé dans ScanView.vue 
  socket.on('cart_status', callback)
  return () => socket.off('cart_status', callback)
} // ecoute les data envoyé par le simulate-cart.js



export function onAlert(callback) { //appelé dans ScanView.vue 
  socket.on('alert', callback)
  return () => socket.off('alert', callback)
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

// --- Actions admin ---

export function getFleet() {
  return new Promise((resolve) => {
    socket.emit('admin:get_fleet', {}, (response) => resolve(response.carts))
  })
}

export function adminForceStop(cartId) {
  socket.emit('admin:force_stop', { cartId })
}

export function adminMove(cartId, direction) {
  // direction: 'forward' | 'backward' | 'left' | 'right' | 'stop'
  socket.emit('admin:move', { cartId, direction })  //l'event admin:move est dans events/admin.js, c'est lui qui va envoyer les commandes de mouvement au simulate-cart.js
}

export function adminRecall(cartId) {
  socket.emit('admin:recall', { cartId })
}