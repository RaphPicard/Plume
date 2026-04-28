// raspberry/config.js
// Modifier ces valeurs avant de déployer sur chaque Raspberry Pi

module.exports = {
  SERVER_URL:  'http://localhost:3000',  // remplacer par l'IP du serveur sur le Wi-Fi aéroport
  CART_ID:     'C-042',                 // ID unique de CE chariot (doit exister en base PostgreSQL)
  CART_SECRET: 'cart-dev-secret',       // secret partagé avec le serveur (CART_SECRET dans .env)

  SENSOR_INTERVAL_MS: 1000,             // fréquence d'envoi des capteurs (ms)
}
