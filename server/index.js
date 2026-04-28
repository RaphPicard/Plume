// Configuration de la route http://localhost:3000/login et du header CORS pour autoriser les requêtes depuis le frontend (http://localhost:5173)
// server/index.js
const express = require('express')        // pour les routes HTTP (login)
const jwt     = require('jsonwebtoken')   // pour générer des tokens JWT
const bcrypt  = require('bcrypt')         // pour vérifier le mot de passe hashé
const cors    = require('cors')           // pour autoriser les requêtes cross-origin

const { getUserByUsername, getCartState } = require('./db')  // accès PostgreSQL

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

const SECRET      = process.env.JWT_SECRET   || 'dev-secret'
const CART_SECRET = process.env.CART_SECRET  || 'cart-dev-secret'

// Route de login — vérifie l'utilisateur en base et retourne un JWT
app.post('/login', async (req, res) => {
  const { username, password } = req.body

  // 1. Chercher l'utilisateur en base (PostgreSQL)
  const user = await getUserByUsername(username)
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' })

  // 2. Comparer le mot de passe avec le hash stocké (bcrypt)
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' })

  // 3. Générer le JWT avec le rôle réel de l'utilisateur
  const token = jwt.sign(
    { role: user.role, userId: user.username },
    SECRET,
    { expiresIn: '24h' }
  )
  res.json({ token, role: user.role })  // récupérer dans le fichier ScanView.vue du frontend pour stocker le token dans le localStorage et l'utiliser pour se connecter au WebSocket (api/socket.js) et pour afficher la bonne interface (ScanView ou AdminView)
})


// Route de token pour les chariots Raspberry Pi
// Le Raspberry envoie { cartId, cartSecret } et reçoit un JWT { role: 'cart', cartId }
app.post('/cart-token', async (req, res) => { //récupérable dans raspberry/cart_client.js pour que le chariot puisse s'authentifier auprès du serveur WebSocket Socket.IO
  const { cartId, cartSecret } = req.body

  if (!cartSecret || cartSecret !== CART_SECRET) {
    return res.status(401).json({ error: 'Secret invalide' })
  }

  const cart = await getCartState(cartId)
  if (!cart) return res.status(404).json({ error: `Chariot '${cartId}' inconnu` })

  const token = jwt.sign(
    { role: 'cart', cartId },
    SECRET,
    { expiresIn: '30d' }  // long lifetime : le RPi redemande un token à chaque démarrage
  )
  res.json({ token })
})

const httpServer = require('http').createServer(app)
//suite du code inchangé






// -----------------------------------------------------------------------------------
// Point d'entrée du serveur WebSocket (Socket.IO)
// Configuration du serveur Node.js avec WebSocket
// server/index.js

const { Server } = require('socket.io');
//on définit les handlers d'événements dans des fichiers séparés pour mieux organiser le code
const { authMiddleware } = require('./auth');
const { registerCartEvents } = require('./events/cart');
const { registerUserEvents } = require('./events/user');
const { registerAdminEvents } = require('./events/admin');
const RoomManager = require('./rooms');

// Créer le serveur HTTP (nécessaire pour Socket.IO)
//const httpServer = http.createServer();         // déjà créé au dessus par Express, on peut réutiliser httpServer de Express

// Attacher Socket.IO par-dessus
const io = new Server(httpServer, {
  cors: { origin: '*' }  // à restreindre en prod (* ==> http://localhost:5173) pour n'autoriser que le frontend à se connecter
});

const rooms = new RoomManager(io);




// Authentification : chaque client doit s'authentifier à la connexion
io.use(authMiddleware); //cette ligne permet d'exécuter le middleware d'authentification pour chaque connexion entrante. Le middleware vérifie le token JWT fourni par le client et, s'il est valide, injecte les données d'authentification (role, userId, cartId) dans socket.data. Si le token est manquant ou invalide, la connexion est rejetée avec une erreur.





// Quand quelqu'un se connecte...
io.on('connection', (socket) => { //a ce stade, le client est déjà authentifié et socket.data contient les infos du token JWT (role, userId, cartId)
  const { role, userId, cartId } = socket.data; // injecté par authMiddleware

  console.log(`[connect] role=${role} userId=${userId}`);

  if (role === 'cart')  registerCartEvents(io, socket, rooms);
  if (role === 'user')  registerUserEvents(io, socket, rooms);
  if (role === 'admin') { registerAdminEvents(io, socket, rooms); registerUserEvents(io, socket, rooms); }  //on donne aussi accès aux événements "user" pour les admins, pour qu'ils puissent voir les données des chariots et les alertes même s'ils ne sont pas connectés à un chariot spécifique
  // plusieurs handlers d'événements sont possibles simultanément pour un même socket, mais dans notre cas on enregistre les événements en fonction du rôle du client (cart, user ou admin)

  // Quand la connexion se coupe...
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    if (role === 'cart') rooms.unregisterCart(cartId);
  });
});



//Hello word sur le serveur HTTP
app.get('/', (_req, res) => { //_req car on s'en fiche de la requête HTTP, on veut juste tester que le serveur répond
  res.send('Hello World from Express! Tout se passe sur le frontend pour l utilisateur (http://localhost:5173) et sur les WebSockets)');
});
// Démarrer sur le port 3000
httpServer.listen(3000, () => console.log('Server on :3000'));  //http://localhost:3000