<!-- src/views/AdminView.vue -->
<template>
  <div class="admin-screen">
    <header class="admin-header">
      <span class="logo">AUTOCART</span>
      <h1>Dashboard Admin - {{ cartId }}</h1>
      <span class="badge-admin">Administrateur</span>
      <button class="change-cart-btn" type="button" @click="changeCart">Changer de chariot</button>
      <button class="logout-btn" type="button" @click="logoutAdmin">Déconnexion</button>
    </header>

    <div class="loading" v-if="loading">Chargement de la flotte...</div>

    <template v-else>
      <div class="admin-content" v-if="selectedCart">
        <section class="video-panel">
          <div class="video-panel-header">
            <h2>Flux vidéo</h2>
            <div class="video-switch" role="tablist" aria-label="Choix du flux vidéo">
              <button
                class="video-switch-btn"
                :class="{ active: selectedStream === 'raw' }"
                type="button"
                @click="selectedStream = 'raw'"
              >
                Flux brut
              </button>
              <button
                class="video-switch-btn"
                :class="{ active: selectedStream === 'annotated' }"
                type="button"
                @click="selectedStream = 'annotated'"
              >
                Flux annoté
              </button>
            </div>
          </div>

          <div class="video-frame-wrap">
            <img
              class="video-frame"
              :src="currentStreamUrl"
              alt="Flux vidéo chariot"
            />
          </div>
        </section>

        <div class="fleet-grid single-card-layout">
          <div class="cart-card" :class="{ online: selectedCart.online, 'in-use': selectedCart.status === 'in_use' }">
            <div class="cart-card-header">
              <span class="cart-name">{{ selectedCart.cartId }}</span>
              <span class="status-dot" :class="selectedCart.online ? 'online' : 'offline'"></span>
            </div>

            <div class="cart-status-line">
              <span class="status-text">{{ statusLabel(selectedCart) }}</span>
              <span class="owner-group" v-if="selectedCart.ownerId">
                <span class="owner">👤 {{ selectedCart.ownerId }}</span>
                <button class="kick-inline-btn" @click="kick(selectedCart.cartId)">✕ Expulser</button>
              </span>
            </div>

            <div class="metrics" v-if="selectedSensorData">
              <div class="metric">
                <span class="val">{{ selectedSensorData.weightKg ?? '—' }} kg</span>
                <span class="lbl">Charge</span>
              </div>
              <div class="metric">
                <span class="val">{{ selectedSensorData.batteryPct ?? '—' }}%</span>
                <span class="lbl">Batterie</span>
              </div>
              <div class="metric">
                <span class="val">{{ selectedSensorData.speedMs ?? '—' }} m/s</span>
                <span class="lbl">Vitesse</span>
              </div>
            </div>
            <div class="metrics-empty" v-else>Aucune donnée capteur</div>

            <div class="position" v-if="selectedPosition">
              📍 x={{ selectedPosition.x }}, y={{ selectedPosition.y }}
            </div>

            <div class="cart-controls" v-if="selectedCart.online">
              <div class="direction-pad">
                <button class="dir-btn" @click="move(selectedCart.cartId, 'forward')">▲</button>
                <div class="dir-row">
                  <button class="dir-btn" @click="move(selectedCart.cartId, 'left')">◀</button>
                  <button class="dir-btn stop" @click="move(selectedCart.cartId, 'stop')">■</button>
                  <button class="dir-btn" @click="move(selectedCart.cartId, 'right')">▶</button>
                </div>
                <button class="dir-btn" @click="move(selectedCart.cartId, 'backward')">▼</button>
              </div>

              <div class="quick-actions">
                <button class="action-btn recall" @click="recall(selectedCart.cartId)">
                  ↩ Rappel
                </button>
                <button class="action-btn force-stop" @click="forceStop(selectedCart.cartId)">
                  ⛔ Arrêt forcé
                </button>
              </div>
            </div>
            <div class="offline-msg" v-else>Chariot hors ligne</div>
          </div>
        </div>
      </div>

      <div class="empty-fleet" v-else>
        Chariot introuvable.
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import {
  getFleet,
  adminForceStop,
  adminMove,
  adminRecall,
  adminKickCart,
  onCartOnline,
  onCartOffline,
  onSensorUpdate,
  onCartPosition,
  onCartStatusUpdate,
  disconnectSocket,
} from '../api/socket'
import { clearAdminSelectedCart } from '../api/adminCartSelection'
import { clearAdminSession } from '../api/adminAuth'
import { STREAM_URLS } from '../api/config'

const store = useCartStore()
const router = useRouter()
const route = useRoute()
const loading = ref(true)
const selectedStream = ref('raw')

const cartId = computed(() => String(route.params.cartId ?? ''))
const selectedCart = computed(() => store.fleet.find(cart => cart.cartId === cartId.value) ?? null)
const selectedSensorData = computed(() => store.sensorData[cartId.value])
const selectedPosition = computed(() => store.positions[cartId.value])

const currentStreamUrl = computed(() => STREAM_URLS[selectedStream.value])

let unsubOnline, unsubOffline, unsubSensor, unsubPosition, unsubStatusUpdate

