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

    <button class="stop-btn" @click="handleStop">
      Arrêter le suivi
    </button>

  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import { stopCart } from '../api/socket'

const router = useRouter()
const store  = useCartStore()

// Rediriger si on arrive ici sans chariot actif
if (!store.hasActiveCart) {
  router.replace('/')
}

async function handleStop() {
  await stopCart()
  store.clearActiveCart()
  router.push('/')
}
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