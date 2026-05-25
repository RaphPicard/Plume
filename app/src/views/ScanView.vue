<!-- src/views/ScanView.vue -->
<template>
  <div class="scan-screen">

    <header>
      <span class="logo">PLUME</span>
      <h1>Scanner un chariot</h1>
      <p>Connexion automatique à une session de scan.</p>
    </header>

    <div class="card">
      <section v-if="loadingSession">
        <h2>Préparation</h2>
        <p class="helper-text">Ouverture de la session de scan...</p>
      </section>

      <section v-else>
        <h2>Scanner un chariot</h2> <!-- dépendance@zxing/browser pour lecture QR CODE-->
        <div class="scanner-frame" :style="scannerFrameStyle">
          <video            
            ref="videoRef" 
            class="scanner-video"
            autoplay
            muted
            playsinline
          ></video>
          <div class="scanner-overlay">
            <span class="scanner-corner scanner-corner-tl"></span>
            <span class="scanner-corner scanner-corner-tr"></span>
            <span class="scanner-corner scanner-corner-bl"></span>
            <span class="scanner-corner scanner-corner-br"></span>
          </div>
        </div>
        <div class="scanner-label">
          <span>{{ cameraStatusLabel }}</span>
          <button class="camera-btn" type="button" @click="toggleCamera" :disabled="cameraBusy">
            {{ cameraActive ? 'Couper la caméra' : 'Activer la caméra' }}
          </button>
        </div>
        <p class="helper-text">{{ scannerHint }}</p>

        <p class="separator">— ou saisir manuellement —</p>

        <input
          v-model="cartId"
          type="text"
          placeholder="Ex: C-042"
        />
        <button @click="handleUnlock">
          Déverrouiller
        </button>
        <p class="error" v-if="error">{{ error }}</p>
      </section>

    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../store/cart'
import { connectSocket } from '../api/socket'
import { getScanSession, saveScanSession } from '../api/scanAuth'
import { SERVER_URL } from '../api/config'
import { BrowserMultiFormatReader } from '@zxing/browser'

const router = useRouter()  //le routeur va permettre de naviguer vers la vue de suivi (TrackingView) après le déverrouillage du chariot
const store  = useCartStore() //appel cart.js pour partager les données du chariot entre les vues ScanView et TrackingView

const cartId   = ref('')
const loadingSession = ref(true)
const error    = ref('')
const videoRef = ref(null)
const cameraActive = ref(false)
const cameraBusy = ref(false)
const videoAspectRatio = ref(null)
const scannerFrameStyle = computed(() =>
  videoAspectRatio.value ? { aspectRatio: videoAspectRatio.value } : {}
)
const scannerHint = ref('Initialisation du lecteur QR...')
const cameraStatusLabel = computed(() => {
  // Texte d'état affiché sous la caméra.
  // On sépare l'état technique du lecteur et la consigne utilisateur pour éviter de répéter le même message.
  if (cameraBusy.value) return 'Ouverture de la caméra...'
  if (!cameraActive.value) return 'Caméra inactive'
  return 'Caméra active'
})

// Deux lecteurs possibles selon le navigateur :
// - BarcodeDetector (Chromium natif, rapide)
// - ZXing en fallback (Safari/WebKit, Firefox, WebView iOS)
let mediaStream = null
let barcodeDetector = null
let zxingReader = null
let zxingControls = null
let scanFrameId = null
let scanStopped = false
let lastDetectedValue = ''
let lastDetectedAt = 0

function stopScanLoop() {
  // Annule la boucle de lecture en cours pour éviter de garder un traitement actif
  // quand l'utilisateur coupe la caméra ou quitte la vue.
  if (scanFrameId !== null) {
    cancelAnimationFrame(scanFrameId)
    scanFrameId = null
  }
  if (zxingControls) {
    zxingControls.stop()
    zxingControls = null
  }
}

function stopCameraStream() {
  // Stoppe proprement la lecture et libère les ressources vidéo.
  stopScanLoop()

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop())
    mediaStream = null
  }

  if (videoRef.value) {
    videoRef.value.srcObject = null
  }

  cameraActive.value = false
}

function normalizeScannedValue(rawValue) {
  // Les QR codes peuvent contenir un identifiant brut ou une URL.
  // Si on reçoit une URL, on récupère le dernier segment du chemin pour en extraire l'ID du chariot.
  const value = String(rawValue ?? '').trim()
  if (!value) return ''

  try {
    const parsedUrl = new URL(value)
    const segments = parsedUrl.pathname.split('/').filter(Boolean)
    return segments.length > 0 ? segments[segments.length - 1] : value // si c'est une URL, on prend le dernier segment; sinon on retourne la valeur brute
  } catch {
    return value
  }
}

async function handleDetectedCode(rawValue) {
  // Traite une lecture QR unique: normalisation, anti-doublon et déverrouillage automatique.
  const normalizedValue = normalizeScannedValue(rawValue)

  if (!normalizedValue) return

  const now = Date.now()
  if (normalizedValue === lastDetectedValue && now - lastDetectedAt < 1500) {
    return
  }

  lastDetectedValue = normalizedValue
  lastDetectedAt = now

  cartId.value = normalizedValue
  scannerHint.value = 'QR code détecté. Ouverture du chariot...'

  // On coupe la caméra avant de lancer le flux métier pour éviter plusieurs lectures du même code.
  stopCameraStream()
  await handleUnlock()
}

