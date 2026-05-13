// src/api/config.js
// URL dynamique : si on est sur le navigateur (web ou mobile), on utilise le même
// hostname que la page courante. Si on est sur Electron (file://), on retombe sur localhost.

function getServerUrl() {
  const host = window.location.hostname
  if (!host || host === '' || window.location.protocol === 'file:') {
    return 'http://localhost:3000'
  }
  return `http://${host}:3000`
}

export const SERVER_URL = getServerUrl()
