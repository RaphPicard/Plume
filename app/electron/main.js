// Electron nécessite CommonJS en interne, mais vite-plugin-electron compile ce
// fichier ESM → CJS automatiquement. On reconstruit __dirname manuellement
// car il n'existe pas nativement en ESM.
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Route d'entrée : '/' par défaut (vue utilisateur), '/admin' pour la vue admin.
// Positionnée via variable d'env avant le lancement : ELECTRON_ENTRY_PATH=/admin vite
const ENTRY_PATH = process.env.ELECTRON_ENTRY_PATH || '/'
const IS_ADMIN = ENTRY_PATH.startsWith('/admin')

function createWindow() {
  const win = new BrowserWindow({
    width: IS_ADMIN ? 1440 : 1280,
    height: IS_ADMIN ? 900 : 800,
    title: IS_ADMIN ? 'PLUME — Administration' : 'PLUME — Gestion de flotte',
    webPreferences: {
      // Empêche le renderer d'accéder aux APIs Node.js directement :
      // la page web ne peut pas lire le système de fichiers, exécuter des
      // commandes shell, etc. Recommandé par la doc sécurité Electron.
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    // En dev, vite-plugin-electron injecte l'URL du serveur Vite (ex. http://localhost:5173/).
    // On supprime le slash final avant d'ajouter ENTRY_PATH pour éviter le double slash
    const base = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')
    win.loadURL(base + ENTRY_PATH)
  } else {
    // En production, on charge index.html depuis le dossier dist/ compilé par Vite.
    // Vue Router (history mode) ne peut pas lire le chemin dans une URL file://,
    // donc on charge d'abord la racine puis on navigue via JS une fois la page prête.
    win.loadFile(path.join(__dirname, '../dist/index.html'))
    if (ENTRY_PATH !== '/') {
      win.webContents.once('did-finish-load', () => {
        win.webContents.executeJavaScript(
          `window.__vue_router__?.push('${ENTRY_PATH}')`
        )
      })
    }
  }
}

// Electron est prêt : créer la fenêtre principale.
app.whenReady().then(() => {
  createWindow()

  // macOS : quand on clique sur l'icône du Dock et qu'il n'y a plus de fenêtre,
  // on en recrée une (comportement natif macOS attendu).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Windows / Linux : quand toutes les fenêtres sont fermées, on quitte l'app.
// Sur macOS on ne quitte pas (l'app reste dans le Dock), d'où la condition.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
