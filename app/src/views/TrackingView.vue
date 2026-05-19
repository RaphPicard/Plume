<!-- src/views/TrackingView.vue -->
 <!-- Vue de suivi du chariot -->
<template>
  <div class="tracking-screen">

    <header class="track-header">
      <button class="back-btn" @click="handleStop">← Arrêter</button>
      <span class="status-badge">
        <span class="dot"></span> Suivi actif
      </span>
    </header>

    <div class="cart-id">Chariot {{ store.activeCartId }}</div> <!-- lecture socket dans api/socket.js-->

    <!-- Métriques temps réel -->
    <div class="metrics" v-if="store.cartStatus">
      <div class="metric">
        <span class="val">{{ store.cartStatus.weightKg ?? '—' }} kg</span>
        <span class="lbl">Charge</span>
      </div>
      <div class="metric">
        <span class="val">{{ store.cartStatus.batteryPct ?? '—' }}%</span>
        <span class="lbl">Batterie</span>
      </div>
      <div class="metric">
        <span class="val">{{ store.cartStatus.speedMs ?? '—' }} m/s</span>
        <span class="lbl">Vitesse</span>
      </div>
    </div>
    <div class="metrics-placeholder" v-else>
      En attente des données capteurs...
    </div>

    <!-- Alertes -->
    <div class="alerts" v-if="store.alerts.length > 0">
      <div
        class="alert-item"
        v-for="alert in store.alerts"
        :key="alert.id"
      >
        ⚠ {{ alert.type === 'obstacle' ? 'Obstacle détecté !' : alert.type }}
      </div>
    </div>

    <button
      class="register-btn"
      :class="{ registering: registering, success: registerSuccess, tracking: store.cartStatus?.status === 'auto_tracking' }"
      @click="registerPerson"
      :disabled="registering || registerSuccess || store.cartStatus?.status === 'auto_tracking'"
    >
      <span class="register-label">
        <template v-if="store.cartStatus?.status === 'auto_tracking'">👁 Personne suivie</template>
        <template v-else-if="registerSuccess">✓ Personne repérée</template>
        <template v-else-if="!registering">📷 Enregistrer la personne à suivre</template>
        <template v-else>⏱ Enregistrement... {{ registerCountdown }}s</template>
      </span>
      <div v-if="registering" class="register-bar"></div>
    </button>

    <button class="stop-btn" @click="handleStop">
      Arrêter le suivi
    </button>

  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import { stopCart, startAutoTracking, onAutoTrackingStarted, onAutoTrackingStopped, onCartStatusUpdateEvent, onCommandStatus } from '../api/socket'
import { VIDEO_URL } from '../api/config'

const router = useRouter()
const store  = useCartStore()

// Rediriger si on arrive ici sans chariot actif
if (!store.hasActiveCart) {
  router.replace('/')
}

async function handleStop() {
  await stopCart()  // socket.emit('stop_cart', {}, resolve)
  store.clearActiveCart()
  router.push('/')
}

const registering = ref(false)
const registerCountdown = ref(10)
const registerSuccess = ref(false)
let registerTimer = null
let unsubAutoTrackingStarted = null
let unsubAutoTrackingStopped = null
let unsubCartStatusUpdate = null

onMounted(() => {
  unsubAutoTrackingStarted = onAutoTrackingStarted(() => {
    store.updateStatus({ ...store.cartStatus, status: 'auto_tracking' })
  })
  unsubAutoTrackingStopped = onAutoTrackingStopped(() => {
    store.updateStatus({ ...store.cartStatus, status: 'paired' })
    registerSuccess.value = false
  })

  unsubCartStatusUpdate = onCartStatusUpdateEvent(({ status }) => {
    store.updateStatus({ ...store.cartStatus, status })
  })
})

let unsubCommandStatus = null

