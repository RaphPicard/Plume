// Events côté chariots
// server/events/cart.js

function registerCartEvents(io, socket, rooms) {    // appelé dans server.js lors de la connexion d'un chariot
  const { cartId } = socket.data;

  rooms.registerCart(socket, cartId);

  // Si un utilisateur avait déjà déverrouillé ce chariot (ex: reconnexion du chariot),
  // lui envoyer start_tracking pour qu'il reprenne l'envoi des capteurs
  const { getCartState } = require('../db');
  getCartState(cartId).then((state) => {
    if (state?.ownerId) {
      socket.emit('cmd', { action: 'start_tracking' });
    }
  });

  // --- Données capteurs ---
  socket.on('sensor_data', (data) => {
    rooms.toAdmins('sensor_update', { cartId, ...data }); //notif admins des données COMPLETES capteurs
    rooms.toUser(cartId, 'cart_status', {
      cartId,
      weightKg:   data.weightKg,
      batteryPct: data.batteryPct,
      speedMs:    data.speedMs,
    });
  });

  // --- Alerte obstacle ---
  socket.on('obstacle_alert', ({ severity, distanceCm }) => {
    rooms.toAdmins('alert', { cartId, type: 'obstacle', severity, distanceCm });
    rooms.toUser(cartId, 'alert', { type: 'obstacle', severity });

    if (severity === 'critical') {
      socket.emit('cmd', { action: 'stop' });
    }
  });

  // --- Position ---
  socket.on('position_update', ({ x, y }) => {
    rooms.toAdmins('cart_position', { cartId, x, y });
  });
}

module.exports = { registerCartEvents };