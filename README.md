Par : Picard Raphaël 4 ETI CLBD
Lieu : CPE LYON
Date : Avril 2026
Stack : Vue 3 · Node.js · Electron · Socket.IO · PostgreSQL · Redis

# PLUME — Gestion de flotte de chariots connectés

Système de gestion de flotte de chariots à bagages pour aéroport. Trois acteurs : l'**utilisateur** (agent au sol qui déverrouille et utilise un chariot), l'**administrateur** (superviseur qui surveille et pilote la flotte à distance) et le **chariot** lui-même (Raspberry Pi embarqué).

---

## Utilisation GitHub

Cloner le projet :

```bash
git clone https://github.com/RaphPicard/Plume.git
```

Récupérer les dernières modifications :

```bash
git pull
```

Commit et push :

```bash
git add .
git commit -m "message de commit"
git push
```

---

## Création du projet Node.js

> Historique de mise en place — ne pas rejouer sur un clone existant.

```bash
mkdir plume && cd plume
npm init -y
npm install socket.io jsonwebtoken express bcrypt pg redis dotenv
touch server/index.js
```

---

## Création du projet Vue (Frontend)

> Historique de mise en place — ne pas rejouer sur un clone existant.

```bash
cd app
npm create vite@latest . -- --template vue
npm install
npm install socket.io-client pinia vue-router
```

---

## Première installation (une seule fois)

### 1. Installer Docker Desktop

Télécharger sur [docker.com](https://www.docker.com/products/docker-desktop/) et le lancer.

### 2. Configurer les variables d'environnement

Vérifier que le fichier `.env` à la racine contient les bonnes valeurs (les valeurs par défaut fonctionnent en dev local).

> `server/load-env.js` charge automatiquement le `.env` au démarrage de chaque script Node.

### 3. Démarrer PostgreSQL + Redis

```bash
docker compose up -d
```

Les données PostgreSQL sont persistantes (volume Docker). Le schéma (`server/schema.sql`) est exécuté automatiquement au premier démarrage — il crée les tables `users` et `carts` et insère les chariots C-001, C-002, C-042.

### 4. Installer les dépendances et insérer les utilisateurs de test

```bash
npm install
node server/seed-users.js
```

Insère `raphou` (admin) et `evan` (user) avec leurs mots de passe hashés via bcrypt.

### 5. Installer les dépendances du frontend

```bash
cd app && npm install
```

Installe Vue, Vite, Socket.IO client, Pinia, Vue Router, Electron et les plugins associés.

### 6. Interface pgAdmin (optionnel)

```bash
docker compose up -d pgadmin
```

Connexion : Host `postgres`, Port `5432`, Username `postgres`, Password vide.




---

## Lancement courant

### Terminal 1 — Bases de données (PostgreSQL + Redis)

```bash
docker compose up -d
```

> Arrêter sans perdre les données : `docker compose stop`
> Reset complet : `docker compose down -v`

### Terminal 2 — Serveur Node.js (backend, port 3000)

```bash
node server/index.js
```

### Terminal 3 — Simulateur de chariot (optionnel, remplace le Raspberry Pi)

```bash
node server/simulate-cart.js
```

Simule un chariot qui envoie des données capteurs toutes les secondes.

### Terminal 4 — Frontend + Electron (port 5173)

```bash
cd app && npm run dev 
```                       (ou npm run dev:admin pour démarrer sur la page admin)

Lance Vite ET ouvre automatiquement la fenêtre desktop Electron avec hot-reload.
Pour tester dans un navigateur classique : ouvrir `http://localhost:5173`.

---

## Résumé du flux complet pour tester

```
1. docker compose up -d                        (PostgreSQL + Redis)
2. node server/index.js                        (backend :3000)
3. node server/simulate-cart.js                (chariot simulé)
4. cd app && npm run dev   (dev:admin)         (fenêtre Electron s'ouvre)
5. Login : raphou / raphou  (admin)
         ou evan / evan    (utilisateur)
6. Scanner le QR code d'un chariot ou saisir C-042
7. Confirmer sur le chariot (ou GET /simulate/cart-confirm/C-042)
8. → redirigé vers /session : données capteurs en temps réel
```

**Comptes de test :**
| Rôle | Login | Mot de passe |
|---|---|---|
| Admin | `raphou` | `raphou` |
| Utilisateur | `evan` | `evan` |
