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

> "La navigation est entièrement gérée par Vue Router. Il y a 5 routes principales."

```
/cart/:cartId        → CartUnlockView.vue    (scan QR ou saisie manuelle, pairing)
/session             → UserSessionView.vue   (données capteurs temps réel, utilisateur)
/admin               → AdminLoginView.vue    (login admin, accessible uniquement par URL)
/admin/select-cart   → AdminCartSelectView.vue (choix du chariot à surveiller)
/admin/dashboard/:cartId → AdminView.vue    (dashboard flotte complet)
```

La navigation est **programmée** depuis le code Vue : après pairing confirmé, `router.push('/session')` ; après login admin, `router.push('/admin/select-cart')`.

---

#### 1.2 CartUnlockView — scan QR et pairing physique

> "L'utilisateur scanne le QR code collé sur le chariot. Le pairing se fait en deux temps : le serveur attend la confirmation physique du chariot."

**Fichier :** `app/src/views/CartUnlockView.vue`

**Étape 1 — Login HTTP**

```
POST http://localhost:3000/login
Body: { username, password }
→ Réponse: { token, role }
```

Le token JWT est stocké et réutilisé pour la connexion WebSocket.

**Étape 2 — Pairing (`request_pairing`)**

L'utilisateur scanne le QR code (ou saisit l'ID). Le frontend émet :

```js
socket.emit('request_pairing', { cartId }, callback)
```

Le serveur :
1. Vérifie que le chariot existe et est disponible (mémoire `rooms._cartStatus`)
2. Stocke la demande en attente dans `_pairingPending` (timeout 60 s)
3. Attend la confirmation physique du chariot (bouton sur le robot)
4. Émet `pairing_confirmed` + `start_tracking` au chariot

→ Si confirmé : `router.push('/session')`

---

#### 1.3 UserSessionView — données temps réel utilisateur

> "Une fois pairé, l'utilisateur voit en temps réel le poids, la batterie, la vitesse, et les alertes obstacles."

**Fichier :** `app/src/views/UserSessionView.vue`

**Côté serveur (`events/cart.js`) :**

Quand le Raspberry envoie `sensor_data`, le serveur :
- Diffuse les données complètes aux admins : `io.to('admins').emit('sensor_update', ...)`
- Diffuse les données réduites à l'utilisateur : `io.to('user_of:C-001').emit('cart_status', { weightKg, batteryPct, speedMs })`

Le store Pinia (`store/cart.js`) centralise les données et les expose à la vue sans re-connexion.

---

#### 1.4 AdminView — tableau de bord flotte

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

Un utilisateur rejoint `user_of:C-001` au moment du `pairing_confirmed`. Il en sort à la libération du chariot ou à la déconnexion.

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

#### 2.4 Simulateur de chariot (`simulate-cart.js`)

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

#### 2.6 Application Desktop Electron

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
│       ├── api/socket.js       — client WebSocket singleton
│       ├── store/cart.js       — état global Pinia
│       ├── router/index.js     — routes Vue
│       └── views/
│           ├── CartUnlockView.vue      — scan QR + pairing
│           ├── UserSessionView.vue     — suivi temps réel (utilisateur)
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
- Login HTTP (POST `/login`) → JWT
- Connexion WebSocket authentifiée
- Scan QR code du chariot → `CartUnlockView.vue`
- Pairing physique (`request_pairing` + confirmation bouton robot, timeout 60 s)
- Données capteurs temps réel : poids, batterie, vitesse
- Alertes obstacles
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
- PostgreSQL : utilisateurs (bcrypt) + registre chariots
- Redis : état temps réel (`ownerId`, `status`)
- RoomManager complet (`rooms.js`) avec batch flush de commandes toutes les 1000 ms
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

## Ce qu'il me manque comme information


### Encore ouvert

- **Que se passe-t-il si un chariot se déconnecte en cours d'usage ?**
  L'état Redis reste `in_use` indéfiniment. Règle métier à définir : libération automatique après TTL, ou notification admin ?

- **Que se passe-t-il si un utilisateur ne rend pas le chariot ?**
  Pas de règle métier implémentée. Options : timeout session côté serveur, rappel à la base forcé par admin.

---

## Ce qui manque pour que le projet soit fonctionnel

**Gestion de la déconnexion du chariot (priorité haute)**

Si le Raspberry perd le réseau en cours d'usage :
- Le serveur émet `cart_offline` aux admins ✅
- Mais l'état Redis reste `in_use` → chariot bloqué indéfiniment
- Solution : TTL Redis 30 s rafraîchi par chaque `sensor_data` + libération automatique à expiration

**Reconnexion WebSocket frontend**

Le Raspberry gère déjà la reconnexion avec backoff exponentiel. Il reste à gérer côté Vue : après coupure réseau, le store Pinia doit relancer `request_pairing` pour rebinder l'utilisateur à son chariot.

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

Éditer `config.js` : renseigner `SERVER_URL` (IP du serveur sur le réseau Wifi local) et `CART_ID` (ex. `C-001`).

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

**Implémenté dans `server/tracking-ws.js` (monté dans `server/index.js`).**

Le serveur caméra (Python/RPi) se connecte à notre backend via WebSocket brut (`ws`, pas Socket.IO) :
```
ws://<backend>:3000/data?cartId=C-001&secret=<CAMERA_SECRET>
```
Le secret est défini dans `.env` sous `CAMERA_SECRET`.

Format des données reçues :
```json
{
  "mode": "idle" | "registering" | "tracking",
  "persons": [
    {
      "is_target": false,
      "distance": 3.2,
      "angle": -12,
      "conf": 0.87,
      "similarity": 0.74
    }
  ]
}
```

### Logique de suivi
Les commandes sont émises **directement** (hors file de flush) vers le chariot via l'event Socket.IO `tracking_cmd` :
```json
{ "speed": 0.0–1.0, "angular": -1.0–1.0, "mode": "tracking" }
```

| Condition | Comportement |
|---|---|
| `mode !== "tracking"` | Arrêt (`speed=0, angular=0`) |
| Aucune personne avec `is_target: true` | Arrêt |
| `conf < 0.5` | Détection ignorée |
| `distance < 0.8 m` | Arrêt de sécurité |
| `0.8 m < distance < 1.5 m` | Vitesse 0 (distance idéale atteinte) |
| `1.5 m < distance < 3.5 m` | Vitesse proportionnelle à la distance |
| `distance > 3.5 m` | Vitesse maximale (1.0) |
| `\|angle\| > 8°` | Rotation proportionnelle (`-angle / 45`, clampé à [-1, 1]) |
| `\|angle\| ≤ 8°` | Pas de rotation (zone morte) |

> `angle` négatif = cible à gauche → `angular` positif (tourne à gauche).

### Côté chariot (RPi) — à implémenter
Écouter l'event `tracking_cmd` :
```js
socket.on('tracking_cmd', ({ speed, angular, mode }) => {
  // Piloter les moteurs avec speed et angular
})
```

### Monitoring admins
Deux nouveaux events émis vers tous les admins :
- `tracking_status` → `{ cartId, online: bool }` — connexion/déconnexion du serveur caméra
- `tracking_update` → `{ cartId, mode, persons }` — données brutes à chaque frame