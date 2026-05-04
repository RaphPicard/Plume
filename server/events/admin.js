// Events côté dashboard admin
// server/events/admin.js

const { getAllCarts } = require('../db');

function registerAdminEvents(io, socket, rooms) {
  rooms.registerAdmin(socket);

  // --- Commande de déplacement manuel ---
  socket.on('admin:move', ({ cartId, direction }) => {
    rooms.enqueueCmd(cartId, 'move', [direction]);
  });

  // --- Arrêt forcé ---
  socket.on('admin:force_stop', ({ cartId }) => {
    rooms.enqueueCmd(cartId, 'stop', []);
    rooms.enqueueAlert(cartId, 'forced_stop');
    rooms.toUser(cartId, 'alert', { type: 'forced_stop' }); // notification immédiate vers l'app mobile
  });

  // --- Rappel à la base ---
  socket.on('admin:recall', ({ cartId }) => {
    rooms.enqueueCmd(cartId, 'return_to_base', []);
  });

  // --- Demande d'état complet de la flotte ---
  socket.on('admin:get_fleet', async (_, callback) => {
    const carts = await getAllCarts();
    callback({ carts: carts.map(c => ({ ...c, online: rooms._cartSockets.has(c.cartId) })) });
  });
}

module.exports = { registerAdminEvents };
