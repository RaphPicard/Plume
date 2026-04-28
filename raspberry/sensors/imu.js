// raspberry/sensors/imu.js
// Lecture accéléromètre + gyroscope via I2C (MPU-6050 ou similaire)
//
// Sur le vrai Raspberry Pi, remplacer le corps de readIMU() par :
//   const i2c = require('i2c-bus')
//   const mpu = require('i2c-mpu6050')  // npm install i2c-mpu6050
//   const sensor = new mpu(i2c.openSync(1), 0x68)
//   return sensor.read()

function readIMU() {
  // STUB — valeurs simulées
  return {
    accelX: +(Math.random() - 0.5).toFixed(3),
    accelY: +(Math.random() - 0.5).toFixed(3),
    accelZ: +(0.95 + Math.random() * 0.1).toFixed(3),  // ~1g au repos
    gyroX:  +(Math.random() - 0.5).toFixed(3),
    gyroY:  +(Math.random() - 0.5).toFixed(3),
    gyroZ:  +(Math.random() - 0.5).toFixed(3),
  }
}

module.exports = { readIMU }
