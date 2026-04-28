// server/rooms.js
// Centralise toute la logique de rooms Socket.IO :
//   - nommage des rooms (une seule source de vérité)
//   - suivi des membres en mémoire (carts connectés, utilisateurs assignés)
//   - helpers d'émission

class RoomManager {
  constructor(io) {
    this.io = io

    // cartId → socket du chariot (pour savoir si un chariot est en ligne)
    this._cartSockets = new Map()

    // cartId → userId actuellement assigné
    this._cartUsers = new Map()
  }

  // ── Noms des rooms (source de vérité unique) ────────────────────────────────

  cartRoom(cartId)     { return `cart:${cartId}` }
  userRoom(cartId)     { return `user_of:${cartId}` }
  get allCartsRoom()   { return 'carts' }
  get allAdminsRoom()  { return 'admins' }

  // ── Chariots ────────────────────────────────────────────────────────────────

  registerCart(socket, cartId) {
    socket.join(this.cartRoom(cartId))  //rej sa propre room
    socket.join(this.allCartsRoom)    //rej la room globale des chariots (pour les admins)
    this._cartSockets.set(cartId, socket)
    this.io.to(this.allAdminsRoom).emit('cart_online', { cartId, timestamp: Date.now() }) //notif admins qu'un chariot est en ligne
  }

  unregisterCart(cartId) {
    this._cartSockets.delete(cartId)
    this._cartUsers.delete(cartId)
    this.io.to(this.allAdminsRoom).emit('cart_offline', { cartId })
  }

  isCartOnline(cartId) {
    return this._cartSockets.has(cartId)
  }

  // ── Utilisateurs ─────────────────────────────────────────────────────────────

  assignUser(socket, cartId, userId) {
    socket.join(this.userRoom(cartId))
    this._cartUsers.set(cartId, userId)
  }

  releaseUser(socket, cartId) {
    socket.leave(this.userRoom(cartId))
    this._cartUsers.delete(cartId)
  }

  getCartUser(cartId) {
    return this._cartUsers.get(cartId) ?? null
  }

  // ── Admins ──────────────────────────────────────────────────────────────────

  registerAdmin(socket) {
    socket.join(this.allAdminsRoom)
  }

  // ── Helpers d'émission ──────────────────────────────────────────────────────

  toCart(cartId, event, data)   { this.io.to(this.cartRoom(cartId)).emit(event, data) }
  toUser(cartId, event, data)   { this.io.to(this.userRoom(cartId)).emit(event, data) }
  toAdmins(event, data)         { this.io.to(this.allAdminsRoom).emit(event, data) }
}

module.exports = RoomManager
