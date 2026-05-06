// Events côté app mobile
// server/events/user.js

const { getCartState, setCartOwner, clearCartOwner } = require('../db')

let _rooms = null
let _io = null

function init(io, rooms) {
  _rooms = rooms
  _io = io
}

// cartId → { userId, socketId, timer }
const _pairingPending = new Map()

function registerUserEvents(io, socket, rooms) {
  const { userId } = socket.data

  // --- Watch cart (pré-session — CartUnlockView) ---
  socket.on('watch_cart', ({ cartId }) => {
    rooms.watchCart(socket, cartId)
    socket.data.watchingCartId = cartId
  })

  socket.on('unwatch_cart', ({ cartId }) => {
    rooms.unwatchCart(socket, cartId)
    socket.data.watchingCartId = null
  })

  // --- Annulation du pairing ---
  socket.on('cancel_pairing', ({ cartId }) => {
    const pending = _pairingPending.get(cartId)
    if (!pending || pending.userId !== userId) return

    clearTimeout(pending.timer)
    _pairingPending.delete(cartId)
    rooms.setCartStatus(cartId, 'available')
    _io.to(rooms.watcherRoom(cartId)).emit('cart_availability', {
      cartId, online: true, batteryPct: rooms.getCachedBattery(cartId), status: 'available',
    })
  })

  // --- Demande de pairing (nouveau flow QR) ---
  socket.on('request_pairing', async ({ cartId }, callback) => {
    try {
      const cart = await getCartState(cartId)
      if (!cart) return callback({ ok: false, error: 'Chariot introuvable' })
      if (cart.ownerId) return callback({ ok: false, error: 'Chariot déjà utilisé' })
      if (!rooms.isCartOnline(cartId)) return callback({ ok: false, error: 'Chariot hors ligne' })

      // Annuler un pairing existant pour ce chariot
      if (_pairingPending.has(cartId)) {
        clearTimeout(_pairingPending.get(cartId).timer)
      }

      const timer = setTimeout(() => {
        const pending = _pairingPending.get(cartId)
        if (!pending) return
        _pairingPending.delete(cartId)
        rooms.setCartStatus(cartId, 'available')
        _io.to(pending.socketId).emit('pairing_timeout', { cartId })
      }, 60_000)

      _pairingPending.set(cartId, { userId, socketId: socket.id, timer })
      rooms.setCartStatus(cartId, 'pairing_pending')
      rooms.enqueueCmd(cartId, 'pairing_mode', [])

      callback({ ok: true, cartId })
    } catch (err) {
      console.error('[request_pairing]', err.message)
      callback({ ok: false, error: 'Erreur serveur : ' + err.message })
    }
  })

  // --- Déverrouillage direct (conservé pour ScanView) ---
  socket.on('unlock_cart', async ({ cartId }, callback) => {
    try {
      const cart = await getCartState(cartId)

      if (!cart) return callback({ ok: false, error: 'Chariot introuvable' })
      if (cart.ownerId) return callback({ ok: false, error: 'Chariot déjà utilisé' })

      await setCartOwner(cartId, userId)

      rooms.assignUser(socket, cartId, userId)
      socket.data.activeCartId = cartId

      rooms.setCartStatus(cartId, 'paired')
      rooms.enqueueCmd(cartId, 'start_tracking', [])

      callback({ ok: true, cartId })
    } catch (err) {
      console.error('[unlock_cart]', err.message)
      callback({ ok: false, error: 'Erreur serveur : ' + err.message })
    }
  })

  // --- Arrêt du suivi ---
  socket.on('stop_cart', async (_, callback) => {
    const cartId = socket.data.activeCartId
    if (!cartId) return callback({ ok: false, error: 'Pas de chariot actif' })

    await clearCartOwner(cartId)
    rooms.releaseUser(socket, cartId)
    socket.data.activeCartId = null

    rooms.setCartStatus(cartId, 'available')
    rooms.enqueueCmd(cartId, 'stop_tracking', [])

    callback({ ok: true })
  })

  // Nettoyage si l'utilisateur se déconnecte brutalement
  socket.on('disconnect', async () => {
    const cartId = socket.data.activeCartId
    if (cartId) {
      await clearCartOwner(cartId)
      rooms.releaseUser(socket, cartId)   // nettoie _cartUsers avant setCartStatus pour que cart_status_update soit émis avec ownerId: null
      rooms.setCartStatus(cartId, 'available')
      rooms.enqueueCmd(cartId, 'stop_tracking', [])
    }

    if (socket.data.watchingCartId) {
      rooms.unwatchCart(socket, socket.data.watchingCartId)
    }

    // Annuler tout pairing initié par ce socket
    for (const [cId, pending] of _pairingPending.entries()) {
      if (pending.socketId === socket.id) {
        clearTimeout(pending.timer)
        _pairingPending.delete(cId)
        rooms.setCartStatus(cId, 'available')
      }
    }
  })
}

async function confirmPairing(cartId) {
  if (!_rooms || !_io) throw new Error('[confirmPairing] Module non initialisé')

  const pending = _pairingPending.get(cartId)
  if (!pending) throw new Error(`Aucun pairing en attente pour le chariot ${cartId}`)

  clearTimeout(pending.timer)
  _pairingPending.delete(cartId)

  const { userId, socketId } = pending

  await setCartOwner(cartId, userId)

  const userSocket = _io.sockets.sockets.get(socketId)
  if (!userSocket) throw new Error(`Socket utilisateur ${socketId} déconnecté`)

  _rooms.unwatchCart(userSocket, cartId)
  userSocket.data.watchingCartId = null

  _rooms.assignUser(userSocket, cartId, userId)
  userSocket.data.activeCartId = cartId

  _rooms.setCartStatus(cartId, 'paired')
  _rooms.enqueueCmd(cartId, 'start_tracking', [])

  userSocket.emit('pairing_confirmed', { cartId, sessionStartTime: Date.now() })
}

module.exports = { registerUserEvents, init, confirmPairing }
