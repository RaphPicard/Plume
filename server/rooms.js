// server/rooms.js
// Centralise toute la logique de rooms Socket.IO :
//   - nommage des rooms (une seule source de vérité)
//   - suivi des membres en mémoire (carts connectés, utilisateurs assignés)
//   - helpers d'émission
//   - file de commandes par chariot, flushée toutes les FLUSH_INTERVAL_MS


// Les différents types de rooms sont définis par des fonctions (cartRoom(cartId), userRoom(cartId)) ou des getters (allCartsRoom, allAdminsRoom) pour éviter les erreurs de nommage (typos)
// et avoir une source de vérité unique pour les noms de rooms. Par exemple, la room d'un chariot spécifique s'appelle toujours "cart:<cartId>" et la room globale des admins s'appelle toujours "admins".

const { randomUUID } = require('crypto')  // pour générer des IDs uniques pour les commandes (utile pour le suivi ACK/exec côté chariot)

const FLUSH_INTERVAL_MS = Number(process.env.CART_FLUSH_MS)  // intervalle de flush des commandes et alertes aux chariots (en ms) ; à ajuster selon les besoins (ex: 100ms pour une réactivité optimale, 500ms pour réduire la charge serveur)
if (!FLUSH_INTERVAL_MS) throw new Error('[rooms] CART_FLUSH_MS doit être défini dans .env')

class RoomManager {
  constructor(io) {
    this.io = io

    // cartId → socket du chariot (pour savoir si un chariot est en ligne)
    this._cartSockets = new Map()

    // cartId → userId actuellement assigné
    this._cartUsers = new Map()

    // cartId → 'available' | 'paired'  (état en mémoire, évite une lecture Redis à chaque flush)
    this._cartStatus = new Map()

    // cartId → [{id, action, args}]  commandes en attente d'envoi
    this._cmdQueues = new Map() // récupérable par le chartId via le flush périodique, et par les admins via l'event 'admin:get_fleet' pour voir les commandes en attente de chaque chariot

    // cartId → [string]  alertes en attente d'envoi
    this._alertQueues = new Map()

    // cartId → number  dernier pourcentage de batterie connu (pour snapshot avant session)
    this._cartBattery = new Map()

    this._flushTimer = setInterval(() => this._flushAll(), FLUSH_INTERVAL_MS)
  }

  // ── Noms des rooms (source de vérité unique) ────────────────────────────────

  cartRoom(cartId)     { return `cart:${cartId}` }
  userRoom(cartId)     { return `user_of:${cartId}` }
  watcherRoom(cartId)  { return `watchers:${cartId}` }
  get allCartsRoom()   { return 'carts' }
  get allAdminsRoom()  { return 'admins' }

  // ── Chariots ────────────────────────────────────────────────────────────────

  registerCart(socket, cartId) { // le raspberry appel cette fonction à sa connexion, pour être enregistré dans la room de son cartId et dans la room globale des chariots, et pour initialiser sa file de commandes et d'alertes
    socket.join(this.cartRoom(cartId)) // le chariot rejoint sa room dédiée (cart:cartId) pour recevoir les commandes et alertes qui lui sont destinées
    socket.join(this.allCartsRoom) // le chariot rejoint la room globale des chariots (carts) pour que les admins puissent le voir dans la flotte, même s'ils ne sont pas connectés à un chariot spécifique
    
    this._cartSockets.set(cartId, socket) // stocke la socket du chariot pour sle FLUSH périodique

    this._cmdQueues.set(cartId, []) // initialiser la file de commandes vide pour ce chariot
    this._alertQueues.set(cartId, [])
    if (!this._cartStatus.has(cartId)) this._cartStatus.set(cartId, 'available')

    console.log(`[cart_online] cartId="${cartId}" → room rejointe, admins notifiés, statut=available`)
    this.io.to(this.allAdminsRoom).emit('cart_online', { cartId, timestamp: Date.now() }) // cart_online est écouté dans le dashboard admin pour afficher les chariots connectés en temps réel
    this.io.to(this.watcherRoom(cartId)).emit('cart_availability', {
      cartId, online: true,
      batteryPct: this.getCachedBattery(cartId),
      status: this._cartStatus.get(cartId) ?? 'available',
    })
  }

  unregisterCart(cartId) {
    this._cartSockets.delete(cartId)
    this._cartUsers.delete(cartId)

    this._cmdQueues.delete(cartId)  // nettoyer la file de commandes et d'alertes pour ce chariot
    this._alertQueues.delete(cartId)
    this.io.to(this.allAdminsRoom).emit('cart_offline', { cartId }) // cart_offline est écouté dans le dashboard admin pour afficher les chariots déconnectés en temps réel
    this.io.to(this.watcherRoom(cartId)).emit('cart_availability', {
      cartId, online: false, batteryPct: null, status: 'offline',
    })
    this._cartBattery.delete(cartId)
  }

