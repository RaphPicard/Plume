const WebSocket = require('ws');
const fs = require('fs');
const { SerialPort } = require('serialport');
const { DelimiterParser } = require('@serialport/parser-delimiter');
const express = require('express');
const http = require('http');

let tracking = false;
let autoTrackingActive = false;

// ─── UART ─────────────────────────────────────────────────────────────────────
const uart = new SerialPort({
  path: '/dev/serial0',
  baudRate: 19200,
});

const parser = uart.pipe(new DelimiterParser({ delimiter: '\r' }));

uart.on('open',  () => console.log('[UART] Port ouvert'));
uart.on('error', (err) => console.error('[UART] Erreur:', err.message));

parser.on('data', (raw) => {
  // Logs détaillés pour debug
  console.log('[STM32 RAW] bytes:', raw, '| length:', raw.length, '| hex:', raw.toString('hex'));

  const msg = raw.toString('utf8').replace(/[\r\n]/g, '').trim();
  console.log('[STM32 CLEAN]', JSON.stringify(msg), '| length:', msg.length);

  if (!msg) return;
  console.log('[STM32 →]', msg);

  if (msg === 'CONFIRM') {
    console.log('[BTN] ✅ CONFIRM détecté → déverrouillage');
    triggerUnlock();
  } else {
    console.log('[BTN] ⚠️ message reçu mais != CONFIRM:', JSON.stringify(msg));
  }
});

// ─── PROTOCOLE ────────────────────────────────────────────────────────────────
const STATUS = { available: 0x01, paired: 0x02, locked: 0x03 };
const ALERT  = { low_battery: 0x01, obstacle_detected: 0x02 };

// Vecteurs de déplacement par direction : [vx, vy]
const DIR_VECTORS = {
  forward:  [ 0,  1],
  backward: [ 0, -1],
  left:     [-1,  0],
  right:    [ 1,  0],
};

// ─── FUSION DES COMMANDES MOVE ────────────────────────────────────────────────
function fuseMoveCommands(cmds) {
  const moves = cmds.filter(c => c.action === 'move');
  if (moves.length === 0) return null;

  let sumVx = 0, sumVy = 0, sumSpeed = 0, sumDiff = 0;

  for (const cmd of moves) {
    const args  = cmd.args ?? [];
    const dir   = args[0];
    const speed = args[1] ?? 50;
    const diff  = args[2] ?? 50;
    const vec   = DIR_VECTORS[dir];
    if (!vec) continue;
    sumVx    += vec[0] * speed;
    sumVy    += vec[1] * speed;
    sumSpeed += speed;
    sumDiff  += diff;
  }

  const n     = moves.length;
  const avgVx = sumVx / n;
  const avgVy = sumVy / n;
  const avgDiff = Math.round(sumDiff / n);

  let dir, speed;
  if (Math.abs(avgVy) >= Math.abs(avgVx)) {
    dir   = avgVy >= 0 ? 'forward' : 'backward';
    speed = Math.round(Math.abs(avgVy));
  } else {
    dir   = avgVx >= 0 ? 'right' : 'left';
    speed = Math.round(Math.abs(avgVx));
  }

  speed = Math.max(1, Math.min(100, speed));

  return { action: 'move', args: [dir, speed, avgDiff] };
}

// ─── TRAITEMENT JSON ──────────────────────────────────────────────────────────
let pendingCommand = null;

function handleCommand(jsonData) {
  const cmds = jsonData.cmds ?? [];
  if (cmds.length === 0) return;

  console.log(`[CART] ${jsonData.cartId} | status: ${jsonData.status} | alerts: ${jsonData.alerts}`);

  if (pendingCommand) {
    clearTimeout(pendingCommand);
    pendingCommand = null;
  }

  const fusedMove = fuseMoveCommands(cmds);
  const lastNonMove = [...cmds].reverse().find(c => c.action !== 'move');

  const finalCmd = lastNonMove ?? fusedMove;
  if (!finalCmd) return;

  console.log(`[CMD] action: ${finalCmd.action} args: ${JSON.stringify(finalCmd.args ?? [])}`);

  pendingCommand = setTimeout(() => {
    const frame = buildFrame(finalCmd.action, finalCmd.args ?? []);
    if (frame) sendFrame(frame);
    pendingCommand = null;
  }, 0);
}

