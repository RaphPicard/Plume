-- schema.sql
-- À exécuter une seule fois pour initialiser la base PostgreSQL "plume"
--
--   psql -U postgres -d plume -f schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,           -- hash bcrypt (jamais le mot de passe en clair)
  role          VARCHAR(20) NOT NULL DEFAULT 'user'  -- 'user' | 'admin'
);

-- Table du registre des chariots (IDs officiels)
-- L'état temps-réel (ownerId, status) reste dans Redis.
CREATE TABLE IF NOT EXISTS carts (
  cart_id VARCHAR(20) PRIMARY KEY
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Données initiales
-- Les hashs ci-dessous correspondent aux mots de passe en clair.
-- Pour en générer de nouveaux :
--   node -e "const b=require('bcrypt'); b.hash('monMotDePasse',10).then(console.log)"
-- ─────────────────────────────────────────────────────────────────────────────

-- Chariots
INSERT INTO carts (cart_id) VALUES ('C-001'), ('C-002'), ('C-042')
  ON CONFLICT DO NOTHING;

-- Utilisateurs (remplacer les hashs par des valeurs générées via bcrypt)
-- Mot de passe : raphou
INSERT INTO users (username, password_hash, role) VALUES
  ('raphou', '$2b$10$REMPLACER_PAR_UN_VRAI_HASH', 'admin'),
  ('evan',   '$2b$10$REMPLACER_PAR_UN_VRAI_HASH', 'user')
  ON CONFLICT DO NOTHING;