  isCartOnline(cartId) {
    return this._cartSockets.has(cartId)
  }

  getCartStatus(cartId) {
    return this._cartStatus.get(cartId) ?? 'available'
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

  // ── Watchers (avant session — pour CartUnlockView) ───────────────────────────

  watchCart(socket, cartId) {
    socket.join(this.watcherRoom(cartId))
    socket.emit('cart_availability', {
      cartId,
      online:     this.isCartOnline(cartId),
      batteryPct: this.getCachedBattery(cartId),
      status:     this._cartStatus.get(cartId) ?? 'available',
    })
  }

  unwatchCart(socket, cartId) {
    socket.leave(this.watcherRoom(cartId))
  }

  // ── Batterie en cache ────────────────────────────────────────────────────────

  setCachedBattery(cartId, pct) {
    this._cartBattery.set(cartId, pct)
  }

  getCachedBattery(cartId) {
    return this._cartBattery.get(cartId) ?? null
  }

  // ── Admins ──────────────────────────────────────────────────────────────────

  registerAdmin(socket) {
    socket.join(this.allAdminsRoom)
    // Rejouer cart_online pour les chariots déjà connectés avant l'ouverture du dashboard
    for (const cartId of this._cartSockets.keys()) {
      socket.emit('cart_online', { cartId, timestamp: Date.now() })
    }
  }





  // ── File de commandes ───────────────────────────────────────────────────────

  // Ajoute une commande dans la file du chariot (émission différée au prochain flush)
  enqueueCmd(cartId, action, args = []) {
    if (!this._cmdQueues.has(cartId)) this._cmdQueues.set(cartId, [])
    this._cmdQueues.get(cartId).push({ id: `cmd-${randomUUID()}`, action, args })
  }

  // Ajoute une alerte dans la file du chariot
  enqueueAlert(cartId, alertType) { // va au chariot et à l'utilisateur (via la room user_of:cartId) ; les alertes sont aussi envoyées aux admins via le flush global
    if (!this._alertQueues.has(cartId)) this._alertQueues.set(cartId, [])
    const queue = this._alertQueues.get(cartId)
    if (!queue.includes(alertType)) queue.push(alertType) // pas de doublon dans le même tick
  }

  // Met à jour le statut en mémoire (appelé par les events user)
  setCartStatus(cartId, status) {
    this._cartStatus.set(cartId, status)
    this.toAdmins('cart_status_update', {
      cartId,
      status,
      ownerId: this._cartUsers.get(cartId) ?? null,
    })
  }

  // ── Flush ───────────────────────────────────────────────────────────────────

  // Appelé toutes les FLUSH_INTERVAL_MS (0,25s) : envoie le batch JSON à chaque chariot connecté
  _flushAll() {
    for (const cartId of this._cartSockets.keys()) {
      const cmds   = this._cmdQueues.get(cartId)   ?? []
      const alerts = this._alertQueues.get(cartId) ?? []

      if (cmds.length > 0) {
        console.log(`[flush] batch → cartId="${cartId}" cmds=${JSON.stringify(cmds.map(c => c.action))}`)
      }
      // le chariot/ou n'importe quel client abonné à la room cart:cartId doit éouter l'event 'cmd'
      this.io.to(this.cartRoom(cartId)).emit('cmd', {     //envoie des données à la room du chariot (cartId) ; le chariot doit être abonné à cette room pour recevoir les commandes et alertes qui lui sont destinées
        cartId,
        status: this._cartStatus.get(cartId) ?? 'available',
        alerts,
        cmds,
      })

      this._cmdQueues.set(cartId, []) //vide la file de commandes et d'alertes après l'envoi car elles ont été envoyées au chariot, et on peut réinitialiser la file pour le prochain batch
      this._alertQueues.set(cartId, []) 
    }
  }




  // ── Helpers d'émission (non-cart) ───────────────────────────────────────────

  // toUser(cartId, event, data)   { this.io.to(this.userRoom(cartId)).emit(event, data) } // remplacer par enqueueCmd ou enqueueAlert pour que les données soient envoyées au prochain flush, et éviter d'envoyer plusieurs messages au même chariot dans le même tick (ex: alert + cmd)
  toUser(cartId, event, data)   { this.io.to(this.userRoom(cartId)).emit(event, data) } // va à l'app mobile
  toAdmins(event, data)         { this.io.to(this.allAdminsRoom).emit(event, data) }
}

module.exports = RoomManager