function cleanupRegistration() {
  if (registerTimer) {
    clearInterval(registerTimer)
    registerTimer = null
  }
  unsubCommandStatus?.()
  unsubCommandStatus = null
}

async function registerPerson() {
  if (registering.value || registerSuccess.value) return
  registering.value = true
  registerCountdown.value = 10

  // 1. Écouter les events du serveur Python relayés par le Node.js
  unsubCommandStatus = onCommandStatus((msg) => {
    console.log('[command_status]', msg)
    if (msg.status === 'register_ok') {
      cleanupRegistration()
      registering.value = false
      registerSuccess.value = true
      store.updateStatus({ ...store.cartStatus, status: 'auto_tracking' })
      startAutoTracking().catch(e => console.error('Auto-tracking error:', e))
    } else if (msg.status === 'register_failed') {
      console.error('[command_status] register_failed:', msg.reason)
      cleanupRegistration()
      registering.value = false
      registerCountdown.value = 10
    }
  })

  // 2. Envoyer le POST au serveur Python pour lancer l'enregistrement
  try {
    await fetch(`${VIDEO_URL}/command/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 10 }),
    })
  } catch (e) {
    console.error('POST register error:', e)
  }

  // 3. Lancer l'animation de countdown (purement visuel)
  let elapsed = 0
  registerTimer = setInterval(() => {
    elapsed++
    registerCountdown.value = Math.max(0, 10 - elapsed)
    // Timeout de sécurité (20s) si on ne reçoit rien
    if (elapsed >= 20) {
      console.warn('[register] Timeout sans register_ok')
      cleanupRegistration()
      registering.value = false
      registerCountdown.value = 10
    }
  }, 1000)
}

onUnmounted(() => {
  cleanupRegistration()
  unsubAutoTrackingStarted?.()
  unsubAutoTrackingStopped?.()
  unsubCartStatusUpdate?.()
})
</script>




<style scoped>
.tracking-screen {
  min-height: 100vh;
  background: #0f0f12;
  color: #fff;
  padding: 24px 20px;
  font-family: sans-serif;
}

.track-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.back-btn {
  background: none;
  border: 1px solid rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.6);
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(34,197,94,0.12);
  border: 1px solid rgba(34,197,94,0.3);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
  color: #4ade80;
}

.dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #4ade80;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%,100% { opacity:1 } 50% { opacity:.4 }
}

.cart-id {
  font-size: 26px;
  font-weight: 600;
  margin-bottom: 24px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.metric {
  background: rgba(255,255,255,0.06);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.val { font-size: 20px; font-weight: 600; }
.lbl { font-size: 11px; color: rgba(255,255,255,0.4); }

.metrics-placeholder {
  text-align: center;
  color: rgba(255,255,255,0.3);
  padding: 40px;
  font-size: 13px;
}

.alerts { margin-bottom: 20px; }

.alert-item {
  background: rgba(239,68,68,0.12);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13px;
  color: #f87171;
  margin-bottom: 8px;
}

.register-btn {
  width: 100%;
  padding: 16px;
  background: rgba(249,115,22,0.12);
  border: 1px solid rgba(249,115,22,0.3);
  color: #fb923c;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 12px;
  position: relative;
  overflow: hidden;
}

.register-btn.registering {
  opacity: 0.85;
  cursor: not-allowed;
}

.register-btn.success {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.3);
  color: #4ade80;
  cursor: not-allowed;
}

.register-btn.tracking {
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.5);
  color: #4ade80;
  cursor: not-allowed;
}

.register-label {
  position: relative;
  z-index: 1;
}

.register-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: #fb923c;
  width: 0;
  animation: register-fill 10s linear forwards;
}

@keyframes register-fill {
  from { width: 0; }
  to   { width: 100%; }
}

.stop-btn {
  width: 100%;
  padding: 16px;
  background: rgba(239,68,68,0.15);
  border: 1px solid rgba(239,68,68,0.3);
  color: #f87171;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
</style>