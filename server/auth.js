// Middleware JWT pour l'authentification
// server/auth.js

const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

function authMiddleware(socket, next) {
  const token = socket.handshake.auth.token;

  if (!token) return next(new Error('Missing token'));

  try {
    const payload = jwt.verify(token, SECRET);
    // payload contient : { role: 'user'|'admin'|'cart', userId, cartId }
    socket.data = payload;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
}

module.exports = { authMiddleware };
