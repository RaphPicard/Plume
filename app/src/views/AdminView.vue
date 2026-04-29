<!-- src/views/AdminView.vue -->
<!-- Dashboard admin : supervision de la flotte, données capteurs temps réel, commandes -->
<template>
  <div class="admin-screen">

    <header class="admin-header">
      <span class="logo">AUTOCART</span>
      <h1>Dashboard Admin</h1>
      <span class="badge-admin">Administrateur</span>
      <button class="logout-btn" type="button" @click="logoutAdmin">Déconnexion</button>
    </header>

    <!-- Chargement initial -->
    <div class="loading" v-if="loading">Chargement de la flotte...</div>

    <template v-else>
      <div class="admin-content">
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
            <iframe
              class="video-frame"
              :src="currentStreamUrl"
              title="Flux vidéo chariot"
              allowfullscreen
            ></iframe>
          </div>
        </section>

        <!-- Grille des chariots -->
        <div class="fleet-grid">
        <div
          class="cart-card"
          v-for="cart in store.fleet"
          :key="cart.cartId"
          :class="{ online: cart.online, 'in-use': cart.status === 'in_use' }"
        >
          <!-- En-tête de la carte -->
          <div class="cart-card-header">
            <span class="cart-name">{{ cart.cartId }}</span>
            <span class="status-dot" :class="cart.online ? 'online' : 'offline'"></span>
          </div>

          <!-- Statut -->
          <div class="cart-status-line">
            <span class="status-text">{{ statusLabel(cart) }}</span>
            <span class="owner" v-if="cart.ownerId">👤 {{ cart.ownerId }}</span>
          </div>

          <!-- Métriques capteurs (si données disponibles) -->
          <div class="metrics" v-if="store.sensorData[cart.cartId]">
            <div class="metric">
              <span class="val">{{ store.sensorData[cart.cartId].weightKg ?? '—' }} kg</span>
              <span class="lbl">Charge</span>
            </div>
            <div class="metric">
              <span class="val">{{ store.sensorData[cart.cartId].batteryPct ?? '—' }}%</span>
              <span class="lbl">Batterie</span>
            </div>
            <div class="metric">
              <span class="val">{{ store.sensorData[cart.cartId].speedMs ?? '—' }} m/s</span>
              <span class="lbl">Vitesse</span>
            </div>
          </div>
          <div class="metrics-empty" v-else>Aucune donnée capteur</div>

          <!-- Position (si disponible) -->
          <div class="position" v-if="store.positions[cart.cartId]">
            📍 x={{ store.positions[cart.cartId].x }}, y={{ store.positions[cart.cartId].y }}
          </div>

          <!-- Commandes admin -->
          <div class="cart-controls" v-if="cart.online">
            <!-- Déplacement directionnel -->
            <div class="direction-pad">
              <button class="dir-btn" @click="move(cart.cartId, 'forward')">▲</button>  
              <div class="dir-row">
                <button class="dir-btn" @click="move(cart.cartId, 'left')">◀</button>
                <button class="dir-btn stop" @click="move(cart.cartId, 'stop')">■</button>
                <button class="dir-btn" @click="move(cart.cartId, 'right')">▶</button>
              </div>
              <button class="dir-btn" @click="move(cart.cartId, 'backward')">▼</button>
            </div>

            <!-- Actions rapides -->
            <div class="quick-actions">
              <button class="action-btn recall" @click="recall(cart.cartId)">
                ↩ Rappel
              </button>
              <button class="action-btn force-stop" @click="forceStop(cart.cartId)">
                ⛔ Arrêt forcé
              </button>
            </div>
          </div>
          <div class="offline-msg" v-else>Chariot hors ligne</div>
        </div>

        <!-- Aucun chariot -->
        <div class="empty-fleet" v-if="store.fleet.length === 0">
          Aucun chariot enregistré.
        </div>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import {
  getFleet,
  adminForceStop,
  adminMove,
  adminRecall,
  onCartOnline,
  onCartOffline,
  onSensorUpdate,
  onCartPosition,
  disconnectSocket,
} from '../api/socket'
import { clearAdminSession } from '../api/adminAuth'

const store   = useCartStore()
const router = useRouter()
const loading = ref(true)
const selectedStream = ref('raw')

const STREAM_URLS = {
  raw: 'http://192.168.1.10:5500/stream/raw',
  annotated: 'http://192.168.1.10:5500/stream/annotated',
}

const currentStreamUrl = computed(() => STREAM_URLS[selectedStream.value])

// Désabonnements à nettoyer
let unsubOnline, unsubOffline, unsubSensor, unsubPosition

onMounted(async () => {
  // Charger la liste initiale des chariots
  const carts = await getFleet()
  store.setFleet(carts)
  loading.value = false

  // S'abonner aux événements temps réel
  unsubOnline   = onCartOnline((data)   => store.setCartOnline(data.cartId))
  unsubOffline  = onCartOffline((data)  => store.setCartOffline(data.cartId))
  unsubSensor   = onSensorUpdate((data) => store.updateSensorData(data))
  unsubPosition = onCartPosition((data) => store.updatePosition(data))
})

onUnmounted(() => {
  unsubOnline?.()
  unsubOffline?.()
  unsubSensor?.()
  unsubPosition?.()
})

// --- Commandes ---
function forceStop(cartId) {
  adminForceStop(cartId)
}

function move(cartId, direction) {
  adminMove(cartId, direction)    // api/socket.js : socket.emit('admin_move', { cartId, direction }, callback)
}

function recall(cartId) {
  adminRecall(cartId)
}

function logoutAdmin() {
  clearAdminSession()
  disconnectSocket()
  router.replace('/admin')
}

// --- Helpers ---
function statusLabel(cart) {
  if (!cart.online) return 'Hors ligne'
  if (cart.status === 'in_use') return 'En cours d\'utilisation'
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

.logout-btn {
  margin-left: auto;
  width: auto;
  padding: 10px 14px;
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.28);
  color: #fca5a5;
  border-radius: 12px;
  cursor: pointer;
}

.logout-btn:hover {
  background: rgba(248, 113, 113, 0.18);
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

.video-panel {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 18px;
  width: 640px;
  flex: 0 0 640px;
}

.admin-content {
  display: flex;
  align-items: flex-start;
  gap: 16px;
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
  aspect-ratio: 4 / 3;
}

.video-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

@media (max-width: 760px) {
  .video-panel-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .video-frame {
    height: 100%;
  }
}

.fleet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  flex: 1;
  align-content: start;
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

.owner { color: #fbbf24; }

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
  grid-column: 1 / -1;
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
