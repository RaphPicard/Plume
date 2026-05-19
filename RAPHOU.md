# RAPHOU.md — Projet Transversal : Gestion de flotte de chariots connectés

---

## Déroulé de présentation orale

### Intro — Lancer le projet et montrer les interfaces

> "Le projet s'appelle PLUME. C'est un système de gestion de flotte de chariots à bagages connectés pour aéroport. Il y a trois acteurs : l'utilisateur (agent au sol), l'administrateur (superviseur), et le chariot lui-même (Raspberry Pi)."

**Lancer le projet** → voir la section [Lancement courant dans le README](README.md#lancement-courant).

**Montrer les deux interfaces :**
- Fenêtre Electron qui s'ouvre → vue utilisateur (scan QR + login)
- Taper `/admin` dans l'URL de la fenêtre ou ouvrir `http://localhost:5173/admin` → dashboard admin

---

### Partie 1 — Les vues Vue.js et leur lien avec le serveur

#### 1.1 Vue Router — comment on navigue

> "La navigation est entièrement gérée par Vue Router. Il y a 7 routes principales."

```
/                    → ScanView.vue          (point d'entrée : scan QR + session auto)
/cart/:cartId        → CartUnlockView.vue    (pairing physique du chariot)
/tracking            → TrackingView.vue      (suivi temps réel utilisateur + mode auto-tracking)
/session             → UserSessionView.vue   (données capteurs, vue alternative utilisateur)
/admin               → AdminLoginView.vue    (login admin, accessible uniquement par URL)
/admin/select-cart   → AdminCartSelectView.vue (choix du chariot à surveiller)
/admin/dashboard/:cartId → AdminView.vue    (dashboard flotte complet)
/admin/dashboard     → redirect dynamique vers le dernier chariot sélectionné (ou /admin/select-cart)
```

La navigation est **programmée** depuis le code Vue : après pairing confirmé, `router.push('/tracking')` ; après login admin, `router.push('/admin/select-cart')`.

---

#### 1.2 ScanView — point d'entrée (nouveau)

> "La page d'accueil `/` crée automatiquement une session anonyme puis ouvre la caméra pour scanner le QR code."

**Fichier :** `app/src/views/ScanView.vue`

**Session automatique (sans login manuel) :**

```
POST http://<host>:3000/session
→ Réponse: { token }
```

Le token est stocké via `api/scanAuth.js` (localStorage) et réutilisé à chaque retour sur la vue. La connexion WebSocket est établie immédiatement avec ce token.

**Scan QR :**
- Utilise l'API native `BarcodeDetector` du navigateur (Chrome uniquement ; sinon saisie manuelle)
- Caméra arrière (`facingMode: 'environment'`) — fonctionne sur mobile
- Normalise les QR codes qui contiennent une URL complète (extrait le dernier segment de chemin)
- Anti-doublon : même code ignoré dans la fenêtre de 1,5 s
- Après détection → `router.push('/cart/:cartId')`

---

#### 1.3 CartUnlockView — pairing physique

> "Après le scan, l'utilisateur attend la confirmation physique du chariot. Il n'y a plus de login manuel ici."

**Fichier :** `app/src/views/CartUnlockView.vue`

**Pairing (`request_pairing`) — inchangé**

L'utilisateur arrive ici depuis `ScanView` avec l'ID dans l'URL. Le frontend émet :

```js
socket.emit('request_pairing', { cartId }, callback)
```

Le serveur :
1. Vérifie que le chariot existe et est disponible (mémoire `rooms._cartStatus`)
2. Stocke la demande en attente dans `_pairingPending` (timeout 60 s)
3. Attend la confirmation physique du chariot (bouton sur le robot)
4. Émet `pairing_confirmed` + `start_tracking` au chariot

→ Si confirmé : `router.push('/tracking')`

---

#### 1.4 TrackingView — suivi temps réel utilisateur (nouveau)

> "Une fois pairé, l'utilisateur voit les données capteurs et peut enregistrer la personne à suivre pour activer le mode auto-tracking."

**Fichier :** `app/src/views/TrackingView.vue`

**Bouton "Enregistrer la personne à suivre" :**
1. Lance un `POST http://100.81.175.3:8002/command/register` avec `{ duration: 10 }` vers le serveur Python
2. Countdown visuel de 10 s
3. Écoute `command_status` via Socket.IO :
   - `register_ok` → émet `start_auto_tracking` au serveur Node + affiche "👁 Personne suivie"
   - `register_failed` → réinitialise le bouton
4. Timeout de sécurité à 20 s (si aucune réponse reçue)

**Statuts affichés :**
- `paired` : prêt, bouton actif
- `auto_tracking` : chariot en suivi autonome, bouton désactivé avec label "👁 Personne suivie"

**Arrêt du suivi :** bouton "Arrêter" → `stopCart()` → `store.clearActiveCart()` → `router.push('/')`

---

#### 1.5 UserSessionView — vue alternative utilisateur

> "Vue de session alternative (route `/session`), toujours présente mais le flux principal passe maintenant par TrackingView."

> "Une fois pairé, l'utilisateur voit en temps réel le poids, la batterie, la vitesse, et les alertes obstacles."

**Fichier :** `app/src/views/UserSessionView.vue` (route `/session`)

**Côté serveur (`events/cart.js`) :**

Quand le Raspberry envoie `sensor_data`, le serveur :
- Diffuse les données complètes aux admins : `io.to('admins').emit('sensor_update', ...)`
- Diffuse les données réduites à l'utilisateur : `io.to('user_of:C-001').emit('cart_status', { weightKg, batteryPct, speedMs })`

Le store Pinia (`store/cart.js`) centralise les données et les expose à la vue sans re-connexion.

---

#### 1.6 AdminView — tableau de bord flotte

> "L'admin voit tous les chariots en temps réel et peut les piloter à distance."

**Fichier :** `app/src/views/AdminView.vue` (accessible via `/admin/dashboard/:cartId`)

**À la connexion,** l'admin reçoit l'état complet de la flotte :
```js
socket.emit('admin:get_fleet', {}, callback)
→ callback reçoit { carts: [...] }
```

**En temps réel,** le serveur pousse les updates à la room `admins` :
- `sensor_update` : nouvelles données capteurs
- `cart_online` / `cart_offline` : présence du chariot
- `cart_status_update` : changement d'état (paired, available…)

**Commandes admin (sens inverse) :**
```
AdminView.vue
  → socket.emit('admin:move', { cartId, direction })
  → serveur : io.to('cart:C-001').emit('cmd', { action: 'move', direction })
  → Raspberry Pi : exécute le mouvement
```

Pareil pour `admin:force_stop`, `admin:recall`, kick utilisateur.

---

### Partie 2 — Implémentations spécifiques

#### 2.1 Authentification JWT

> "Toute la sécurité repose sur un token JWT. L'utilisateur s'authentifie une seule fois via HTTP, et ce token est réutilisé pour WebSocket."

**Flux complet :**
```
1. POST /login  →  serveur vérifie bcrypt(password, hash_en_base)
2. Serveur génère : jwt.sign({ role, userId }, SECRET, { expiresIn: '24h' })
3. Frontend stocke le token et l'envoie à chaque connexion WS :
   socket.auth = { token }
4. Middleware auth.js (io.use) : jwt.verify(token) → injecte dans socket.data
5. index.js lit socket.data.role → appelle le bon registerXxxEvents()
```

Trois rôles : `user`, `admin`, `cart`. Les chariots ont leur propre route `/cart-token` (JWT 30 jours via secret partagé).

---

#### 2.2 Rooms Socket.IO — isolation des données

> "Le serveur utilise les 'rooms' de Socket.IO pour que chaque message n'arrive qu'aux bonnes personnes."

| Room | Membres | Messages reçus |
|---|---|---|
| `cart:C-001` | Le Raspberry C-001 | Commandes `cmd` (batch JSON) |
| `user_of:C-001` | L'utilisateur pairé au C-001 | `cart_status`, `alert` |
| `admins` | Tous les admins connectés | `sensor_update`, `cart_online/offline`, `cart_position` |
| `carts` | Tous les Raspberry | Broadcast global (non utilisé actuellement) |

Un utilisateur rejoint `user_of:C-001` au moment du `pairing_confirmed`. Il en sort à la libération du chariot ou à la déconnexion (forcée, attentue ou NON).

---

#### 2.3 PostgreSQL + Redis — deux rôles bien distincts

> "On utilise deux bases de données avec des rôles très différents."

- **PostgreSQL** (persistant) : stocke les utilisateurs (`id, username, password_hash, role`) et le registre des chariots (`cart_id`). Données stables.
- **Redis** (temporaire) : stocke l'état **temps réel** de chaque chariot — `{ ownerId, status }`. Très rapide, en mémoire, remis à zéro au redémarrage.

```
Pairing C-001 :  Redis : SET cart:C-001 → { ownerId: "evan", status: "in_use" }
Libération :     Redis : SET cart:C-001 → { ownerId: null,   status: "available" }
```

---

#### 2.4 Simulateur de chariot (`simulate-cart.js`) ou (raspberry/cart_client.js`)

> "Un simulateur Node.js joue le rôle du chariot physique pendant les démos."

Le simulateur se connecte au serveur avec un JWT `cart`, puis :
- Envoie `sensor_data` toutes les secondes (poids, batterie, vitesse, accéléromètre)
- Envoie des `position_update` avec des coordonnées aléatoires
- Répond aux commandes `cmd` reçues (affichage console)
- Peut confirmer un pairing via `GET /simulate/cart-confirm/:cartId`

---

#### 2.5 Architecture client WebSocket (`api/socket.js`)

> "Côté frontend, tout le WebSocket est centralisé dans un seul fichier singleton."

`socket.js` crée **une seule instance** Socket.IO (`autoConnect: false`) :

- `connectSocket(token)` — se connecte après le login
- `requestPairing(cartId)` — émet `request_pairing`, retourne une Promise
- `releaseCart()` — libère le chariot
- `onCartStatus(cb)` / `onAlert(cb)` — abonnements (retournent un unsubscribe)
- Fonctions admin : `adminMove`, `adminForceStop`, `adminRecall`, `getFleet`, `kickUser`

Les vues Vue n'interagissent **jamais directement** avec Socket.IO.

---

#### 2.6 Proxy Python (`python-proxy.js`) — nouveau

> "Le serveur Node.js se connecte au serveur Python de vision (Tailscale) et relaie ses messages aux clients via Socket.IO."

**Fichier :** `server/python-proxy.js`

Notre serveur est **client** WebSocket vers `ws://100.81.175.3:8002/command`, le serveur de la caméra...
- À la connexion, envoie `{ cmd: 'reset' }` pour réinitialiser le tracking
- Tous les messages reçus du Python sont broadcastés à **tous** les clients Socket.IO : `io.emit('command_status', msg)`
- Reconnexion automatique toutes les 3 s en cas de déconnexion
- Expose `sendCommand(cmd)` pour envoyer des commandes au Python depuis d'autres modules

**Messages relayés (`command_status`) :**
```json
{ "status": "register_ok" }
{ "status": "register_failed", "reason": "..." }
```

---

#### 2.7 SERVER_URL dynamique pour mobile (`config.js`) — nouveau

> "L'URL du serveur s'adapte automatiquement selon le contexte : téléphone, navigateur web ou Electron."

**Fichier :** `app/src/api/config.js`

```js
// En navigateur web/mobile : http://<même hostname>:3000
// En Electron (file://)    : http://localhost:3000
export const SERVER_URL = getServerUrl()
```

Cela permet d'accéder à l'app depuis un téléphone sur le même réseau Wi-Fi sans changer de config.

---

#### 2.8 Application Desktop Electron

> "L'app Vue tourne comme une vraie application desktop grâce à Electron, sans changer une ligne de code Vue."

`vite-plugin-electron` est intégré dans `app/vite.config.js` : `npm run dev` lance Vite et ouvre automatiquement la fenêtre Electron avec hot-reload. `electron/main.js` charge `VITE_DEV_SERVER_URL` en dev et `dist/index.html` en prod. `npm run app:build` génère un installeur natif dans `release/`.

---

## Vue d'ensemble

Système de gestion de flotte de chariots à bagages connectés pour aéroport.

**Stack :**
- Backend : Node.js + Express + Socket.IO + PostgreSQL + Redis
- Frontend : Vue 3 + Vite + Pinia + Vue Router
- Desktop : Electron (via `vite-plugin-electron`)
- Infra dev : Docker Compose (Postgres, Redis, pgAdmin)
- Hardware : Raspberry Pi 3B

---

## Architecture générale

```
plume/
├── server/
│   ├── index.js           — serveur Express + Socket.IO
│   ├── db.js              — accès PostgreSQL + Redis
│   ├── auth.js            — middleware JWT
│   ├── rooms.js           — RoomManager + batch flush commandes
│   ├── tracking-ws.js     — client WS vers serveur caméra Python
│   ├── python-proxy.js    — proxy WS vers serveur Python vision (commandes register)
│   ├── schema.sql         — schéma BDD (auto-exécuté par Docker)
│   ├── seed-users.js      — insertion utilisateurs de test
│   ├── simulate-cart.js   — simulateur de chariot IoT
│   └── events/
│       ├── cart.js        — handlers WebSocket côté chariot
│       ├── user.js        — handlers WebSocket côté utilisateur
│       └── admin.js       — handlers WebSocket côté admin
├── app/
│   ├── electron/
│   │   └── main.js        — processus principal Electron
│   ├── vite.config.js     — Vite + plugin Electron + Vue
│   └── src/
│       ├── api/
│       │   ├── socket.js       — client WebSocket singleton
│       │   ├── config.js       — SERVER_URL dynamique (web/mobile/Electron)
│       │   ├── scanAuth.js     — persistance session de scan (localStorage)
│       │   ├── adminAuth.js    — persistance session admin (localStorage)
│       │   └── adminCartSelection.js — persistance dernier chariot admin
│       ├── store/cart.js       — état global Pinia
│       ├── router/index.js     — routes Vue
│       └── views/
│           ├── ScanView.vue            — page d'accueil : scan QR + session auto
│           ├── TrackingView.vue        — suivi temps réel + enregistrement personne
│           ├── CartUnlockView.vue      — pairing physique du chariot
│           ├── UserSessionView.vue     — vue alternative suivi utilisateur
│           ├── AdminLoginView.vue      — login admin
│           ├── AdminCartSelectView.vue — sélection chariot admin
│           └── AdminView.vue           — dashboard flotte
└── raspberry/
    ├── config.js          — SERVER_URL, CART_ID, CART_SECRET
    ├── cart_client.js     — script principal du chariot
    └── sensors/
        ├── imu.js         — accéléromètre/gyroscope (stub I2C)
        ├── weight.js      — cellule de charge HX711 (stub)
        ├── battery.js     — INA219 (stub, décharge simulée)
        └── distance.js    — HC-SR04 ultrason (stub)
```

---

## PROJET
### Fonctionnalités implémentées

**Côté utilisateur**
- Session automatique anonyme (POST `/session`) → JWT sans login manuel
- Scan QR code natif (`BarcodeDetector`) → `ScanView.vue` (point d'entrée `/`)
- Compatibilité mobile : `SERVER_URL` dynamique via `api/config.js`
- Pairing physique (`request_pairing` + confirmation bouton robot, timeout 60 s) → `CartUnlockView.vue`
- Suivi temps réel (poids, batterie, vitesse, alertes obstacles) → `TrackingView.vue`
- Enregistrement personne à suivre (POST vers Python + countdown 10 s + `command_status`)
- Mode auto-tracking : activation via `start_auto_tracking`, statut persistant après refresh
- Libération du chariot

**Côté admin**
- Login discret (URL directe `/admin`)
- Sélection du chariot à surveiller
- Dashboard flotte : capteurs temps réel, statut, indicateurs online/offline
- Flux vidéo brut / annoté (IP Tailscale `100.81.175.3:5500`)
- Contrôles : pad directionnel, arrêt forcé, rappel à la base, kick utilisateur

**Backend**
- JWT + contrôle d'accès par rôle (`user`, `admin`, `cart`)
- Route `/cart-token` : JWT 30 jours pour chariots
- Route `POST /session` : JWT anonyme pour session de scan
- PostgreSQL : utilisateurs (bcrypt) + registre chariots
- Redis : état temps réel (`ownerId`, `status`)
- RoomManager complet (`rooms.js`) avec batch flush de commandes toutes les 250 ms (`CART_FLUSH_MS`)
- Proxy Python (`python-proxy.js`) : relaie `command_status` (register_ok/failed) via Socket.IO broadcast
- Simulateur de chariot pour démos sans hardware

**Raspberry Pi**
- JWT récupéré dynamiquement au démarrage via `/cart-token`
- `sensor_data` toutes les secondes (poids, batterie, vitesse, IMU)
- `obstacle_alert` avec sévérité (`warning` / `critical`)
- Retour à la base automatique si batterie ≤ 5 %
- Commandes : `start_tracking`, `stop`, `move`, `return_to_base`

**Application desktop**
- Electron intégré via `vite-plugin-electron` — même code Vue, fenêtre native

### Schéma BDD

```sql
users  (id, username, password_hash, role)
carts  (cart_id)   -- C-001, C-002, C-042
```

### État Redis par chariot

```json
{ "ownerId": "userId | null", "status": "available | in_use" }
```

---

## Flux de données complet (Raspberry → Serveur → Clients)

```
[Raspberry Pi]
     │  WebSocket · JWT { role: 'cart', cartId: 'C-001' }
     ▼
[Serveur Node.js :3000]
     │
     ├──► Redis: met à jour l'état du chariot
     │
     ├──► Room 'admins'  ──────► [AdminView.vue]
     │         sensor_update         (dashboard flotte)
     │         cart_online/offline
     │         obstacle_alert
     │
     └──► Room 'user_of:C-001' ► [UserSessionView.vue]
               cart_status          (poids, batterie, vitesse)
               alert
```

**Commandes admin (sens inverse) :**
```
[AdminView.vue]
     │  admin:move { cartId, direction }
     ▼
[Serveur]
     │  cmd { action: 'move', direction }  (dans le batch JSON)
     ▼
[Raspberry Pi] → contrôle moteurs
```

---

## Événements WebSocket — référence complète

| Événement | Direction | Rôle émetteur | Payload |
|---|---|---|---|
| `sensor_data` | Chariot → Serveur | `cart` | `{ weightKg, batteryPct, speedMs, accelX/Y/Z, gyroX/Y/Z }` |
| `obstacle_alert` | Chariot → Serveur | `cart` | `{ severity: 'warning'\|'critical', distanceCm }` |
| `position_update` | Chariot → Serveur | `cart` | `{ x, y }` |
| `cmd` | Serveur → Chariot | — | `{ cartId, status, alerts: [], cmds: [{ id, action, args }] }` |
| `request_pairing` | Frontend → Serveur | `user` | `{ cartId }` |
| `pairing_confirmed` | Serveur → Frontend | — | `{ cartId }` |
| `release_cart` | Frontend → Serveur | `user` | `{}` |
| `cart_status` | Serveur → Frontend | — | `{ cartId, weightKg, batteryPct, speedMs }` |
| `alert` | Serveur → Frontend | — | `{ type: 'obstacle'\|'forced_stop', severity? }` |
| `admin:move` | Admin → Serveur | `admin` | `{ cartId, direction }` |
| `admin:force_stop` | Admin → Serveur | `admin` | `{ cartId }` |
| `admin:recall` | Admin → Serveur | `admin` | `{ cartId }` |
| `admin:get_fleet` | Admin → Serveur | `admin` | `{}` |
| `sensor_update` | Serveur → Admin | — | `{ cartId, ...données complètes }` |
| `cart_online` | Serveur → Admin | — | `{ cartId, timestamp }` |
| `cart_offline` | Serveur → Admin | — | `{ cartId }` |
| `command_status` | Serveur → Tous clients | — | `{ status: 'register_ok' \| 'register_failed', reason? }` |
| `start_auto_tracking` | Frontend → Serveur | `user` | `{}` |
| `stop_auto_tracking` | Frontend → Serveur | `user` | `{}` |
| `auto_tracking_started` | Serveur → Frontend | — | `{ cartId }` |
| `auto_tracking_stopped` | Serveur → Frontend | — | `{ cartId }` |
| `cart_status_update` | Serveur → Frontend | — | `{ status }` |

---

| Room | Nom réel | Membres | Utilisée pour |
|---|---|---|---|
| `cartRoom(id)` | `cart:C-001` | Le Raspberry | Commandes `cmd` (batch) |
| `userRoom(id)` | `user_of:C-001` | L'utilisateur pairé | `cart_status`, `alert` |
| `allAdminsRoom` | `admins` | Tous les admins | `sensor_update`, `cart_online/offline`, `alert` |
| `allCartsRoom` | `carts` | Tous les Raspberry | Broadcast global (non utilisé) |


---

## Déploiement sur Raspberry Pi

```bash
# Sur le Raspberry Pi (une seule fois)
git clone https://github.com/RaphPicard/Plume.git
cd raspberry
npm install
```

Éditer `config.js` : renseigner `SERVER_URL` (IP du serveur sur le réseau Wifi local) et `CART_ID` (ex. `C-042`).

```bash
npm start
```

---

## État d'avancement

### ✅ Authentification & Sécurité

- **JWT utilisateurs** — login via `POST /login`, token stocké en localStorage côté client.
- **JWT chariots** — route `POST /cart-token` : JWT 30 jours via secret partagé. Plus de hard-coding.
- **Guard router admin** — `router.beforeEach` vérifie le JWT avant chaque accès `/admin/*`.
- **Persistance session admin** — `api/adminAuth.js` via localStorage, vérification expiration JWT côté client.
- **Middleware WebSocket** — `auth.js` : valide le JWT, injecte `socket.data.role` avant tout handler.

### ✅ Interface Utilisateur (agent au sol)

- **Scan QR Code** — `CartUnlockView.vue` : QR code collé sur le chariot → URL `/cart/:cartId`. Affiche statut du chariot (online/offline, batterie) ; bouton Déverrouiller actif uniquement si disponible.
- **Vue session** — `UserSessionView.vue` (`/session`) : données capteurs temps réel, alertes obstacles, bouton libération.

### ✅ Interface Admin

- **Login discret** — `AdminLoginView.vue`, accessible uniquement par URL directe.
- **Sélection de chariot** — `AdminCartSelectView.vue` (`/admin/select-cart`) : flotte en temps réel.
- **Dashboard flotte** — `AdminView.vue` (`/admin/dashboard/:cartId`) : capteurs, contrôles directionnels, arrêt forcé, rappel base, kick utilisateur, flux vidéo Tailscale.

### ✅ Flux de Pairing

- Client émet `request_pairing` ; serveur vérifie disponibilité en mémoire.
- Timeout 60 s côté serveur, annulation possible.
- Confirmation physique via bouton robot (ou `/simulate/cart-confirm/:cartId` en dev).
- ⚠️ Pairing en attente stocké dans une `Map` Node.js (`_pairingPending`) — pas dans Redis.

### ✅ Communication Temps Réel (Socket.IO)

- **RoomManager** (`server/rooms.js`) : nommage centralisé, helpers `toCart` / `toUser` / `toAdmins`.
- **Batch de commandes** toutes les 1000 ms (configurable `CART_FLUSH_MS`) :

```json
{
  "cartId": "C-001",
  "status": "available | paired",
  "alerts": ["obstacle_detected"],
  "cmds": [{ "id": "cmd-<uuid>", "action": "move", "args": ["forward"] }]
}
```

### ✅ Raspberry Pi

- JWT récupéré dynamiquement au démarrage.
- `sensor_data` toutes les secondes, `obstacle_alert`, retour base si batterie ≤ 5 %.
- Reconnexion automatique (backoff exponentiel, max 30 s).

### ✅ Application Desktop Electron

- `vite-plugin-electron` dans `app/vite.config.js` : un seul `npm run dev` lance Vite + Electron.
- `electron/main.js` : fenêtre 1280×800, `contextIsolation: true`, `nodeIntegration: false`.
- `npm run app:build` → installeur natif dans `release/` (.exe / .dmg / .AppImage).

---

## Priorités d'implémentation

| Priorité | Statut | Tâche | Fichier(s) |
|---|---|---|---|
| — | ✅ Fait | Script Node.js Raspberry Pi | `raspberry/cart_client.js` |
| — | ✅ Fait | Authentification JWT chariots (`/cart-token`) | `server/index.js` |
| — | ✅ Fait | RoomManager + batch flush commandes | `server/rooms.js`, `events/*.js` |
| — | ✅ Fait | Scan QR code | `app/src/views/CartUnlockView.vue` |
| — | ✅ Fait | Application Desktop Electron | `app/electron/main.js`, `app/vite.config.js` |
| 🔴 | ❌ À faire | Migrer pairing en attente vers Redis | `server/events/user.js`, `server/db.js` |
| 🔴 | ❌ À faire | Gestion déconnexion + TTL Redis | `server/events/cart.js`, `server/db.js` |
| 🟠 | ❌ À faire | Tracking ACK/exec/skip commandes | `server/rooms.js` |
| 🟠 | ❌ À faire | Reconnexion WS frontend (re-pairing) | `app/src/api/socket.js`, `app/src/store/cart.js` |
| 🟡 | ❌ À faire | IDs chariots entiers (C-042 → 42) | `server/schema.sql`, `raspberry/config.js` |
| 🟢 | ❌ À faire | Restreindre CORS en production | `server/index.js` |
| — | 🚫 Abandonné | Carte de position dans AdminView | — |


# ✅ FAIT — Gestion du suivi autonome
## Gestion du suivi autonome

**Fichiers concernés :** `server/tracking-ws.js`, `server/rooms.js`, `server/events/user.js`, `raspberry/cart_client.js`

---

### Flux complet

```
[Serveur caméra Python — port 8002]
     │  WebSocket brut (ws, pas Socket.IO)
     │  ws://<CAMERA_WS_URL>/data  (défini dans .env)
     ▼
[server/index.js]
     │  initTrackingWs(rooms)  ← appelé au démarrage
     ▼
[server/tracking-ws.js]  ← client WS, se connecte à la caméra
     │  reçoit frames JSON à ~30 fps
     │  vérifie : chariot en ligne ? statut === 'auto_tracking' ?
     │  calcule speed + direction via computeCmd()
     │  rooms.enqueueCmd(CART_ID, 'move', [...])
     ▼
[server/rooms.js — flush toutes les 250 ms]
     │  event 'cmd' (batch Socket.IO)
     ▼
[raspberry/cart_client.js]
     │  écoute l'event 'cmd'
     │  case 'move' : if (tracking) move(direction, speed, diff)
     ▼
[Moteurs GPIO]
```

---

### Activation du mode auto-tracking

1. L'utilisateur émet `start_auto_tracking` depuis l'app
2. `server/events/user.js` passe le statut du chariot à `'auto_tracking'` (via `rooms.setCartStatus`) et envoie la commande `start_tracking` au chariot
3. `cart_client.js` reçoit `start_tracking` → met `tracking = true`
4. À partir de là, `tracking-ws.js` est autorisé à injecter des commandes `move`

Le mode s'arrête via `stop_auto_tracking` (utilisateur), `admin:force_stop` (admin), libération du chariot, ou batterie ≤ 5 % (RPi lui-même).

---

### Connexion au serveur caméra (`tracking-ws.js`)

Notre serveur est **client** WebSocket : il se connecte à `ws://<CAMERA_WS_URL>/data` (port 8002, piloté par le Raspberry caméra).  
Variable d'environnement : `CAMERA_WS_URL` dans `.env` (ex : `ws://192.168.1.42:8002`).  
Reconnexion automatique toutes les 3 s en cas de déconnexion.

---

### Format des données reçues (caméra → serveur)

```json
{
  "mode": "idle" | "registering" | "tracking",
  "persons": [
    { "is_target": true, "distance": 2.1, "angle": -8, "conf": 0.91, "similarity": 0.78 }
  ]
}
```

---

### Logique de calcul (`computeCmd`) dans `tracking-ws.js`

Paramètres :

| Constante | Valeur | Rôle |
|---|---|---|
| `TARGET_DIST` | 1.5 m | Distance idéale — vitesse 0 |
| `MIN_DIST` | 0.8 m | Arrêt de sécurité |
| `MAX_DIST` | 3.5 m | Vitesse maximale |
| `MIN_CONF` | 0.85 | Seuil de confiance minimal |
| `ANGLE_DEAD_ZONE` | 2° | Zone morte rotation |
| `MAX_ANGLE` | 30° | Angle = rotation à fond |
| `MAX_SPEED` | 50 | Valeur max envoyée au RPi |

| Condition | Comportement |
|---|---|
| Statut chariot ≠ `auto_tracking` | Ignoré (guard côté serveur) |
| `mode !== "tracking"` | Arrêt |
| Aucune personne `is_target: true` | Arrêt |
| `conf < 0.85` | Détection ignorée |
| `distance < 0.8 m` | Arrêt de sécurité |
| `0.8 m ≤ distance ≤ 1.5 m` | `speed = 0` (distance idéale) |
| `1.5 m < distance < 3.5 m` | `speed` proportionnel, scalé sur 0–50 |
| `distance ≥ 3.5 m` | `speed = 50` (maximum) |
| `\|angle\| ≤ 2°` | Pas de rotation (zone morte) |
| `\|angle\| > 2°` | Rotation proportionnelle (`-angle / 30`, clampé à [-1, 1]) |

> `angle` positif = cible à droite → direction `'right'`. `angle` négatif = cible à gauche → `'left'`.

---

### Commandes injectées dans le batch `cmd`

```json
{ "id": "cmd-<uuid>", "action": "move", "args": ["forward", 32] }
{ "id": "cmd-<uuid>", "action": "move", "args": ["left", 20, 15] }
{ "id": "cmd-<uuid>", "action": "move", "args": ["stop"] }
```

`args` : `[direction, speed?, diff?]`
- `direction` : `'forward'` | `'left'` | `'right'` | `'stop'`
- `speed` : 0–50
- `diff` : différentiel moteur pour la rotation (0–50)

Flush toutes les 250 ms (`CART_FLUSH_MS=250` dans `.env`).

---

### Côté chariot (`cart_client.js`)

```js
case 'move': {
  const [direction, speed, diff] = command.args
  if (direction === 'stop') { stopMotors(); break }
  if (tracking) move(direction, speed, diff)
  break
}
```

```js
function move(direction, speed = 0, diff = 0) {
  // 'forward'  : les deux moteurs à speed
  // 'left'     : moteur droit à speed, moteur gauche à (speed - diff)
  // 'right'    : moteur gauche à speed, moteur droit à (speed - diff)
}
```

Les commandes manuelles admin (`'forward'`, `'backward'`, etc. sans speed) restent compatibles grâce aux valeurs par défaut.

---

### Monitoring admins

- `tracking_status` → `{ cartId, online: bool }` — connexion/déconnexion au serveur caméra
- `tracking_update` → `{ cartId, mode, persons }` — données brutes à chaque frame reçue