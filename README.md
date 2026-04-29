Par : Picard Raphaël 4 ETI CLBD
Lieu : CPE LYON
date : Avril 2026
Codé en : Vue, NodeJS ...

# Projet_Transversal

Projet d'une base roulante permettant de déplacer les bagages d'un utilisateur dans un aéroport et de le suivre. Ici on va développer le serveur admin et l'application utilisateur.

## Utilisation Ghitub

- Pour cloner le projet, utilisez la commande suivante dans votre terminal :

```bash
git clone https://github.com/Raphouman/Plume.git
```

- Pour récupérer les dernières modifications, utilisez la commande suivante :

```bash
git pull
```

ou `git pull origin main`

- On modifie le code et on commit les changements :

```bash
git add .
git commit -m "Votre message de commit ici"
git push
```

---

---

## Création projet Node.js

### 1. Installer Node.js (si pas fait)

### → télécharger sur nodejs.org, version LTS

### 2. Créer le dossier projet

mkdir plume
cd plume

### 3. Initialiser le projet Node (crée un fichier package.json)

npm init -y

### 4. Installer les bibliothèques dont on a besoin

npm install socket.io # WebSocket
npm install jsonwebtoken # JWT
npm install express # Serveur HTTP pour la route /login

### 5. Créer le fichier principal

touch server/index.js

### 6. Lancer le serveur

node server/index.js

---

---

## Création projet View (Frontend)

### À la racine du dépôt

cd app

### Créer le projet Vue avec Vite

npm create vite@latest . -- --template vue

### Le "." = créer dans le dossier courant

### Installer les dépendances Vue

npm install

### Installer Socket.IO client + Pinia (état global) + Vue Router (navigation)

npm install socket.io-client pinia vue-router

### Lancer le serveur de dev

npm run dev

# → ouvre http://localhost:5173

---

---

#

```bash
docker compose up -d pgadmin
```

Add New Server →

Name : plume
Host : postgres (nom du service Docker, pas localhost)
Port : 5432 LANCER

## Première installation (une seule fois)

### 1. Installer Docker Desktop

Télécharger sur [docker.com](https://www.docker.com/products/docker-desktop/) et le lancer.

### 2. Démarrer PostgreSQL + Redis

```bash
docker compose up -d
```

Lance les deux bases en arrière-plan. Les données PostgreSQL sont persistantes (volume Docker).

### 3. Initialisation automatique de la base

Le schéma [server/schema.sql](server/schema.sql) est exécuté automatiquement au premier démarrage de PostgreSQL via `docker-compose.yml`.
Il crée les tables `users` et `carts` et insère les chariots C-001, C-002, C-042.

### 4. Installer les dépendances Node et insérer les utilisateurs

```bash
npm install
node server/seed-users.js
```

Insère `raphou` (admin) et `evan` (user) avec leurs mots de passe hashés via bcrypt.

### 5. Rajouter l'interface pgAdmin

```bash
docker compose up -d pgadmin
```

Add New Server →

Name : plume
Host : postgres (nom du service Docker, pas localhost)
Port : 5432
Username : postgres
Password : (laisser vide)

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

### Terminal 3 — Simulateur de chariot (optionnel)

```bash
node server/simulate-cart.js
```

Simule un chariot qui envoie des données toutes les secondes (pour tester sans vrai hardware).

### Terminal 4 — Frontend Vue (port 5173)

```bash
cd app && npm run dev
```

---

## Résumé du flux complet pour tester

```
1. docker compose up -d                   (PostgreSQL + Redis)
2. node server/index.js                   (port 3000)
3. cd app  →  npm run dev                 (port 5173)
4. Ouvrir http://localhost:5173
5. Login : raphou / raphou  (ou evan / evan)
6. Saisir un cartId : C-042
7. → redirigé vers /tracking
8. Les données capteurs arrivent quand le chariot émet 'sensor_data'
```

---

---

# TODO

voir claude.md et implémenter ce qu'il manque

## Pour déployer sur le Raspberry pi

### Sur le Raspberry Pi

git clone ... && cd raspberry
npm install

### Éditer config.js (SERVER_URL = IP du serveur, CART_ID = id du chariot)

npm start

---

# TODO feat evanman (architecture à respecter)

## TODO IMPORTANT EVANMAN
- Créer une route `localhost:5173/admin` (pas de boutton en Vue) qui emmene sur une page login (token admin à rentrer ==> JWT stocké en bdd ET vérif la JWT à chaque requete sur les routes /admin/\*)
  - Après login, rediriger vers `/admin/dashboard` qui affiche la liste des chariots et leurs données en temps réel (via Socket.IO)

- Persistance session, création session






- QR CODE du chariot/robot (id hashé ?) qui renvoie vers localhost:5173/tracking?cartId={cartId}
  (ca évite d'avoir une caméra pour scanner les qr codes dans l'application elle même)
  - id = entier (pas de lettre [ex : C-001]) pour éviter les problèmes de saisie

- `localhost:5173/tracking?cartId={cartId}` ==> Page connexion au robot (batterie/etat + boutton connexion AU CHARIOT)
- CONNEXION AU CHARIOT (demande de PAIRING) :
  - Socket.IO émet un événement `pairing_request` (de la part du client/Vue) avec le cartId
  - Le serveur Node.js reçoit la requête, vérifie l'état du chariot (il a accès à l'état de chaque chariot, et PAS via la bdd), et stocke une entrée dans Redis avec une clé `pairing:{cartId}`
  - Si dispo ==> Change l'état du chariot (dans le client [robot] qui va maj son état au server)
    ET émet un événement `pairing_success` au client Vue, qui peut alors se connecter au chariot (à son interface visuelle)






# TODO IMPORTANT RAPHOUMAN
- COMMANDES : 
   - A stocker dans 3 listes dans le JSON : `ACKcmd[id]` et `execCmd[id]` et (pour différencier les commandes en attente et celles exécutées). Et `SkipCmd[id]` pour les commandes ignorées (pour les ignorer, suite à un ordre de priorité)

- JSON envoyé du serveur au raspberry doit se faire toutes les X ms et doit contenir les données suivantes: 
```json
{
  "cartId": "C-001",
  "status": "available/paired/locked",
  "alerts": ["low_battery", "obstacle_detected"],
  "cmds": [
    {
      "id": "cmd-123",
      "action": "move",
      "args": ["left/right/forward/backward"]
    }, 
    {
      "id": "cmd-124",
      "action": "stop",
      "args": []
    },
    {
      "id": "cmd-125",
      "action": "return_to_base",
      "args": []
    }
  ]
}
```