// ─── CONSTRUCTION TRAME ASCII ─────────────────────────────────────────────────
function buildFrame(action, args) {
  let str;

  switch (action) {
    case 'move': {
      const dir   = args[0];
      const speed = args[1] ?? 50;
      const diff  = args[2] ?? 50;

      switch (dir) {
        case 'forward':  str = `FWD ${speed}`;           break;
        case 'backward': str = `BWD ${speed}`;           break;
        case 'left':     str = `TL ${speed} ${diff}`;    break;
        case 'right':    str = `TR ${speed} ${diff}`;    break;
        default:
          console.warn(`[WARN] Direction inconnue : ${dir}`);
          return null;
      }
      break;
    }

    case 'stop':
    case 'return_to_base':
      str = 'STOP';
      break;

    default:
      console.warn(`[WARN] Action inconnue : ${action}`);
      return null;
  }

  console.log(`[TRAME] ${str}`);
  return Buffer.from(str + '\r\n');
}

function sendFrame(frame) {
  uart.write(frame, (err) => {
    if (err) console.error('[UART] Write error:', err.message);
    else     console.log('[→ STM32]', frame.toString().trim());
  });
}

// ─── DÉVERROUILLAGE PAR BOUTON PHYSIQUE (STM32) ───────────────────────────────
async function triggerUnlock() {
  console.log('[BTN] triggerUnlock() appelée');
  const url = `${SERVER}/simulate/cart-confirm/${CART_ID}`;
  console.log('[BTN] POST vers:', url);
  try {
    const res = await fetch(url, { method: 'POST' });
    console.log('[BTN] HTTP status:', res.status);
    const data = await res.json();
    console.log('[BTN] Réponse serveur:', data);
    if (data.ok) {
      console.log('[BTN] ✅ Pairing confirmé pour', CART_ID);
    } else {
      console.error('[BTN] ❌ Erreur:', data.error);
    }
  } catch (e) {
    console.error('[BTN] ❌ Échec requête:', e.message);
  }
}

// ─── SERVEUR HTTP ─────────────────────────────────────────────────────────────
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

app.post('/command/register', (req, res) => {
  const { duration } = req.body;
  console.log(`[HTTP] POST /command/register - duration: ${duration}s`);
  res.json({ ok: true, message: `Enregistrement de ${duration}s lancé` });

  const detectionDurationMs = (duration || 10) * 1000;
  setTimeout(() => {
    autoTrackingActive = true;
    tracking = true;
    console.log('[DETECTION] Passage en auto_tracking');
    if (socket?.connected) {
      socket.emit('tracking_person_detected', {
        cartId: CART_ID, status: 'auto_tracking', tracking: true,
      });
    }
  }, detectionDurationMs);
});

app.post('/command/stop-tracking', (req, res) => {
  console.log('[HTTP] POST /command/stop-tracking');
  res.json({ ok: true, message: 'Auto-tracking arrêté' });
  autoTrackingActive = false;
  tracking = false;
  if (socket?.connected) {
    socket.emit('tracking_person_stopped', {
      cartId: CART_ID, status: 'paired', tracking: false,
    });
  }
});

const httpServer = http.createServer(app);
httpServer.listen(5500, '0.0.0.0', () => {
  console.log('[HTTP SERVER] Écoute sur port 5500');
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const { io } = require('socket.io-client');

const SERVER      = 'http://100.73.190.84:3000';
const CART_ID     = 'C-042';
const CART_SECRET = 'cart-dev-secret';

let socket = null;

async function getToken() {
  const res = await fetch(`${SERVER}/cart-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cartId: CART_ID, cartSecret: CART_SECRET }),
  });
  const { token } = await res.json();
  return token;
}

async function start() {
  const token = await getToken();
  socket = io(SERVER, { auth: { token } });

  socket.on('connect', () => {
    console.log('[Socket.IO] Connecté au serveur');

    setInterval(() => {
      socket.emit('sensor_data', {
        weightKg:   (Math.random() * 10).toFixed(1),
        batteryPct: Math.floor(Math.random() * 100),
        speedMs:    (autoTrackingActive || tracking) ? (Math.random() * 2).toFixed(2) : '0.00',
        accelX:     (Math.random() - 0.5).toFixed(3),
        accelY:     (Math.random() - 0.5).toFixed(3),
      });

      if (autoTrackingActive || tracking) {
        socket.emit('position_update', {
          x: (Math.random() * 100).toFixed(1),
          y: (Math.random() * 100).toFixed(1),
        });
      }
    }, 1000);
  });

  socket.on('connect_error', (err) => console.error('[Socket.IO] Erreur:', err.message));
  socket.on('disconnect',    ()    => console.log('[Socket.IO] Déconnecté'));

  socket.on('cmd', (data) => {
    console.log('[← SERVEUR]', JSON.stringify(data, null, 2));
    handleCommand(data);
  });
}

start();
