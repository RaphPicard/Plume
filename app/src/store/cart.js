// src/store/cart.js
// ce qui est partagé entre les 2 vues ScanView et TrackingView (ex: le cartId actif, le statut du chariot, les alertes, etc)

import { defineStore } from 'pinia' //defineStore est une fonction qui permet de créer un "store" (un conteneur d'état global) dans une application Vue.js. Un store est un objet qui contient l'état de l'application, des getters pour accéder à cet état, et des actions pour le modifier. En utilisant Pinia, on peut facilement gérer l'état partagé entre différentes parties de l'application, comme les vues ScanView et TrackingView dans ce cas.
import { ref, computed } from 'vue'

export const useCartStore = defineStore('cart', () => {

  // --- État ---
  const activeCartId    = ref(null)     // null = pas de chariot actif
  const isConnected     = ref(false)
  const cartStatus      = ref(null)     // { weightKg, batteryPct, speedMs, distanceToUser }
  const alerts          = ref([])
  const sessionStartTime = ref(null)   // timestamp ms — début de la session active

  // --- État admin ---
  const fleet          = ref([])       // [{ cartId, ownerId, status }] — liste complète des chariots
  const sensorData     = ref({})       // { [cartId]: { accelX, accelY, accelZ, gyroX, gyroY, gyroZ, weightKg, speedMs, batteryPct } }
  const positions      = ref({})       // { [cartId]: { x, y } }

  // --- Getters (propriétés calculées) ---
  const hasActiveCart = computed(() => activeCartId.value !== null)

  // --- Actions ---
  function setActiveCart(cartId) {
    activeCartId.value = cartId
  }

  function clearActiveCart() {
    activeCartId.value     = null
    cartStatus.value       = null
    sessionStartTime.value = null
  }

  function setSessionStartTime(timestamp) {
    sessionStartTime.value = timestamp
  }

  function updateStatus(status) {
    cartStatus.value = status
  }

  function addAlert(alert) {
    alerts.value.push({ ...alert, id: Date.now() })
  }

  function setConnected(val) {
    isConnected.value = val
  }

  // --- Actions admin ---
  function setFleet(carts) {
    fleet.value = carts
  }

  function setCartOnline(cartId) {
    const existing = fleet.value.find(c => c.cartId === cartId)
    if (existing) existing.online = true
    else fleet.value.push({ cartId, online: true, status: 'available', ownerId: null })
  }

  function setCartOffline(cartId) {
    const existing = fleet.value.find(c => c.cartId === cartId)
    if (existing) existing.online = false
    delete sensorData.value[cartId]
    delete positions.value[cartId]
  }

  function updateSensorData(data) {
    // data = { cartId, accelX, accelY, accelZ, gyroX, gyroY, gyroZ, weightKg, speedMs, batteryPct }
    sensorData.value[data.cartId] = data
  }

  function updatePosition(data) {
    // data = { cartId, x, y }
    positions.value[data.cartId] = { x: data.x, y: data.y }
  }

  return {
    // état
    activeCartId, isConnected, cartStatus, alerts, sessionStartTime,
    fleet, sensorData, positions,
    // getters
    hasActiveCart,
    // actions utilisateur
    setActiveCart, clearActiveCart, updateStatus, addAlert, setConnected, setSessionStartTime,
    // actions admin
    setFleet, setCartOnline, setCartOffline, updateSensorData, updatePosition,
  }
})