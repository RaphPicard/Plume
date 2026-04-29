<!-- src/views/ScanView.vue -->
<!-- Point d'entrée de la vue de connexion/QR_code , fais le lien entre le frontend et le serveur WebSocket (socket.js) -->
<template>
  <div class="scan-screen">

    <header>
      <span class="logo">AUTOCART</span>
      <h1>Prêt à partir ?</h1>
      <p>Entrez l'identifiant du chariot</p>
    </header>

    <!-- Formulaire de login + scan -->
    <div class="card">

      <!-- Étape 1 : login (si pas encore connecté) -->
      <section v-if="!store.isConnected">
        <h2>Connexion</h2>
        <input
          v-model="username"
          type="text"
          placeholder="Nom d'utilisateur"
        />
        <input
          v-model="password"
          type="password"
          placeholder="Mot de passe"
        />
        <button @click="handleLogin" :disabled="loading">
          {{ loading ? 'Connexion...' : 'Se connecter' }}
        </button>
        <p class="error" v-if="error">{{ error }}</p>
      </section>

      <!-- Étape 2 : saisie du chariot (si connecté) -->
      <section v-else>
        <h2>Scanner un chariot</h2>
        <div class="qr-placeholder">
          <span>▦</span>
          <p>QR Code (caméra à implémenter)</p>
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
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import { connectSocket, unlockCart, onCartStatus, onAlert, onConnected, onConnectError } from '../api/socket'

const router = useRouter()  //le routeur va permettre de naviguer vers la vue de suivi (TrackingView) après le déverrouillage du chariot
const store  = useCartStore() //appel cart.js pour partager les données du chariot entre les vues ScanView et TrackingView

// --- État local du composant ---
const username = ref('')
const password = ref('')
const cartId   = ref('')
const loading  = ref(false)
const error    = ref('')

// --- Login : appel HTTP pour récupérer le JWT, puis connexion WS ---
async function handleLogin() {
  loading.value = true
  error.value   = ''

  try {
    // Appel HTTP classique vers le serveur
    const res = await fetch('http://localhost:3000/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value,
        password: password.value
      })
    })

    if (!res.ok) throw new Error('Identifiants incorrects')

    const { token, role } = await res.json()

    // Écouter la confirmation de connexion
    const unsubOk  = onConnected(() => {
      store.setConnected(true)
      unsubOk()
      unsubErr()
      // Les admins sont redirigés directement vers le dashboard
      if (role === 'admin') router.push('/admin') // ==> REDIRECTION VUE
    })
    const unsubErr = onConnectError((err) => {
      error.value = 'Connexion serveur échouée : ' + err.message
      unsubOk()
      unsubErr()
    })

    // Connexion WebSocket après les listeners onConnected et onConnectError pour gérer le résultat de la connexion
    connectSocket(token)

  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

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
    store.setActiveCart(cartId.value.trim())

    // S'abonner aux données du chariot (Observers WebSocket)
    onCartStatus((status) => store.updateStatus(status))
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
/* "scoped" = ces styles s'appliquent UNIQUEMENT à ce composant */
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