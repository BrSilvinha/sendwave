const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://sendwave-lime.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('CORS: origen no permitido'));
  },
  methods: ['GET', 'POST'],
};

const io = new Server(server, { cors: corsOptions });
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ── Auth config ───────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || '71749437';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || bcrypt.hashSync('71749437', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'sw$X9!kPqL2#mRv8@nZdTy6^cJhWbAeU';
const JWT_EXPIRES = '8h';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET no está configurado como variable de entorno — usando valor por defecto (inseguro en producción)');
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function verifyAdminToken(token) {
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

let waClient = null;
let isConnected = false;
let currentQr = null;
let waStatus = 'loading';
let isSending = false;

const connectedSockets = new Set();

const stats = {
  totalSent: 0,
  totalErrors: 0,
  qrScans: 0,
  activeSend: null,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = () => delay(1500 + Math.random() * 1500);

// Throttle admin stats to max once per second
let adminStatsTimer = null;
function emitAdminStats() {
  if (adminStatsTimer) return;
  adminStatsTimer = setTimeout(() => {
    io.to('admin').emit('admin-update', {
      connectedClients: connectedSockets.size,
      waStatus,
      stats,
    });
    adminStatsTimer = null;
  }, 1000);
}

function emitAdminStatsNow() {
  clearTimeout(adminStatsTimer);
  adminStatsTimer = null;
  io.to('admin').emit('admin-update', {
    connectedClients: connectedSockets.size,
    waStatus,
    stats,
  });
}

let reconnectDelay = 3000;

function initWhatsApp() {
  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  });

  waClient.on('qr', (qr) => {
    currentQr = qr;
    isConnected = false;
    waStatus = 'qr';
    io.emit('qr', qr);
    io.emit('status', 'qr');
    emitAdminStatsNow();
    console.log('QR generado — escanea con tu WhatsApp');
  });

  waClient.on('loading_screen', (percent) => {
    waStatus = 'loading';
    io.emit('status', 'loading');
    emitAdminStats();
    console.log(`Cargando WhatsApp: ${percent}%`);
  });

  waClient.on('authenticated', () => {
    waStatus = 'authenticated';
    stats.qrScans += 1;
    reconnectDelay = 3000;
    io.emit('status', 'authenticated');
    emitAdminStatsNow();
    console.log('Sesión autenticada');
  });

  waClient.on('ready', () => {
    isConnected = true;
    currentQr = null;
    waStatus = 'ready';
    io.emit('status', 'ready');
    emitAdminStatsNow();
    console.log('WhatsApp listo');
  });

  waClient.on('disconnected', (reason) => {
    isConnected = false;
    currentQr = null;
    waStatus = 'disconnected';
    io.emit('status', 'disconnected');
    emitAdminStatsNow();
    console.log('Desconectado:', reason);
    // Exponential backoff: 3s → 6s → 12s → max 60s
    setTimeout(initWhatsApp, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  });

  waClient.on('auth_failure', (msg) => {
    console.error('Error de autenticación:', msg);
    waStatus = 'disconnected';
    emitAdminStatsNow();
  });

  waClient.initialize();
}

initWhatsApp();

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, waStatus, uptime: process.uptime() });
});

// ── Public routes ─────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ connected: isConnected, waStatus });
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }
  const userOk = username === ADMIN_USER;
  const passOk = userOk && (await bcrypt.compare(String(password), ADMIN_PASS_HASH));
  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  const token = jwt.sign({ sub: ADMIN_USER }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token });
});

// ── Protected admin routes ────────────────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({ connectedClients: connectedSockets.size, waStatus, stats });
});

// ── WhatsApp routes ───────────────────────────────────────────────────────────
app.get('/api/groups', async (req, res) => {
  if (!isConnected) return res.status(400).json({ error: 'WhatsApp no está conectado' });
  try {
    const chats = await waClient.getChats();
    const groups = chats
      .filter((c) => c.isGroup)
      .map((g) => ({ id: g.id._serialized, name: g.name, memberCount: g.participants?.length ?? 0 }));
    res.json({ groups });
  } catch {
    res.status(500).json({ error: 'Error al obtener grupos' });
  }
});

app.get('/api/groups/:groupId/members', async (req, res) => {
  if (!isConnected) return res.status(400).json({ error: 'WhatsApp no está conectado' });
  try {
    const chat = await waClient.getChatById(req.params.groupId);
    if (!chat.isGroup) return res.status(400).json({ error: 'No es un grupo' });
    const numbers = chat.participants.map((p) => p.id.user).filter(Boolean);
    res.json({ numbers, total: numbers.length });
  } catch {
    res.status(500).json({ error: 'Error al obtener miembros' });
  }
});

app.post('/api/send', async (req, res) => {
  if (!isConnected) return res.status(400).json({ error: 'WhatsApp no está conectado' });
  if (isSending) return res.status(429).json({ error: 'Ya hay un envío en curso' });

  const { numbers, message } = req.body;
  if (!Array.isArray(numbers) || numbers.length === 0 || !message?.trim()) {
    return res.status(400).json({ error: 'Faltan números o mensaje' });
  }
  if (message.trim().length > 4096) {
    return res.status(400).json({ error: 'El mensaje excede 4096 caracteres' });
  }

  const valid = numbers
    .map((n) => String(n).replace(/\D/g, ''))
    .filter((n) => n.length >= 7 && n.length <= 15);

  if (!valid.length) return res.status(400).json({ error: 'No hay números válidos' });

  isSending = true;
  stats.activeSend = { total: valid.length, sent: 0, errors: 0 };
  emitAdminStatsNow();
  res.json({ ok: true, total: valid.length });

  for (let i = 0; i < valid.length; i++) {
    const raw = valid[i];
    try {
      await waClient.sendMessage(`${raw}@c.us`, message.trim());
      stats.totalSent += 1;
      stats.activeSend.sent += 1;
      io.emit('progress', { index: i + 1, total: valid.length, number: raw, status: 'sent' });
      emitAdminStats();
      console.log(`[${i + 1}/${valid.length}] Enviado a ${raw}`);
    } catch (err) {
      stats.totalErrors += 1;
      stats.activeSend.errors += 1;
      io.emit('progress', { index: i + 1, total: valid.length, number: raw, status: 'error' });
      emitAdminStats();
      console.log(`[${i + 1}/${valid.length}] Error en ${raw}: ${err.message}`);
    }
    if (i < valid.length - 1) await randomDelay();
  }

  isSending = false;
  stats.activeSend = null;
  io.emit('done', {});
  emitAdminStatsNow();
});

// ── Sockets ───────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  connectedSockets.add(socket.id);
  emitAdminStats();

  socket.emit('status', isConnected ? 'ready' : currentQr ? 'qr' : 'loading');
  if (currentQr) socket.emit('qr', currentQr);

  socket.on('join-admin', (token) => {
    if (!verifyAdminToken(token)) {
      socket.emit('admin-auth-error', 'Token inválido');
      return;
    }
    socket.join('admin');
    socket.emit('admin-update', { connectedClients: connectedSockets.size, waStatus, stats });
  });

  socket.on('disconnect', () => {
    connectedSockets.delete(socket.id);
    emitAdminStats();
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown() {
  console.log('Cerrando servidor...');
  server.close(() => {
    console.log('Servidor cerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => {
  console.log(`SendWave backend corriendo en http://localhost:${PORT}`);
});
