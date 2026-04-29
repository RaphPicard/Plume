# CLAUDE.md — Projet Transversal : Gestion de flotte de chariots connectés

---

## Déroulé de présentation orale

### Intro — Lancer le projet et montrer les interfaces

> "Le projet s'appelle AUTOCART. C'est un système de gestion de flotte de chariots à bagages connectés pour aéroport. Il y a trois acteurs : l'utilisateur (agent au sol), l'administrateur (superviseur), et le chariot lui-même (Raspberry Pi)."

**Lancer dans cet ordre (dans 4 terminaux) :**

```bash
# 1. Infrastructure (Postgres + Redis)
docker compose up -d

# 2. Serveur backend
node plume/server/index.js        # → écoute sur :3000

# 3. Simulateur de chariot (remplace le Raspberry Pi)
node plume/server/simulate-cart.js

# 4. Frontend
cd plume/app && npm run dev       # → http://localhost:5173
```

**Montrer les deux interfaces :**
- Ouvrir **http://localhost:5173** → vue utilisateur (écran de login)
- Ouvrir un second onglet sur **http://localhost:5173/admin** (ou se connecter en tant qu'admin) → dashboard flotte

---

### Partie 1 — Les vues Vue.js et leur lien avec le serveur

#### 1.1 Vue Router — comment on navigue

> "Tout commence dans `router/index.js`. Il n'y a que 3 routes :`

```
/           → ScanView.vue      (login + déverrouillage chariot)
/tracking   → TrackingView.vue  (données capteurs temps réel)
/admin      → AdminView.vue     (dashboard flotte complète)
```

La navigation est **programmée** depuis le code Vue (pas de liens cliquables) : après login, `router.push('/admin')` ou `router.push('/tracking')`. (dans `ScanView.vue`)

---

#### 1.2 ScanView — login, puis déverrouillage chariot

> "C'est la porte d'entrée de l'application. Elle gère deux étapes successives, contrôlées par `v-if` sur `store.isConnected`."

**Fichier :** `plume/app/src/views/ScanView.vue`

**Étape 1 — Login (`handleLogin`)**

L'utilisateur entre son login/password. Le frontend fait un appel HTTP classique :

```
POST http://localhost:3000/login
Body: { username, password }
→ Réponse: { token, role }
```

Avec ce token, le frontend ouvre la connexion WebSocket :
```js
connectSocket(token)   // → socket.auth = { token }, socket.connect()
```
Le serveur valide le JWT dans `auth.js` (middleware `io.use(authMiddleware)`), puis appelle le bon handler selon le rôle.

> Si le rôle est `admin` → `router.push('/admin')` directement.

**Étape 2 — Déverrouillage (`handleUnlock`)**

L'utilisateur saisit l'ID du chariot (ex. `C-001`). Le frontend émet un event WebSocket :

```js
socket.emit('unlock_cart', { cartId }, callback)
```

Le serveur (dans `events/user.js`) :
1. Vérifie que le chariot existe et est libre (Redis)
2. Associe l'utilisateur au chariot en Redis (`setCartOwner`)
3. Fait rejoindre à l'utilisateur la room `user_of:C-001`
4. Envoie `cmd: start_tracking` au chariot

→ Si OK : `router.push('/tracking')`

---

#### 1.3 TrackingView — données temps réel utilisateur

> "Une fois connecté à un chariot, l'utilisateur voit en temps réel le poids, la batterie, la vitesse, et les alertes obstacles."

**Ce qui se passe côté serveur (`events/cart.js`) :**

Quand le simulateur/Raspberry envoie `sensor_data`, le serveur :
- Diffuse les données complètes aux admins : `io.to('admins').emit('sensor_update', ...)`
- Diffuse les données réduites à l'utilisateur du chariot : `io.to('user_of:C-001').emit('cart_status', { weightKg, batteryPct, speedMs })`

Le frontend écoute `cart_status` via `socket.js` :
```js
socket.on('cart_status', callback)  // → store.updateStatus(status)
```

Le store Pinia (`store/cart.js`) centralise les données et les expose aux deux vues `ScanView` et `TrackingView` sans re-connexion.

---

#### 1.4 AdminView — tableau de bord flotte

> "L'admin voit tous les chariots en temps réel et peut les piloter à distance."

