// raspberry/sensors/weight.js
// Lecture cellule de charge via HX711 (convertisseur ADC)
//
// Sur le vrai Raspberry Pi, remplacer le corps de readWeight() par :
//   const HX711 = require('hx711')   // npm install hx711
//   const scale = new HX711(DATA_PIN, CLOCK_PIN)
//   scale.setScale(CALIBRATION_FACTOR)
//   return scale.getUnits(5)         // moyenne sur 5 lectures, en kg

function readWeight() {
  // STUB — valeurs simulées entre 0 et 30 kg
  return +(Math.random() * 30).toFixed(1)
}

module.exports = { readWeight }
