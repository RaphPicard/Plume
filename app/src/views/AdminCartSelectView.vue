<!-- src/views/AdminCartSelectView.vue -->
<template>
  <div class="admin-select-screen">
    <header class="admin-select-header">
      <span class="logo">PLUME</span>
      <div>
        <h1>Choisir un chariot</h1>
        <p>Sélectionnez le cart à visualiser dans le tableau de bord.</p>
      </div>
      <button class="logout-btn" type="button" @click="logoutAdmin">Déconnexion</button>
    </header>

    <div class="loading" v-if="loading">Chargement de la flotte...</div>

    <div class="fleet-grid" v-else>
      <button
        v-for="cart in store.fleet"
        :key="cart.cartId"
        class="cart-card"
        type="button"
        @click="openCart(cart.cartId)"
      >
        <div class="cart-card-header">
          <span class="cart-name">{{ cart.cartId }}</span>
          <span class="status-dot" :class="cart.online ? 'online' : 'offline'"></span>
        </div>

        <div class="cart-status-line">
          <span>{{ statusLabel(cart) }}</span>
          <span class="owner" v-if="cart.ownerId">👤 {{ cart.ownerId }}</span>
        </div>

        <p class="card-hint">Ouvrir le dashboard vidéo et capteurs</p>
      </button>

      <div class="empty-fleet" v-if="store.fleet.length === 0">
        Aucun chariot enregistré.
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import { getFleet, disconnectSocket, onCartOnline, onCartOffline, onCartStatusUpdate } from '../api/socket'
import { clearAdminSession } from '../api/adminAuth'
import { clearAdminSelectedCart, saveAdminSelectedCart } from '../api/adminCartSelection'

const router = useRouter()
const store = useCartStore()
const loading = ref(true)

let unsubOnline, unsubOffline, unsubStatusUpdate

onMounted(async () => {
  const carts = await getFleet()
  store.setFleet(carts)
  loading.value = false

  unsubOnline        = onCartOnline((data)        => store.setCartOnline(data.cartId))
  unsubOffline       = onCartOffline((data)       => store.setCartOffline(data.cartId))
  unsubStatusUpdate  = onCartStatusUpdate((data)  => store.updateCartFleetStatus(data))
})

onUnmounted(() => {
  unsubOnline?.()
  unsubOffline?.()
  unsubStatusUpdate?.()
})

function openCart(cartId) {
  saveAdminSelectedCart(cartId)
  router.push(`/admin/dashboard/${cartId}`)
}

function logoutAdmin() {
  clearAdminSelectedCart()
  clearAdminSession()
  disconnectSocket()
  router.replace('/admin')
}

function statusLabel(cart) {
  if (!cart.online) return 'Hors ligne'
  if (cart.status === 'paired') return 'En cours d\'utilisation'
  if (cart.status === 'pairing_pending') return 'Appairage en cours...'
  return 'Disponible'
}
</script>

<style scoped>
.admin-select-screen {
  min-height: 100vh;
  background: #0f0f12;
  color: #fff;
  padding: 24px 20px;
  font-family: sans-serif;
}

.admin-select-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 28px;
}

.logo {
  font-size: 11px;
  letter-spacing: 3px;
  color: rgba(255,255,255,0.4);
}

h1 { font-size: 22px; margin: 0 0 4px; }
p { color: rgba(255,255,255,0.5); margin: 0; }

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

.loading {
  text-align: center;
  color: rgba(255,255,255,0.4);
  padding: 60px;
}

.fleet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.cart-card {
  text-align: left;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 18px;
  color: inherit;
  cursor: pointer;
}

.cart-card:hover {
  border-color: rgba(74,222,128,0.3);
}

.cart-card-header,
.cart-status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cart-card-header { margin-bottom: 8px; }
.cart-name { font-size: 18px; font-weight: 600; }

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.status-dot.online { background: #4ade80; }
.status-dot.offline { background: rgba(255,255,255,0.2); }

.cart-status-line {
  font-size: 12px;
  color: rgba(255,255,255,0.5);
}

.owner { color: #fbbf24; }

.card-hint {
  margin-top: 14px;
  font-size: 12px;
  color: rgba(255,255,255,0.35);
}

.empty-fleet {
  color: rgba(255,255,255,0.3);
  text-align: center;
  padding: 60px;
  grid-column: 1 / -1;
}
</style>