**À la connexion,** l'admin reçoit l'état complet de la flotte via un event WebSocket :
```js
socket.emit('admin:get_fleet', {}, callback)
→ callback reçoit { carts: [...] }
```

**En temps réel,** le serveur pousse les updates à la room `admins` :
- `sensor_update` : nouvelles données capteurs
- `cart_online` / `cart_offline` : présence du chariot
- `cart_position` : coordonnées x/y

**Commandes admin (sens inverse) :**
L'admin appuie sur un bouton → le frontend émet un event → le serveur le transmet au chariot :

```
AdminView.vue
  → socket.emit('admin:move', { cartId, direction })
  → serveur : io.to('cart:C-001').emit('cmd', { action: 'move', direction })
  → Raspberry Pi : exécute le mouvement
```

Pareil pour `admin:force_stop` et `admin:recall`.

---

### Partie 2 — Implémentations spécifiques

#### 2.1 Authentification JWT

> "Toute la sécurité repose sur un token JWT. L'utilisateur s'authentifie une seule fois via HTTP, et ce token est réutilisé pour WebSocket."

**Flux complet :**
```
1. POST /login  →  serveur vérifie bcrypt(password, hash_en_base)
2. Serveur génère : jwt.sign({ role, userId }, SECRET, { expiresIn: '24h' })
3. Frontend stocke le token en mémoire et l'envoie à chaque connexion WS :
   socket.auth = { token }
4. Middleware auth.js (io.use) : jwt.verify(token) → injecte dans socket.data
5. index.js lit socket.data.role → appelle le bon registerXxxEvents()
```

Trois rôles possibles dans le token : `user`, `admin`, `cart`.

---

#### 2.2 Rooms Socket.IO — isolation des données

> "Le serveur utilise les 'rooms' de Socket.IO pour que chaque message n'arrive qu'aux bonnes personnes."

| Room | Membres | Messages reçus |
|---|---|---|
| `cart:C-001` | Le chariot C-001 | Commandes `cmd` |
| `user_of:C-001` | L'utilisateur du C-001 | `cart_status`, `alert` |
| `admins` | Tous les admins connectés | `sensor_update`, `cart_online/offline`, `cart_position` |
| `carts` | Tous les chariots | (usage futur, broadcast) |

Un utilisateur rejoint `user_of:C-001` au moment du `unlock_cart`. Il en sort au `stop_cart` ou à la déconnexion.

---

#### 2.3 PostgreSQL + Redis — deux rôles bien distincts

> "On utilise deux bases de données avec des rôles très différents."

- **PostgreSQL** (persistant) : stocke les utilisateurs (`id, username, password_hash, role`) et le registre des chariots (`cart_id`). Données stables.
- **Redis** (temporaire) : stocke l'état **temps réel** de chaque chariot — `{ ownerId, status }`. Très rapide, en mémoire, remis à zéro au redémarrage.

Quand un utilisateur déverrouille `C-001` :
```
Redis : SET cart:C-001 → { ownerId: "evan", status: "in_use" }
```
Quand il libère le chariot :
```
Redis : SET cart:C-001 → { ownerId: null, status: "available" }
```

---

#### 2.4 Simulateur de chariot (`simulate-cart.js`)

> "Comme on n'a pas encore le Raspberry Pi intégré, un simulateur Node.js joue le rôle du chariot physique."

Le simulateur se connecte au serveur avec un JWT de rôle `cart`, puis :
- Envoie `sensor_data` toutes les secondes à events/cart.js avec des valeurs aléatoires (poids, batterie, vitesse, accéléromètre) 
- Récupérable avec cart_status pour les utilisateurs et sensor_update pour les admins
- Envoie des `position_update` avec des coordonnées qui bougent
- Répond aux commandes `cmd` reçues (affichage console)

C'est exactement le comportement qu'aura le vrai Raspberry Pi, avec les vraies valeurs capteurs à la place des valeurs simulées.

---

#### 2.5 Architecture client WebSocket (`api/socket.js`)

> "Côté frontend, tout le WebSocket est centralisé dans un seul fichier singleton."

`socket.js` crée **une seule instance** Socket.IO (`autoConnect: false`) et expose des fonctions claires utilisées par les vues :

