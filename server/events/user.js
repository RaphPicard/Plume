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

// userId → { cartId, timer } — nettoyage différé pour absorber les refreshs
const _abandonTimers = new Map()
const SESSION_TTL_MS  = 30_000

// userId → cartId — persiste l'association même avant que le disconnect de l'ancien socket soit traité
const _userActiveCarts = new Map()

// userId → socketId — permet d'ignorer le disconnect d'un ancien socket quand le nouveau a déjà repris
const _activeSocketIds = new Map()


function registerUserEvents(io, socket, rooms) {
  const { userId } = socket.data

  // --- Restauration automatique de session après refresh ---
  let restoredCartId = null

  if (_abandonTimers.has(userId)) {
    const { cartId, timer } = _abandonTimers.get(userId)
    clearTimeout(timer)
    _abandonTimers.delete(userId)
    restoredCartId = cartId
  } else if (_userActiveCarts.has(userId)) {
    // Race condition : nouveau socket arrivé avant que le disconnect de l'ancien soit traité
    restoredCartId = _userActiveCarts.get(userId)
  }

  if (restoredCartId && rooms.isCartOnline(restoredCartId)) {
    rooms.assignUser(socket, restoredCartId, userId)
    socket.data.activeCartId = restoredCartId
    _activeSocketIds.set(userId, socket.id)
    // Préserver auto_tracking si le chariot y était déjà, sinon paired
    const currentStatus = rooms._cartStatus.get(restoredCartId)
    if (currentStatus !== 'auto_tracking') {
      rooms.setCartStatus(restoredCartId, 'paired')
    }
    // Informer l'utilisateur du status courant (pour que le bouton s'affiche correctement)
    rooms.toUser(restoredCartId, 'cart_status_update', {
      status: rooms._cartStatus.get(restoredCartId) ?? 'paired',
    })
  }

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
      _userActiveCarts.set(userId, cartId)
      _activeSocketIds.set(userId, socket.id)

      rooms.setCartStatus(cartId, 'paired')

      callback({ ok: true, cartId })
    } catch (err) {
      console.error('[unlock_cart]', err.message)
      callback({ ok: false, error: 'Erreur serveur : ' + err.message })
    }
  })

  // --- Passer en mode auto-tracking ---
  socket.on('start_auto_tracking', async (_, callback) => {
    const cartId = socket.data.activeCartId
    if (!cartId) return callback?.({ ok: false, error: 'Pas de chariot actif' })

    rooms.setCartStatus(cartId, 'auto_tracking')
    rooms.toUser(cartId, 'cart_status_update', { status: 'auto_tracking' })

    callback?.({ ok: true })
  })

  // --- Arrêt du suivi ---
  socket.on('stop_cart', async (_, callback) => {
    const cartId = socket.data.activeCartId
    if (!cartId) return callback({ ok: false, error: 'Pas de chariot actif' })

    await clearCartOwner(cartId)
    rooms.releaseUser(socket, cartId)
    socket.data.activeCartId = null
    _userActiveCarts.delete(userId)
    _activeSocketIds.delete(userId)

    rooms.setCartStatus(cartId, 'available')
    rooms.enqueueCmd(cartId, 'stop_tracking', [])

    callback({ ok: true })
  })

  // Nettoyage si l'utilisateur se déconnecte brutalement
  socket.on('disconnect', async () => {
    const cartId = socket.data.activeCartId
    if (cartId) {
      rooms.releaseUser(socket, cartId)

      // Si un nouveau socket a déjà repris la session, on n'ouvre pas de timer d'abandon
      if (_activeSocketIds.get(userId) !== socket.id) return

      const timer = setTimeout(async () => {
        _abandonTimers.delete(userId)
        _userActiveCarts.delete(userId)
        _activeSocketIds.delete(userId)
        await clearCartOwner(cartId)
        rooms.setCartStatus(cartId, 'available')
        rooms.enqueueCmd(cartId, 'stop_tracking', [])
      }, SESSION_TTL_MS)
      _abandonTimers.set(userId, { cartId, timer })
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
  _userActiveCarts.set(userId, cartId)
  _activeSocketIds.set(userId, userSocket.id)

  _rooms.setCartStatus(cartId, 'paired')

  userSocket.emit('pairing_confirmed', { cartId, sessionStartTime: Date.now() })
}

module.exports = { registerUserEvents, init, confirmPairing }
