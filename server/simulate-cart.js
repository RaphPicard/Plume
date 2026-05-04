// server/simulate-cart.js (a remplacer par le Raspberry Pi du chariot IoT dans une vraie application)
const { io } = require('socket.io-client')
const jwt    = require('jsonwebtoken')

const token = jwt.sign(
  { role: 'cart', cartId: 'C-042' },
  'dev-secret'
)

const socket = io('http://localhost:3000', { auth: { token } })

// État interne du chariot simulé
let tracking = false   // true = un utilisateur a déverrouillé ce chariot

socket.on('connect', () => {
  console.log('Chariot simulé connecté')

  // Envoyer des capteurs toutes les secondes SEULEMENT si le suivi est actif
  // (si on veut changer la fréquence d'envoi, modifier la valeur du setInterval, ex: 100 pour 10x/s)
  setInterval(() => {
    // Les capteurs émettent en continu (le serveur se charge de router :
    //   → sensor_update aux admins toujours
    //   → cart_status à l'utilisateur seulement si un chariot lui est assigné)
    socket.emit('sensor_data', {    //sensor_data récupérable dans cart.js pour être envoyé aux admins et à l'utilisateur assigné
      weightKg:   (Math.random() * 10).toFixed(1),
      batteryPct: Math.floor(Math.random() * 100),
      speedMs:    tracking ? (Math.random() * 2).toFixed(2) : '0.00',  // vitesse nulle si pas de suivi actif
      accelX:     (Math.random() - 0.5).toFixed(3),
      accelY:     (Math.random() - 0.5).toFixed(3),
    })

    // La position n'est envoyée que si le chariot est en mouvement (suivi actif)
    if (tracking) {
      socket.emit('position_update', {
        x: (Math.random() * 100).toFixed(1),
        y: (Math.random() * 100).toFixed(1),
      })
    }
  }, 1000)  // 1000ms = 1x par seconde
})

socket.on('cmd', (cmd) => {
  console.log('Commande reçue :', JSON.stringify(cmd, null, 2))

  for (const command of cmd.cmds) {
    switch (command.action) {
      case 'start_tracking':
        tracking = true
        console.log('→ Suivi démarré')
        break

      case 'stop_tracking':
      case 'stop':
        tracking = false
        console.log('→ Suivi arrêté')
        break

      case 'move':
        // Le vrai chariot IoT actionnerait ses moteurs ici
        console.log(`→ Déplacement : ${command.args[0]}`)
        break

      case 'return_to_base':
        tracking = false
        console.log('→ Retour à la base')
        break
    }
  }
})