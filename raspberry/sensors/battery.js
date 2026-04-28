// raspberry/sensors/battery.js
// Lecture niveau batterie via ADC (ex: MCP3008 sur SPI, ou INA219 sur I2C)
//
// Sur le vrai Raspberry Pi, remplacer le corps de readBattery() par :
//   const INA219 = require('ina219-sensor')   // npm install ina219-sensor
//   const sensor = new INA219(0x40)
//   const voltage = await sensor.getBusVoltage()
//   // convertir tension → pourcentage selon la courbe de décharge de ta batterie
//   return Math.round(((voltage - V_MIN) / (V_MAX - V_MIN)) * 100)

let _simulatedPct = 85  // démarre à 85% en simulation

function readBattery() {
  // STUB — décharge lente simulée
  _simulatedPct = Math.max(0, _simulatedPct - 0.01)
  return Math.round(_simulatedPct)
}

module.exports = { readBattery }
