// Events côté dashboard admin
// server/events/admin.js

const { getAllCarts } = require('../db');

function registerAdminEvents(io, socket, rooms) {
  rooms.registerAdmin(socket);

  // --- Commande de déplacement manuel ---
  socket.on('admin:move', ({ cartId, direction }) => {
    rooms.toCart(cartId, 'cmd', { action: 'move', direction });
  });

  // --- Arrêt forcé ---
  socket.on('admin:force_stop', ({ cartId }) => {
    rooms.toCart(cartId, 'cmd', { action: 'stop' });
    rooms.toUser(cartId, 'alert', { type: 'forced_stop' });
  });

  // --- Rappel à la base ---
  socket.on('admin:recall', ({ cartId }) => {
    rooms.toCart(cartId, 'cmd', { action: 'return_to_base' });
  });

  // --- Demande d'état complet de la flotte ---
  socket.on('admin:get_fleet', async (_, callback) => {
    const carts = await getAllCarts();
    callback({ carts });
  });
}

module.exports = { registerAdminEvents };
