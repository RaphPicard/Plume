// Middleware JWT pour l'authentification
// server/auth.js

require('./load-env').loadEnv()

const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('[auth] JWT_SECRET manquant — définir dans .env');


// Middleware d'authentification pour Socket.IO (appelé à chaque connexion WebSocket dans server/index.js)
function authMiddleware(socket, next) {
  const token = socket.handshake.auth.token; //mis dans le client lors de la connexion : socket = io('http://localhost:3000', { auth: { token } })

  if (!token) {
    console.log(`[auth] connexion refusée (401) — token manquant socket=${socket.id}`)
    return next(new Error('Missing token'));
  }

  try {
    const payload = jwt.verify(token, SECRET);
    // payload contient : { role: 'user'|'admin'|'cart', userId, cartId }
    socket.data = payload;  // socket.data est ensuite accessible dans tous les handlers d'événements (ex: server/events/cart.js) pour vérifier les permissions et savoir quel utilisateur ou chariot est connecté
    next();
  } catch (err) {
    console.log(`[auth] connexion refusée (401) — token invalide socket=${socket.id} erreur="${err.message}"`)
    next(new Error('Invalid token'));
  }
}

module.exports = { authMiddleware };
