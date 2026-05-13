// Events côté dashboard admin
// server/events/admin.js

const { getAllCarts, clearCartOwner } = require('../db');
const pythonProxy = require('../python-proxy');

function registerAdminEvents(io, socket, rooms) {
  rooms.registerAdmin(socket);

  // --- Commande de déplacement manuel ---
  socket.on('admin:move', ({ cartId, direction }) => {
    rooms.enqueueCmd(cartId, 'move', [direction]);
  });

  // --- Arrêt forcé ---
  socket.on('admin:force_stop', ({ cartId }) => {
    rooms.enqueueCmd(cartId, 'stop', []);
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

  // --- Kick utilisateur ---
  socket.on('admin:kick_cart', async ({ cartId }) => {
    const userSocket = [...io.sockets.sockets.values()].find(s => s.data.activeCartId === cartId);

    await clearCartOwner(cartId);

    if (userSocket) {
      rooms.releaseUser(userSocket, cartId);
      userSocket.data.activeCartId = null;
      userSocket.emit('kicked', { cartId });
    }

    rooms.setCartStatus(cartId, 'available');
    rooms.enqueueCmd(cartId, 'stop_tracking', []);
    pythonProxy.sendCommand({ cmd: 'reset' });
  });
}

module.exports = { registerAdminEvents };
