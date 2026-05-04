// Events côté chariots
// server/events/cart.js

function registerCartEvents(io, socket, rooms) {    // appelé dans server.js lors de la connexion d'un chariot
  const { cartId } = socket.data;

  rooms.registerCart(socket, cartId); // le Raspberry Pi connecté avec le rôle "cart" est enregistré dans la room correspondante à son cartId, et dans la room de tous les chariots pour que les admins puissent le voir dans la flotte

  // Si un utilisateur avait déjà déverrouillé ce chariot (ex: reconnexion du chariot),
  // lui envoyer start_tracking pour qu'il reprenne l'envoi des capteurs
  const { getCartState } = require('../db');
  getCartState(cartId).then((state) => {
    if (state?.ownerId) {
      rooms.setCartStatus(cartId, 'paired');
      rooms.enqueueCmd(cartId, 'start_tracking', []); // Le chariot reçoit automatiquement start_tracking au prochain flush
    }
  });



  // --- Données capteurs ---
  socket.on('sensor_data', (data) => { // on les recoit du raspberry Pi (cart_client.js) et on les relaie aux admins et à l'utilisateur concerné (si connecté) ; le chariot doit éouter l'event 'cmd' pour recevoir les commandes et alertes qui lui sont destinées
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
      rooms.enqueueAlert(cartId, 'obstacle_detected');
      rooms.enqueueCmd(cartId, 'stop', []);
    }
  });

  // --- Position ---
  socket.on('position_update', ({ x, y }) => {
    rooms.toAdmins('cart_position', { cartId, x, y });
  });
}

module.exports = { registerCartEvents };