onMounted(async () => {
  const carts = await getFleet()
  store.setFleet(carts)
  loading.value = false

  unsubOnline       = onCartOnline((data)       => store.setCartOnline(data.cartId))
  unsubOffline      = onCartOffline((data)      => store.setCartOffline(data.cartId))
  unsubSensor       = onSensorUpdate((data)     => store.updateSensorData(data))
  unsubPosition     = onCartPosition((data)     => store.updatePosition(data))
  unsubStatusUpdate = onCartStatusUpdate((data) => store.updateCartFleetStatus(data))
})

onUnmounted(() => {
  unsubOnline?.()
  unsubOffline?.()
  unsubSensor?.()
  unsubPosition?.()
  unsubStatusUpdate?.()
})

function forceStop(cartId) {
  adminForceStop(cartId)
}

function move(cartId, direction) {
  adminMove(cartId, direction)
}

function recall(cartId) {
  adminRecall(cartId)
}

function changeCart() {
  router.push('/admin/select-cart')
}

function logoutAdmin() {
  clearAdminSelectedCart()
  clearAdminSession()
  disconnectSocket()
  router.replace('/admin')
}

function kick(cartId) {
  adminKickCart(cartId)
}

function statusLabel(cart) {
  if (!cart.online) return 'Hors ligne'
  if (cart.status === 'paired') return 'En cours d\'utilisation'
  if (cart.status === 'pairing_pending') return 'Appairage en cours...'
  return 'Disponible'
}
</script>

<style scoped>
.admin-screen {
  min-height: 100vh;
  background: #0f0f12;
  color: #fff;
  padding: 24px 20px;
  font-family: sans-serif;
}

.admin-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 28px;
}

.change-cart-btn,
.logout-btn {
  width: auto;
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
}

.change-cart-btn {
  margin-left: auto;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  color: #fff;
}

.logout-btn {
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.28);
  color: #fca5a5;
}

.logo {
  font-size: 11px;
  letter-spacing: 3px;
  color: rgba(255,255,255,0.4);
}

h1 { font-size: 22px; margin: 0; flex: 1; }

.badge-admin {
  background: rgba(168,85,247,0.15);
  border: 1px solid rgba(168,85,247,0.4);
  color: #c084fc;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
}

.loading {
  text-align: center;
  color: rgba(255,255,255,0.4);
  padding: 60px;
}

.admin-content {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.video-panel {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 18px;
  width: 640px;
  flex: 0 0 640px;
}

.video-panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  width: min(640px, 100%);
}

.video-panel-header h2 {
  margin: 0;
  font-size: 16px;
}

.video-switch {
  display: inline-flex;
  gap: 8px;
}

.video-switch-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 10px;
  color: rgba(255,255,255,0.85);
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
}

.video-switch-btn.active {
  background: rgba(74,222,128,0.15);
  border-color: rgba(74,222,128,0.55);
  color: #86efac;
}

.video-frame-wrap {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.12);
  background: #0a0a0c;
  width: min(640px, 100%);
}

.video-frame {
  display: block;
  width: 100%;
  height: auto;
}

.fleet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  flex: 1;
  align-content: start;
}

.single-card-layout {
  grid-template-columns: minmax(300px, 1fr);
}

.cart-card {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 18px;
}

.cart-card.online {
  border-color: rgba(74,222,128,0.25);
}

.cart-card.in-use {
  border-color: rgba(251,191,36,0.3);
}

.cart-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.cart-name {
  font-size: 18px;
  font-weight: 600;
}

.status-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
}
.status-dot.online  { background: #4ade80; }
.status-dot.offline { background: rgba(255,255,255,0.2); }

.cart-status-line {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255,255,255,0.5);
  margin-bottom: 14px;
}

.owner-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.owner { color: #fbbf24; }

.kick-inline-btn {
  padding: 2px 8px;
  background: rgba(251,191,36,0.12);
  border: 1px solid rgba(251,191,36,0.3);
  color: #fbbf24;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.metric {
  background: rgba(255,255,255,0.05);
  border-radius: 10px;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.val { font-size: 16px; font-weight: 600; }
.lbl { font-size: 10px; color: rgba(255,255,255,0.4); }

.metrics-empty {
  font-size: 11px;
  color: rgba(255,255,255,0.25);
  text-align: center;
  padding: 10px 0;
  margin-bottom: 12px;
}

.position {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  margin-bottom: 14px;
}

.cart-controls {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.direction-pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.dir-row {
  display: flex;
  gap: 4px;
}

.dir-btn {
  width: 36px; height: 36px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}

.dir-btn.stop {
  background: rgba(239,68,68,0.15);
  border-color: rgba(239,68,68,0.3);
  color: #f87171;
}

.dir-btn:hover { background: rgba(255,255,255,0.14); }

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.action-btn {
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid;
  width: 100%;
}

.action-btn.recall {
  background: rgba(99,102,241,0.12);
  border-color: rgba(99,102,241,0.3);
  color: #a5b4fc;
}

.action-btn.force-stop {
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.3);
  color: #f87171;
}

.offline-msg {
  font-size: 12px;
  color: rgba(255,255,255,0.25);
  text-align: center;
  padding: 12px 0 4px;
}

.empty-fleet {
  color: rgba(255,255,255,0.3);
  text-align: center;
  padding: 60px;
}

@media (max-width: 1200px) {
  .admin-content {
    flex-direction: column;
  }

  .video-panel {
    width: min(100%, 640px);
    flex-basis: auto;
  }
}

@media (max-width: 760px) {
  .fleet-grid {
    grid-template-columns: 1fr;
  }
}
</style>
