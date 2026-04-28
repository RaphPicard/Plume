// État global (chariot actif, capteurs…)
class GlobalStore {
  constructor() {
    this.activeCart = null;
    this.sensors = {};
    this.userStatus = 'idle';
    this.isConnected = false;
  }

  setActiveCart(cartId) {
    this.activeCart = cartId;
  }

  updateSensorData(data) {
    this.sensors = { ...this.sensors, ...data };
  }

  setUserStatus(status) {
    this.userStatus = status;
  }

  setConnectionStatus(connected) {
    this.isConnected = connected;
  }

  getState() {
    return {
      activeCart: this.activeCart,
      sensors: this.sensors,
      userStatus: this.userStatus,
      isConnected: this.isConnected
    };
  }
}

module.exports = GlobalStore;