- `connectSocket(token)` — se connecte après le login
- `unlockCart(cartId)` — émet `unlock_cart`, retourne une Promise
- `stopCart()` — émet `stop_cart`
- `onCartStatus(cb)` / `onAlert(cb)` — abonnements (retournent un unsubscribe)
- Fonctions admin : `adminMove`, `adminForceStop`, `adminRecall`, `getFleet`

Les vues Vue n'interagissent **jamais directement** avec Socket.IO — elles passent toujours par ce module.

---









-----------------------------------------

## Vue d'ensemble

Système de gestion de flotte de chariots à bagages connectés pour aéroport. Trois acteurs : l'**utilisateur** (agent au sol qui déverrouille et utilise un chariot), l'**administrateur** (superviseur qui surveille et pilote à distance la flotte), et le **chariot** lui-même (Raspberry Pi embarqué qui envoie les données capteurs).

**Stack :**
- Backend : Node.js + Express + Socket.IO + PostgreSQL + Redis
- Frontend : Vue 3 + Vite + Pinia + Vue Router
- Infra dev : Docker Compose (Postgres, Redis, pgAdmin)

---

## Architecture générale

```
plume/
├── server/
│   ├── index.js          — serveur Express + Socket.IO
│   ├── db.js             — accès PostgreSQL + Redis
│   ├── auth.js           — middleware JWT
│   ├── rooms.js          — gestionnaire de rooms (stub)
│   ├── schema.sql        — schéma BDD
│   ├── seed-users.js     — insertion utilisateurs de test
│   ├── simulate-cart.js  — simulateur de chariot IoT
│   └── events/
│       ├── cart.js       — handlers WebSocket côté chariot
│       ├── user.js       — handlers WebSocket côté utilisateur
│       └── admin.js      — handlers WebSocket côté admin
└── app/
    └── src/
        ├── api/socket.js       — client WebSocket frontend
        ├── store/cart.js       — état global Pinia
        ├── router/index.js     — routes Vue
        └── views/
            ├── ScanView.vue    — login + déverrouillage chariot
            ├── TrackingView.vue — suivi temps réel (utilisateur)
            └── AdminView.vue   — tableau de bord admin
raspberry/
├── package.json          — dépendances (socket.io-client)
├── config.js             — SERVER_URL, CART_ID, CART_SECRET (à modifier par chariot)
├── cart_client.js        — script principal du chariot
└── sensors/
    ├── imu.js            — accéléromètre/gyroscope (stub → remplacer par I2C réel)
    ├── weight.js         — cellule de charge HX711 (stub)
    ├── battery.js        — INA219 (stub, décharge simulée progressive)
    └── distance.js       — HC-SR04 ultrason (stub)
```

---

## Ce que je sais sur le projet

### Fonctionnalités implémentées

**Côté utilisateur**
- Connexion HTTP (POST `/login`) avec username/password → JWT
- Connexion WebSocket authentifiée avec le JWT
- Déverrouillage d'un chariot par saisie manuelle de l'ID (`C-001`, `C-002`…)
- Réception en temps réel des données capteurs : poids, batterie, vitesse
- Réception des alertes obstacles
- Arrêt du suivi et libération du chariot

**Côté admin**
- Dashboard flotte complet (tous les chariots)
- Indicateurs online/offline par chariot
- Données capteurs temps réel par chariot
- Position GPS/UWB des chariots
- Contrôle directionnel (avant, arrière, gauche, droite, stop)
- Commandes : rappel à la base, arrêt forcé
- Visualisation de l'utilisateur assigné à chaque chariot

**Backend**
- Authentification JWT + contrôle d'accès par rôle (`user`, `admin`, `cart`)
- Route `POST /cart-token` : les chariots s'authentifient avec un secret partagé (`CART_SECRET`) et reçoivent un JWT 30 jours
- PostgreSQL : registre utilisateurs (bcrypt) + registre chariots
- Redis : état temps réel des chariots (`ownerId`, `status`)
- `RoomManager` (`rooms.js`) : centralise nommage des rooms, suivi mémoire (chariots connectés, utilisateurs assignés), helpers `toCart` / `toUser` / `toAdmins` — intégré dans les 3 handlers d'events
- Rooms Socket.IO : `cart:<id>`, `user_of:<id>`, `carts`, `admins`
- Simulateur de chariot (`simulate-cart.js`) pour tests

