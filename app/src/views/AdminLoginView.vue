<!-- src/views/AdminLoginView.vue -->
<template>
  <div class="admin-login-screen">
    <div class="admin-login-card">
      <span class="logo">PLUME</span>
      <h1>Connexion administrateur</h1>
      <p>Accédez au tableau de bord admin avec vos identifiants.</p>

      <form class="login-form" @submit.prevent="handleLogin">
        <input v-model="username" type="text" placeholder="Nom d'utilisateur" autocomplete="username" />
        <input v-model="password" type="password" placeholder="Mot de passe" autocomplete="current-password" />
        <button type="submit" :disabled="loading">
          {{ loading ? 'Connexion...' : 'Se connecter' }}
        </button>
        <p class="error" v-if="error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { connectSocket } from '../api/socket'
import { SERVER_URL } from '../api/config'
import { clearAdminSession, getAdminSession, saveAdminSession } from '../api/adminAuth'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  const session = getAdminSession()
  if (!session) return

  try {
    await connectSocket(session.token)
    router.replace('/admin/select-cart')
  } catch {
    clearAdminSession()
  }
})

async function handleLogin() {
  loading.value = true
  error.value = ''

  try {
    const res = await fetch(`${SERVER_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
      }),
    })

    if (!res.ok) throw new Error('Identifiants incorrects')

    const { token, role } = await res.json()
    if (role !== 'admin') throw new Error('Compte administrateur requis')

    saveAdminSession(token)
    await connectSocket(token)
    router.replace('/admin/select-cart')
  } catch (err) {
    clearAdminSession()
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.admin-login-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top, rgba(74, 222, 128, 0.16), transparent 35%),
    linear-gradient(180deg, #0f0f12 0%, #08090b 100%);
  color: #fff;
}

.admin-login-card {
  width: min(100%, 420px);
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 32px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}

.logo {
  display: inline-block;
  font-size: 11px;
  letter-spacing: 3px;
  color: rgba(255,255,255,0.45);
  margin-bottom: 14px;
}

h1 {
  margin: 0 0 8px;
  font-size: 26px;
}

p {
  margin: 0 0 20px;
  color: rgba(255,255,255,0.55);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

input {
  width: 100%;
  padding: 12px 16px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  box-sizing: border-box;
}

button {
  width: 100%;
  padding: 14px;
  background: #4ade80;
  color: #052e16;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  margin: 0;
  color: #f87171;
  font-size: 13px;
  text-align: center;
}
</style>