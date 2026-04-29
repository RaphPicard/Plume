// Events côté app mobile
// server/events/user.js

const { getCartState, setCartOwner, clearCartOwner } = require('../db');

function registerUserEvents(io, socket, rooms) {
  const { userId } = socket.data;

  // --- Déverrouillage chariot ---
  socket.on('unlock_cart', async ({ cartId }, callback) => {
    try {
      const cart = await getCartState(cartId);

      if (!cart) return callback({ ok: false, error: 'Chariot introuvable' });
      if (cart.ownerId) return callback({ ok: false, error: 'Chariot déjà utilisé' });

      await setCartOwner(cartId, userId);

      rooms.assignUser(socket, cartId, userId);
      socket.data.activeCartId = cartId;    // stocker le cartId actif dans socket.data pour pouvoir le libérer en cas de déconnexion

      rooms.setCartStatus(cartId, 'paired');
      rooms.enqueueCmd(cartId, 'start_tracking', []); //enqueueCmd pour que le chariot commence à envoyer les données capteurs au prochain flush

      callback({ ok: true, cartId });
    } catch (err) {
      console.error('[unlock_cart]', err.message);
      callback({ ok: false, error: 'Erreur serveur : ' + err.message });
    }
  });

  // --- Arrêt du suivi ---
  socket.on('stop_cart', async (_, callback) => {
    const cartId = socket.data.activeCartId;
    if (!cartId) return callback({ ok: false, error: 'Pas de chariot actif' });

    await clearCartOwner(cartId);
    rooms.releaseUser(socket, cartId);
    socket.data.activeCartId = null;

    rooms.setCartStatus(cartId, 'available');
    rooms.enqueueCmd(cartId, 'stop_tracking', []);

    callback({ ok: true });
  });

  // Nettoyage si l'utilisateur se déconnecte brutalement
  socket.on('disconnect', async () => {
    const cartId = socket.data.activeCartId;
    if (cartId) {
      await clearCartOwner(cartId);
      rooms.setCartStatus(cartId, 'available');
      rooms.enqueueCmd(cartId, 'stop_tracking', []);
    }
  });
}

module.exports = { registerUserEvents };
