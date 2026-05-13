<!-- src/views/CartUnlockView.vue -->
<!-- Vue de déverrouillage par QR code — affiche le statut du chariot et gère le pairing -->
<template>
  <div class="unlock-screen">

    <!-- Chargement session -->
    <div v-if="loadingSession" class="center-content">
      <div class="spinner"></div>
      <p>Connexion...</p>
    </div>

    <template v-else>
      <header class="unlock-header">
        <span class="logo">AUTOCART</span>
        <div class="cart-label">Chariot {{ cartId }}</div>
      </header>

      <!-- État du chariot -->
      <div class="status-card" :class="statusClass">
        <div class="status-icon">{{ statusIcon }}</div>
        <div class="status-text">{{ statusLabel }}</div>
        <div v-if="cartOnline && cartBattery !== null" class="battery-row">
          <div class="battery-bar-wrap">
            <div class="battery-bar" :style="{ width: cartBattery + '%' }" :class="batteryClass"></div>
          </div>
          <span class="battery-pct">{{ cartBattery }}%</span>
        </div>
      </div>

      <!-- Phase pairing : countdown -->
      <div v-if="pairing" class="pairing-card">
        <div class="countdown-ring">
          <svg viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" class="ring-bg"/>
            <circle cx="40" cy="40" r="34" class="ring-progress"
              :stroke-dasharray="`${ringProgress} 214`"/>
          </svg>
          <span class="countdown-num">{{ countdownRemaining }}</span>
        </div>
        <p class="pairing-hint">Appuyez sur le bouton du robot pour valider</p>

        <button class="btn-secondary" @click="handleCancelPairing">Annuler</button>

        <!-- Bouton simulation (développement) -->
        <button class="btn-simulate" @click="simulateConfirm">
          ⚙ Simuler la confirmation
        </button>
      </div>

      <!-- Phase normale -->
      <div v-else class="action-card">
        <button
          class="btn-unlock"
          :disabled="!isAvailable"
          @click="handleDeverrouiller"
        >
          {{ loading ? 'Demande en cours...' : 'Déverrouiller' }}
        </button>
        <p v-if="!cartOnline" class="hint-text">Le chariot est hors ligne. Veuillez réessayer plus tard.</p>
        <p v-else-if="cartStatus === 'pairing_pending'" class="hint-text">Un appairage est déjà en cours sur ce chariot.</p>
        <p v-else-if="!isAvailable" class="hint-text">Ce chariot est actuellement utilisé.</p>
      </div>

      <p class="error" v-if="error">{{ error }}</p>
    </template>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import {
  connectSocket,
  watchCart, unwatchCart,
  requestPairing, cancelPairing,
  onCartAvailability, onPairingConfirmed, onPairingTimeout,
} from '../api/socket'
import { getScanSession, saveScanSession } from '../api/scanAuth'
import { SERVER_URL } from '../api/config'

const route  = useRoute()
const router = useRouter()
const store  = useCartStore()

const cartId = route.params.cartId

const loadingSession     = ref(true)
const loading            = ref(false)
const error              = ref('')
const cartOnline         = ref(false)
const cartBattery        = ref(null)
const cartStatus         = ref('available')
const pairing            = ref(false)
const countdownRemaining = ref(60)

let countdownInterval = null
let unsubAvailability  = null
let unsubConfirmed     = null
let unsubTimeout       = null

// ── Computed ──────────────────────────────────────────────────────────────────

const isAvailable = computed(() =>
  cartOnline.value && cartStatus.value === 'available'
)

const statusClass = computed(() => ({
  'status-online':  cartOnline.value && isAvailable.value,
  'status-busy':    cartOnline.value && !isAvailable.value,
  'status-offline': !cartOnline.value,
}))

const statusIcon = computed(() => {
  if (!cartOnline.value) return '○'
  if (isAvailable.value) return '●'
  return '◑'
})

const statusLabel = computed(() => {
  if (!cartOnline.value) return 'Hors ligne / Indisponible'
  if (cartStatus.value === 'pairing_pending') return 'Appairage en cours...'
  if (cartStatus.value === 'paired') return 'En cours d\'utilisation'
  return 'En ligne — Disponible'
})

const batteryClass = computed(() => {
  if (cartBattery.value > 50) return 'bat-high'
  if (cartBattery.value > 20) return 'bat-mid'
  return 'bat-low'
})

// SVG circle circumference ≈ 2π×34 ≈ 213.6 → ring progress in px
const ringProgress = computed(() =>
  Math.round((countdownRemaining.value / 60) * 214)
)

// ── Session / connexion ───────────────────────────────────────────────────────

