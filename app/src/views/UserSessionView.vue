<!-- src/views/UserSessionView.vue -->
<!-- Vue de session active : timer, batterie, distance au chariot -->
<template>
  <div class="session-screen">

    <header class="session-header">
      <button class="back-btn" @click="handleTerminer">← Terminer</button>
      <span class="status-badge">
        <span class="dot"></span> Session active
      </span>
    </header>

    <div class="cart-id">Chariot {{ store.activeCartId }}</div>

    <!-- Timer principal -->
    <div class="timer-card">
      <span class="timer-label">Durée</span>
      <span class="timer-value">{{ elapsedFormatted }}</span>
    </div>

    <!-- Métriques temps réel -->
    <div class="metrics">
      <div class="metric">
        <span class="val">{{ store.cartStatus?.batteryPct ?? '—' }}%</span>
        <span class="lbl">Batterie</span>
      </div>
      <div class="metric">
        <span class="val">
          {{ store.cartStatus?.distanceToUser != null ? store.cartStatus.distanceToUser + ' m' : '—' }}
        </span>
        <span class="lbl">Distance</span>
      </div>
      <div class="metric">
        <span class="val">{{ store.cartStatus?.weightKg ?? '—' }} kg</span>
        <span class="lbl">Charge</span>
      </div>
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

    <button class="stop-btn" @click="handleTerminer">
      Terminer la session
    </button>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import { connectSocket, stopCart, onCartStatus, onAlert, onKicked, startAutoTracking, onAutoTrackingStarted, onAutoTrackingStopped, onCartStatusUpdateEvent } from '../api/socket'
import { getScanSession, saveScanSession } from '../api/scanAuth'

const router = useRouter()
const store  = useCartStore()

async function ensureSession() {
  const existing = getScanSession()
  if (existing) {
    await connectSocket(existing.token)
    return
  }
  const res = await fetch('http://localhost:3000/session', { method: 'POST' })
  if (!res.ok) throw new Error('Impossible de créer la session')
  const { token } = await res.json()
  saveScanSession(token)
  await connectSocket(token)
}

const elapsed = ref(0)
let elapsedTimer    = null
let unsubCartStatus = null
let unsubAlert      = null
let unsubKicked     = null
let unsubAutoTrackingStarted = null
let unsubAutoTrackingStopped = null
let unsubCartStatusUpdate = null
const registering = ref(false)
const registerCountdown = ref(10)
const registerSuccess = ref(false)
let registerTimer = null

const elapsedFormatted = computed(() => {
  const m    = Math.floor(elapsed.value / 60)
  const secs = elapsed.value % 60
  return `${String(m).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
})

async function handleTerminer() {
  await stopCart()
  store.clearActiveCart()
  router.push('/')
}

let commandWs = null

function cleanupRegistration() {
  if (registerTimer) {
    clearInterval(registerTimer)
    registerTimer = null
  }
  if (commandWs) {
    commandWs.close()
    commandWs = null
  }
}

async function registerPerson() {
  if (registering.value || registerSuccess.value) return
  registering.value = true
  registerCountdown.value = 10

  // 1. Ouvrir le WebSocket /command pour écouter le statut
  commandWs = new WebSocket('ws://100.81.175.3:8001/command')

  commandWs.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch (e) {
      console.error('[WS /command] JSON parse error:', e)
      return
    }
    console.log('[WS /command]', msg)

    if (msg.status === 'register_ok') {
      cleanupRegistration()
      registering.value = false
      registerSuccess.value = true
      store.updateStatus({ ...store.cartStatus, status: 'auto_tracking' })
      startAutoTracking().catch(e => console.error('Auto-tracking error:', e))
    } else if (msg.status === 'register_failed') {
      console.error('[WS /command] register_failed:', msg.reason)
      cleanupRegistration()
      registering.value = false
      registerCountdown.value = 10
    }
  })

  commandWs.addEventListener('error', (err) => console.error('[WS /command] error:', err))

  // 2. Envoyer le POST une fois le WS ouvert
  commandWs.addEventListener('open', async () => {
    try {
      await fetch('http://100.81.175.3:8001/command/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: 10 }),
      })
    } catch (e) {
      console.error('POST register error:', e)
    }
  })

  // 3. Lancer l'animation de countdown (purement visuel)
  let elapsedSecs = 0
  registerTimer = setInterval(() => {
    elapsedSecs++
    registerCountdown.value = Math.max(0, 10 - elapsedSecs)
    // Timeout de sécurité (20s) si on ne reçoit rien
    if (elapsedSecs >= 20) {
      console.warn('[register] Timeout sans register_ok')
      cleanupRegistration()
      registering.value = false
      registerCountdown.value = 10
    }
  }, 1000)
}

onMounted(async () => {
  if (!store.hasActiveCart) {
    router.replace('/')
    return
  }

  unsubCartStatus = onCartStatus(data => {
    // Préserver le status local (auto_tracking, paired, etc.) qui n'est pas dans les sensor_data
    store.updateStatus({ ...data, status: store.cartStatus?.status })
  })
  unsubAlert      = onAlert(alert => store.addAlert(alert))
  unsubKicked     = onKicked(() => {
    store.clearActiveCart()
    router.replace('/')
  })
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

  try {
    await ensureSession()
  } catch {
    store.clearActiveCart()
    router.replace('/')
    return
  }

  if (store.sessionStartTime) {
    elapsed.value = Math.floor((Date.now() - store.sessionStartTime) / 1000)
  }

  elapsedTimer = setInterval(() => elapsed.value++, 1000)
})

onUnmounted(() => {
  clearInterval(elapsedTimer)
  cleanupRegistration()
  unsubCartStatus?.()
  unsubAlert?.()
  unsubKicked?.()
  unsubAutoTrackingStarted?.()
  unsubAutoTrackingStopped?.()
  unsubCartStatusUpdate?.()
})
</script>

<style scoped>
.session-screen {
  min-height: 100vh;
  background: #0f0f12;
  color: #fff;
  padding: 24px 20px;
  font-family: sans-serif;
}

.session-header {
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
  0%,100% { opacity: 1 } 50% { opacity: .4 }
}

.cart-id {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 20px;
  color: rgba(255,255,255,0.7);
}

/* Timer */
.timer-card {
  background: rgba(108,99,255,0.1);
  border: 1px solid rgba(108,99,255,0.25);
  border-radius: 18px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: 20px;
}

.timer-label {
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
}

.timer-value {
  font-size: 52px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #a5a0ff;
  line-height: 1;
}

/* Métriques */
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

.val { font-size: 18px; font-weight: 600; }
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
