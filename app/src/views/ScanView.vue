<!-- src/views/ScanView.vue -->
<template>
  <div class="scan-screen">

    <header>
      <span class="logo">AUTOCART</span>
      <h1>Scanner un chariot</h1>
      <p>Connexion automatique à une session de scan.</p>
    </header>

    <div class="card">
      <section v-if="loadingSession">
        <h2>Préparation</h2>
        <p class="helper-text">Ouverture de la session de scan...</p>
      </section>

      <section v-else>
        <h2>Scanner un chariot</h2>
        <div class="qr-placeholder">
          <span>▦</span>
          <p>QR Code (caméra à implémenter ???)</p>
        </div>
        <p class="separator">— ou saisir manuellement —</p>
        <input
          v-model="cartId"
          type="text"
          placeholder="Ex: C-042"
        />
        <button @click="handleUnlock" :disabled="loading">
          {{ loading ? 'Connexion au chariot...' : 'Déverrouiller' }}
        </button>
        <p class="error" v-if="error">{{ error }}</p>
      </section>

    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import { connectSocket, unlockCart, onCartStatus, onAlert } from '../api/socket'
import { getScanSession, saveScanSession } from '../api/scanAuth'

const router = useRouter()  //le routeur va permettre de naviguer vers la vue de suivi (TrackingView) après le déverrouillage du chariot
const store  = useCartStore() //appel cart.js pour partager les données du chariot entre les vues ScanView et TrackingView

const cartId   = ref('')
const loadingSession = ref(true)
const loading  = ref(false)
const error    = ref('')

async function ensureScanSession() {
  const existingSession = getScanSession()
  if (existingSession) {
    await connectSocket(existingSession.token)
    return
  }

  try {
    const res = await fetch('http://localhost:3000/session', { method: 'POST' })

    if (!res.ok) throw new Error('Impossible de créer la session de scan')

    const { token } = await res.json()
    saveScanSession(token)
    await connectSocket(token)

  } catch (err) {
    error.value = err.message
    throw err
  }
}

onMounted(async () => {
  loadingSession.value = true
  error.value = ''

  try {
    await ensureScanSession()
    store.setConnected(true)
  } catch {
    // message déjà positionné par ensureScanSession
  } finally {
    loadingSession.value = false
  }
})

// --- Déverrouillage chariot ---
async function handleUnlock() {
  if (!cartId.value.trim()) {
    error.value = 'Entrez un identifiant de chariot'
    return
  }

  loading.value = true
  error.value   = ''

  try {
    await unlockCart(cartId.value.trim()) // api/socket.js : socket.emit('unlock_cart', { cartId }, callback)
    // l'event 'unlock_cart' est dans events/user.js

    // Enregistrer le chariot actif dans le store
    store.setActiveCart(cartId.value.trim())  // activeCartId.value = cartId

    // S'abonner aux données du chariot (Observers WebSocket) envoyé par le serveur et mettre à jour le store PINIA ==> MAJ AUTO de cartStatus et alert
    onCartStatus((status) => store.updateStatus(status))    // onCartStatus() dans api/socket.js : socket.on('cart_status', callback) => MAJ du store : cartStatus.value = status
    onAlert((alert) => store.addAlert(alert))

    // Naviguer vers l'écran de suivi
    router.push('/tracking')

  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.scan-screen {
  min-height: 100vh;
  background: #0f0f12;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  font-family: sans-serif;
}

.logo {
  font-size: 11px;
  letter-spacing: 3px;
  color: rgba(255,255,255,0.4);
}

h1 { font-size: 28px; margin: 8px 0 4px; }
p  { color: rgba(255,255,255,0.5); margin: 0; }

.card {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 32px;
  width: 100%;
  max-width: 380px;
  margin-top: 32px;
}

h2 { font-size: 18px; margin: 0 0 20px; }

input {
  width: 100%;
  padding: 12px 16px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  margin-bottom: 12px;
  box-sizing: border-box;
}

button {
  width: 100%;
  padding: 14px;
  background: #6C63FF;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
}

button:disabled { opacity: 0.5; cursor: not-allowed; }

.error {
  color: #f87171;
  font-size: 13px;
  margin-top: 10px;
  text-align: center;
}

.helper-text {
  text-align: center;
}

.qr-placeholder {
  height: 160px;
  border: 2px dashed rgba(255,255,255,0.15);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.3);
  font-size: 48px;
  margin-bottom: 16px;
}

.qr-placeholder p { font-size: 12px; margin-top: 8px; }
.separator { text-align: center; font-size: 12px; margin: 8px 0; }
</style>