**Raspberry Pi (`raspberry/`)**
- `cart_client.js` : récupère son JWT au démarrage via `/cart-token`, se connecte au WebSocket avec reconnexion automatique
- Envoie `sensor_data` (poids, batterie, vitesse, IMU) toutes les secondes
- Détecte les obstacles et émet `obstacle_alert` avec severité (`warning` / `critical`)
- Retour à la base automatique si batterie ≤ 5 %
- Répond aux commandes `cmd` : `start_tracking`, `stop`, `move`, `return_to_base`
- Stubs capteurs commentés avec le code GPIO/I2C réel à brancher

### Schéma BDD PostgreSQL

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

1. **Matériel Raspberry Pi** — quel modèle exact, quels capteurs sont branchés (IMU, capteur de poids, capteur de distance/obstacle, GPS ou UWB ?), sur quels pins/bus (I2C, SPI, UART) ?
==> Kit Raspberry P3B 

2. **Identifiants des chariots** — le `cart_id` est configuré dans `raspberry/config.js` de chaque Raspberry Pi. Le token JWT est obtenu dynamiquement au démarrage via `POST /cart-token` (plus besoin de le hard-coder).

3. **Réseau** — les Raspberry Pi et le serveur sont-ils sur le même réseau local (aéroport) ou via internet ? Y a-t-il un VPN, un proxy inverse (Nginx), du TLS ?
==> Via Wifi local (aucun VPN, proxy, TLS...)

4. **Carte de déploiement** — le serveur tourne-t-il en local ou est-il hébergé (VM, cloud) ? Quelle est l'URL de production ?
==> Server local (localhost:3000), pas de déploiement prévu pour l'instant

5. **QR Code** — le QR code doit-il être physiquement collé sur le chariot et encoder le `cart_id` ? Quel format ?
Oui, collé sur le chariot et encode le cart_id (entier, pas de lettre pour éviter les erreurs de saisie)

6. **Interface cartographique** — la position `{x, y}` est-elle en coordonnées GPS réelles ou un système UWB local ? Une carte doit-elle être affichée dans AdminView ?
==> Pas de carte dans admin_view, pas de coordonée (position).
Récupérer la position du chariot (via JSON) pour les méthodes de retour_base/esquive_obstacle ...

7. **Règles métier manquantes** — que se passe-t-il si un chariot se déconnecte en cours d'usage ?
==> ?
 Si la batterie atteint 0 % ?
==> retour_base et on change son état pour qu'il ne puisse pas se pairer
Si un utilisateur ne rend pas le chariot ?
==> ?
---

## Ce qui manque pour que le projet soit fonctionnel

### 1. Scan QR Code (priorité moyenne)

Dans `ScanView.vue`, le placeholder existe mais n'est pas implémenté. Il faut :
- Intégrer une bibliothèque de scan caméra (ex. `html5-qrcode` ou `@zxing/browser`)
- Le QR code physique encode simplement le `cart_id` (ex. `C-001`)
- Au scan : remplir automatiquement le champ cartId et déclencher `unlock_cart`

```bash
cd plume/app && npm install html5-qrcode
```

### 2. Carte de position dans AdminView