async function scanFrame() {
  // Boucle de scan continue. ZXing lit la vidéo à intervalle régulier jusqu'à détection ou arrêt manuel.
  if (scanStopped || !barcodeDetector || !videoRef.value) return

  try {
    const detections = await barcodeDetector.detect(videoRef.value)
    if (detections.length > 0) {
      await handleDetectedCode(detections[0].rawValue)
      return
    }
  } catch {
    scannerHint.value = 'Lecture en cours...'
  }

  scanFrameId = requestAnimationFrame(scanFrame)
}

async function startCamera() {
  // Démarre la caméra et initialise le bon lecteur QR selon le navigateur.
  if (cameraBusy.value || cameraActive.value) return

  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = 'La caméra n’est pas disponible dans ce navigateur'
    scannerHint.value = 'Saisissez l’identifiant manuellement'
    return
  }

  cameraBusy.value = true
  error.value = ''
  scannerHint.value = 'Demande d’accès à la caméra...'

  try {
    const useNativeDetector = 'BarcodeDetector' in window
    if (useNativeDetector) {
      barcodeDetector = barcodeDetector || new window.BarcodeDetector({ formats: ['qr_code'] })
    } else {
      zxingReader = zxingReader || new BrowserMultiFormatReader()
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'environment',
      },
    })

    if (!videoRef.value) {
      throw new Error('Le lecteur vidéo n’est pas prêt')
    }

    videoRef.value.srcObject = mediaStream
    await videoRef.value.play()
    // On garde l'aspect-ratio CSS fixe (4/3) ; la vidéo est cropée par object-fit: cover.

    scanStopped = false
    cameraActive.value = true
    scannerHint.value = 'Cadrez le QR code du chariot dans la zone de scan'
    stopScanLoop()

    if (useNativeDetector) {
      // Boucle native via BarcodeDetector (Chromium)
      scanFrameId = requestAnimationFrame(scanFrame)
    } else {
      // Fallback ZXing (Safari, WebView iOS, Firefox)
      zxingControls = await zxingReader.decodeFromVideoElement(videoRef.value, (result) => {
        if (result && !scanStopped) {
          handleDetectedCode(result.getText())
        }
      })
    }
  } catch (err) {
    stopCameraStream()
    const message = err instanceof Error ? err.message : 'Impossible d’ouvrir la caméra'
    error.value = message
    scannerHint.value = 'Saisie manuelle disponible ci-dessous'
  } finally {
    cameraBusy.value = false
  }
}

function toggleCamera() {
  // Le même bouton sert à démarrer et à arrêter le flux caméra.
  if (cameraActive.value) {
    scanStopped = true
    scannerHint.value = 'Caméra arrêtée. Vous pouvez la relancer ou saisir manuellement.'
    stopCameraStream()
    return
  }

  void startCamera()
}

async function ensureScanSession() {
  // Récupère ou crée la session de scan avant d'autoriser le lecteur QR à s'ouvrir.
  const existingSession = getScanSession()
  if (existingSession) {
    await connectSocket(existingSession.token)
    return
  }


  try {
    const res = await fetch(`${SERVER_URL}/session`, { method: 'POST' })

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
  // À l'ouverture de la vue, on sécurise d'abord la session socket puis on propose la caméra.
  loadingSession.value = true
  error.value = ''

  try {
    await ensureScanSession()
    store.setConnected(true)
    await startCamera()
  } catch {
    // message déjà positionné par ensureScanSession
  } finally {
    loadingSession.value = false
  }
})

onBeforeUnmount(() => {
  // Nettoyage final pour éviter de laisser la caméra active après sortie de la page.
  scanStopped = true
  stopCameraStream()
})

// --- Déverrouillage chariot ---
function handleUnlock() {
  const id = cartId.value.trim()
  if (!id) {
    error.value = 'Entrez un identifiant de chariot'
    return
  }
  stopCameraStream()
  router.push(`/cart/${id}`)
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

.scanner-frame {
  position: relative;
  aspect-ratio: 4/3;
  max-height: 40vh;        /* limite la hauteur quoi qu'il arrive */
  margin-inline: auto;
  width: 100%;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px;
  margin-bottom: 16px;
  background: linear-gradient(180deg, rgba(108,99,255,0.18), rgba(255,255,255,0.03));
}

.scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #08080b;
}

.scanner-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 16px;
  box-shadow: inset 0 0 0 9999px rgba(0,0,0,0.22);
}

.scanner-corner {
  position: absolute;
  width: 24px;
  height: 24px;
  border-color: #8b87ff;
  border-style: solid;
}

.scanner-corner-tl { top: 14px; left: 14px; border-width: 2px 0 0 2px; }
.scanner-corner-tr { top: 14px; right: 14px; border-width: 2px 2px 0 0; }
.scanner-corner-bl { bottom: 14px; left: 14px; border-width: 0 0 2px 2px; }
.scanner-corner-br { bottom: 14px; right: 14px; border-width: 0 2px 2px 0; }

.scanner-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px 8px;
}

.scanner-label span {
  font-size: 12px;
  color: rgba(255,255,255,0.8);
  line-height: 1.3;
}

.camera-btn {
  width: auto;
  padding: 10px 12px;
  margin-top: 0;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  font-size: 12px;
  white-space: nowrap;
}

.camera-btn:disabled {
  opacity: 0.65;
}

.separator { text-align: center; font-size: 12px; margin: 8px 0; }
</style>