async function ensureSession() {
  const existing = getScanSession()
  if (existing) {
    await connectSocket(existing.token)
    return
  }
  const res = await fetch(`${SERVER_URL}/session`, { method: 'POST' })
  if (!res.ok) throw new Error('Impossible de créer la session')
  const { token } = await res.json()
  saveScanSession(token)
  await connectSocket(token)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handleAvailability({ online, batteryPct, status }) {
  cartOnline.value  = online
  cartBattery.value = batteryPct
  cartStatus.value  = status ?? 'available'
}

async function handleDeverrouiller() {
  if (!isAvailable.value || loading.value) return
  loading.value = true
  error.value   = ''

  try {
    await requestPairing(cartId)
    pairing.value            = true
    countdownRemaining.value = 60
    countdownInterval = setInterval(() => {
      countdownRemaining.value--
      if (countdownRemaining.value <= 0) clearInterval(countdownInterval)
    }, 1000)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function handleCancelPairing() {
  clearInterval(countdownInterval)
  pairing.value    = false
  cartStatus.value = 'available'
  cancelPairing(cartId)
}

async function simulateConfirm() {
  try {
    const res = await fetch(`${SERVER_URL}/simulate/cart-confirm/${cartId}`, { method: 'POST' })
    const data = await res.json()
    if (!data.ok) error.value = data.error
  } catch (e) {
    error.value = 'Erreur simulation : ' + e.message
  }
}

function handlePairingConfirmed({ cartId: confirmedCartId, sessionStartTime }) {
  clearInterval(countdownInterval)
  store.setActiveCart(confirmedCartId)
  store.setSessionStartTime(sessionStartTime)
  router.push('/session')
}

function handlePairingTimeout() {
  clearInterval(countdownInterval)
  pairing.value = false
  error.value   = 'Temps écoulé. Appuyez à nouveau sur Déverrouiller.'
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    await ensureSession()
    store.setConnected(true)

    unsubAvailability = onCartAvailability(handleAvailability)
    unsubConfirmed    = onPairingConfirmed(handlePairingConfirmed)
    unsubTimeout      = onPairingTimeout(handlePairingTimeout)

    watchCart(cartId)
  } catch (e) {
    error.value = e.message
  } finally {
    loadingSession.value = false
  }
})

onUnmounted(() => {
  clearInterval(countdownInterval)
  unsubAvailability?.()
  unsubConfirmed?.()
  unsubTimeout?.()
  unwatchCart(cartId)
})
</script>

<style scoped>
.unlock-screen {
  min-height: 100vh;
  background: #0f0f12;
  color: #fff;
  padding: 28px 20px;
  font-family: sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.center-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  gap: 16px;
  color: rgba(255,255,255,0.4);
}

.spinner {
  width: 32px; height: 32px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #6C63FF;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg) } }

.unlock-header {
  width: 100%;
  max-width: 380px;
  margin-bottom: 28px;
}

.logo {
  font-size: 11px;
  letter-spacing: 3px;
  color: rgba(255,255,255,0.35);
  display: block;
  margin-bottom: 6px;
}

.cart-label {
  font-size: 26px;
  font-weight: 700;
}

/* Status card */
.status-card {
  width: 100%;
  max-width: 380px;
  border-radius: 18px;
  padding: 24px 20px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(255,255,255,0.08);
}

.status-online  { background: rgba(34,197,94,0.08);  border-color: rgba(34,197,94,0.25); }
.status-busy    { background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.25); }
.status-offline { background: rgba(255,255,255,0.04); }

.status-icon {
  font-size: 32px;
}
.status-online  .status-icon { color: #4ade80; }
.status-busy    .status-icon { color: #fbbf24; }
.status-offline .status-icon { color: rgba(255,255,255,0.25); }

.status-text {
  font-size: 15px;
  font-weight: 500;
}
.status-offline .status-text { color: rgba(255,255,255,0.4); }

.battery-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  width: 100%;
}

.battery-bar-wrap {
  flex: 1;
  height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 99px;
  overflow: hidden;
}

.battery-bar {
  height: 100%;
  border-radius: 99px;
  transition: width 0.4s;
}
.bat-high { background: #4ade80; }
.bat-mid  { background: #fbbf24; }
.bat-low  { background: #f87171; }

.battery-pct {
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  min-width: 36px;
  text-align: right;
}

/* Action card */
.action-card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-unlock {
  width: 100%;
  padding: 16px;
  background: #6C63FF;
  color: #fff;
  border: none;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-unlock:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.hint-text {
  font-size: 13px;
  color: rgba(255,255,255,0.4);
  text-align: center;
  margin: 0;
}

/* Pairing card */
.pairing-card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.countdown-ring {
  position: relative;
  width: 120px; height: 120px;
}

.countdown-ring svg {
  transform: rotate(-90deg);
  width: 100%; height: 100%;
}

.ring-bg {
  fill: none;
  stroke: rgba(255,255,255,0.08);
  stroke-width: 6;
}

.ring-progress {
  fill: none;
  stroke: #6C63FF;
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dasharray 1s linear;
}

.countdown-num {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 700;
}

.pairing-hint {
  font-size: 14px;
  color: rgba(255,255,255,0.55);
  text-align: center;
  margin: 0;
}

.btn-secondary {
  width: 100%;
  padding: 14px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.7);
  border-radius: 14px;
  font-size: 14px;
  cursor: pointer;
}

.btn-simulate {
  width: 100%;
  padding: 12px;
  background: rgba(108,99,255,0.12);
  border: 1px solid rgba(108,99,255,0.3);
  color: #a5a0ff;
  border-radius: 14px;
  font-size: 13px;
  cursor: pointer;
}

.error {
  color: #f87171;
  font-size: 13px;
  margin-top: 12px;
  text-align: center;
}
</style>
