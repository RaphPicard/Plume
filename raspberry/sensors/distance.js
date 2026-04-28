// raspberry/sensors/distance.js
// Lecture capteur ultrason HC-SR04 ou lidar via GPIO
//
// Sur le vrai Raspberry Pi, remplacer le corps de readDistance() par :
//   const { Gpio } = require('onoff')   // npm install onoff
//   const TRIG = new Gpio(TRIG_PIN, 'out')
//   const ECHO = new Gpio(ECHO_PIN, 'in', 'both')
//   // envoyer impulsion TRIG, mesurer durée ECHO, convertir en cm
//   // distanceCm = (duréeMicroseconds * 0.0343) / 2

function readDistance() {
  // STUB — distance simulée entre 20 et 200 cm
  return Math.floor(20 + Math.random() * 180)
}

module.exports = { readDistance }