La position `{x, y}` est reçue mais affichée uniquement en texte. Il manque une visualisation (mini-carte SVG ou canvas représentant le plan de l'aéroport avec les chariots positionnés dessus).

### 3. Gestion de la déconnexion du chariot

Si le Raspberry perd le réseau en cours d'usage :
- Le serveur émet `cart_offline` aux admins (déjà implémenté)
- Mais l'état Redis reste `in_use` → le chariot est bloqué indéfiniment
- Il faut un timeout Redis (ex. TTL 30s, refreshé par chaque `sensor_data`) et une logique de libération automatique

### 4. Reconnexion automatique WebSocket (frontend)

Le Raspberry Pi gère déjà la reconnexion automatique avec backoff exponentiel (`reconnectionDelayMax: 30s`). Il reste à gérer côté frontend : le store Pinia doit relancer `unlock_cart` après une reconnexion WebSocket pour rebinder l'utilisateur à son chariot.

---

## Flux de données complet (Raspberry → Serveur → Clients)

```
[Raspberry Pi]
     │
     │  WebSocket (Socket.IO)
     │  JWT { role: 'cart', cartId: 'C-001' }
     │
     ▼
[Serveur Node.js :3000]
     │
     ├──► Redis: met à jour l'état du chariot
     │
     ├──► Room 'admins'  ──────► [AdminView.vue]
     │         sensor_update         (dashboard flotte)
     │         cart_position
     │         obstacle alert
     │
     └──► Room 'user_of:C-001' ► [TrackingView.vue]
               cart_status          (poids, batterie, vitesse)
               alert
```

**Commandes admin (sens inverse) :**
```
[AdminView.vue]
     │  admin:move { cartId, direction }
     ▼
[Serveur]
     │  cmd { action: 'move', direction }
     ▼
[Raspberry Pi] → contrôle moteurs
```

---

## Événements WebSocket — référence complète

| Événement | Direction | Rôle émetteur | Payload |
|---|---|---|---|
| `sensor_data` | Chariot → Serveur | `cart` | `{ weightKg, batteryPct, speedMs, accelX/Y/Z, gyroX/Y/Z }` |
| `obstacle_alert` | Chariot → Serveur | `cart` | `{ severity: 'warning'\|'critical', distanceCm }` 
| `position_update` | Chariot → Serveur | `cart` | `{ x, y }` |
| `cmd` | Serveur → Chariot | — | `{ action: 'start_tracking'\|'stop'\|'move'\|'return_to_base', direction? }` |
| `unlock_cart` | Frontend → Serveur | `user` | `{ cartId }` |
| `stop_cart` | Frontend → Serveur | `user` | `{}` |
| `cart_status` | Serveur → Frontend | — | `{ cartId, weightKg, batteryPct, speedMs }` |
| `alert` | Serveur → Frontend | — | `{ type: 'obstacle'\|'forced_stop', severity? }` |
| `admin:move` | Admin → Serveur | `admin` | `{ cartId, direction }` |
| `admin:force_stop` | Admin → Serveur | `admin` | `{ cartId }` |
| `admin:recall` | Admin → Serveur | `admin` | `{ cartId }` |
| `admin:get_fleet` | Admin → Serveur | `admin` | `{}` |
| `sensor_update` | Serveur → Admin | — | `{ cartId, ...données complètes }` |
| `cart_online` | Serveur → Admin | — | `{ cartId, timestamp }` |
| `cart_offline` | Serveur → Admin | — | `{ cartId }` |
| `cart_position` | Serveur → Admin | — | `{ cartId, x, y }` |

---

## Lancer le projet

```bash
# 1. Bases de données (Postgres + Redis)
docker compose up -d

# 2. Schéma + seed (première fois seulement)
docker compose exec postgres psql -U postgres -d plume -f /schema.sql
node plume/server/seed-users.js

# 3. Serveur backend (port 3000)
node plume/server/index.js

# 4. Frontend (port 5173)
cd plume/app && npm run dev

# 5. Simulateur de chariot (optionnel, remplace le Raspberry)
node plume/server/simulate-cart.js
```

**Comptes de test :**
| Rôle | Login | Mot de passe |
|---|---|---|
| Admin | `raphou` | `raphou` |
| Utilisateur | `evan` | `evan` |

---

## Priorités d'implémentation

| Priorité | Tâche | Fichier(s) concerné(s) |
|---|---|---|
| ✅ Fait | Script Node.js Raspberry Pi | `raspberry/cart_client.js` |
| ✅ Fait | Authentification JWT pour chariots (`/cart-token`) | `plume/server/index.js` |
| ✅ Fait | RoomManager complet et intégré | `plume/server/rooms.js`, `events/*.js` |
| 🟠 Important | Scan QR code | `plume/app/src/views/ScanView.vue` |
| 🟠 Important | Gestion déconnexion + TTL Redis | `plume/server/events/cart.js`, `plume/server/db.js` |
| 🟡 Utile | Reconnexion WebSocket frontend (re-unlock après coupure) | `plume/app/src/api/socket.js`, `plume/store/cart.js` |
| 🟢 Nice-to-have | Carte de position admin | `plume/app/src/views/AdminView.vue` |
| 🟢 Nice-to-have | Restreindre CORS en production | `plume/server/index.js` |
