const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGIN = process.env.FRONTEND_URL ?? 'http://localhost:3000';

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// ── Auth config ──────────────────────────────────────────────────────────────
const ADMIN_USER = '71749437';
const ADMIN_PASS_HASH = bcrypt.hashSync('71749437', 10);
const JWT_SECRET = 'sw$X9!kPqL2#mRv8@nZdTy6^cJhWbAeU';
const JWT_EXPIRES = '8h';

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

const connectedSockets = new Set();

const stats = {
  totalSent: 0,
  totalErrors: 0,
  qrScans: 0,
  activeSend: null,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = () => delay(1500 + Math.random() * 1500);

function emitAdminStats() {
  io.to('admin').emit('admin-update', {
    connectedClients: connectedSockets.size,
    waStatus,
    stats,
  });
}

function initWhatsApp() {
  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  waClient.on('qr', (qr) => {
    currentQr = qr;
    isConnected = false;
    waStatus = 'qr';
    io.emit('qr', qr);
    io.emit('status', 'qr');
    emitAdminStats();
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
    io.emit('status', 'authenticated');
    emitAdminStats();
    console.log('Sesión autenticada');
  });

  waClient.on('ready', () => {
    isConnected = true;
    currentQr = null;
    waStatus = 'ready';
    io.emit('status', 'ready');
    emitAdminStats();
    console.log('WhatsApp listo');
  });

  waClient.on('disconnected', (reason) => {
    isConnected = false;
    currentQr = null;
    waStatus = 'disconnected';
    io.emit('status', 'disconnected');
    emitAdminStats();
    console.log('Desconectado:', reason);
    setTimeout(initWhatsApp, 3000);
  });

  waClient.initialize();
}

initWhatsApp();

// ── Public routes ─────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ connected: isConnected, qr: currentQr });
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  const userOk = username === ADMIN_USER;
  const passOk = userOk && (await bcrypt.compare(password, ADMIN_PASS_HASH));

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups/:groupId/members', async (req, res) => {
  if (!isConnected) return res.status(400).json({ error: 'WhatsApp no está conectado' });

  try {
    const chat = await waClient.getChatById(req.params.groupId);
    if (!chat.isGroup) return res.status(400).json({ error: 'No es un grupo' });

    const numbers = chat.participants.map((p) => p.id.user).filter(Boolean);
    res.json({ numbers, total: numbers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send', async (req, res) => {
  const { numbers, message } = req.body;

  if (!isConnected) return res.status(400).json({ error: 'WhatsApp no está conectado' });

  if (!Array.isArray(numbers) || numbers.length === 0 || !message?.trim()) {
    return res.status(400).json({ error: 'Faltan números o mensaje' });
  }

  const total = numbers.length;
  const results = [];

  stats.activeSend = { total, sent: 0, errors: 0 };
  emitAdminStats();

  res.json({ ok: true, total });

  for (let i = 0; i < numbers.length; i++) {
    const raw = String(numbers[i]).replace(/\D/g, '');
    if (!raw) continue;

    const chatId = `${raw}@c.us`;

    try {
      await waClient.sendMessage(chatId, message.trim());
      results.push({ number: raw, status: 'sent' });
      stats.totalSent += 1;
      stats.activeSend.sent += 1;
      io.emit('progress', { index: i + 1, total, number: raw, status: 'sent' });
      emitAdminStats();
      console.log(`[${i + 1}/${total}] Enviado a ${raw}`);
    } catch (err) {
      results.push({ number: raw, status: 'error', error: err.message });
      stats.totalErrors += 1;
      stats.activeSend.errors += 1;
      io.emit('progress', { index: i + 1, total, number: raw, status: 'error' });
      emitAdminStats();
      console.log(`[${i + 1}/${total}] Error en ${raw}: ${err.message}`);
    }

    if (i < numbers.length - 1) await randomDelay();
  }

  stats.activeSend = null;
  io.emit('done', { results });
  emitAdminStats();
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
    socket.emit('admin-update', {
      connectedClients: connectedSockets.size,
      waStatus,
      stats,
    });
  });

  socket.on('disconnect', () => {
    connectedSockets.delete(socket.id);
    emitAdminStats();
  });
});

server.listen(3001, () => {
  console.log('SendWave backend corriendo en http://localhost:3001');
});
