import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// ── CORS (desarrollo local + Electron) ───────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
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

// ── Servir frontend estático (build de Next.js) ───────────────────────────────
const frontendOut = process.env.FRONTEND_OUT ?? path.join(__dirname, '..', 'frontend', 'out');
app.use(express.static(frontendOut));

// ── Estado global ─────────────────────────────────────────────────────────────
let waSocket = null;
let isConnected = false;
let currentQr = null;
let waStatus = 'loading';
let isSending = false;
let reconnectDelay = 3000;
let hadQr = false;

const connectedSockets = new Set();
const stats = { totalSent: 0, totalErrors: 0, qrScans: 0, activeSend: null };

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () => delay(1500 + Math.random() * 1500);

// ── WhatsApp con Baileys ──────────────────────────────────────────────────────
async function initWhatsApp() {
  const authDir = process.env.WA_AUTH_PATH
    ? path.join(process.env.WA_AUTH_PATH, '.auth_state')
    : '.auth_state';
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['SendWave', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      hadQr = true;
      currentQr = qr;
      waStatus = 'qr';
      io.emit('qr', qr);
      io.emit('status', 'qr');
      console.log('QR generado — escanea con tu WhatsApp');
    }

    if (connection === 'connecting') {
      waStatus = 'loading';
      io.emit('status', 'loading');
    }

    if (connection === 'open') {
      isConnected = true;
      waSocket = sock;
      currentQr = null;
      waStatus = 'ready';
      reconnectDelay = 3000;
      if (hadQr) { stats.qrScans += 1; hadQr = false; }
      io.emit('status', 'ready');
      console.log('WhatsApp listo');
    }

    if (connection === 'close') {
      isConnected = false;
      waSocket = null;
      waStatus = 'disconnected';
      io.emit('status', 'disconnected');

      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log('Sesión cerrada — se necesita nuevo QR');
        reconnectDelay = 3000;
      } else {
        console.log(`Desconectado (${code}) — reconectando en ${reconnectDelay}ms`);
      }
      setTimeout(initWhatsApp, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
    }
  });
}

initWhatsApp().catch((err) => console.error('Error iniciando WhatsApp:', err));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, waStatus, uptime: process.uptime() });
});

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ connected: isConnected, waStatus });
});

app.get('/api/groups', async (req, res) => {
  if (!isConnected || !waSocket) return res.status(400).json({ error: 'WhatsApp no está conectado' });
  try {
    const raw = await waSocket.groupFetchAllParticipating();
    const groups = Object.values(raw).map((g) => ({
      id: g.id,
      name: g.subject,
      memberCount: g.participants.length,
    }));
    res.json({ groups });
  } catch {
    res.status(500).json({ error: 'Error al obtener grupos' });
  }
});

app.get('/api/groups/:groupId/members', async (req, res) => {
  if (!isConnected || !waSocket) return res.status(400).json({ error: 'WhatsApp no está conectado' });
  try {
    const metadata = await waSocket.groupMetadata(req.params.groupId);
    const numbers = metadata.participants
      .filter((p) => p.id.endsWith('@s.whatsapp.net'))
      .map((p) => p.id.split('@')[0])
      .filter(Boolean);
    res.json({ numbers, total: numbers.length });
  } catch {
    res.status(500).json({ error: 'Error al obtener miembros' });
  }
});

app.post('/api/send', async (req, res) => {
  if (!isConnected || !waSocket) return res.status(400).json({ error: 'WhatsApp no está conectado' });
  if (isSending) return res.status(429).json({ error: 'Ya hay un envío en curso' });

  const { numbers, message } = req.body;
  if (!Array.isArray(numbers) || numbers.length === 0 || !message?.trim())
    return res.status(400).json({ error: 'Faltan números o mensaje' });
  if (message.trim().length > 4096)
    return res.status(400).json({ error: 'El mensaje excede 4096 caracteres' });

  const valid = numbers.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 7 && n.length <= 15);
  if (!valid.length) return res.status(400).json({ error: 'No hay números válidos' });

  isSending = true;
  stats.activeSend = { total: valid.length, sent: 0, errors: 0 };
  res.json({ ok: true, total: valid.length });

  for (let i = 0; i < valid.length; i++) {
    const raw = valid[i];
    try {
      await waSocket.sendMessage(`${raw}@s.whatsapp.net`, { text: message.trim() });
      stats.totalSent += 1;
      stats.activeSend.sent += 1;
      io.emit('progress', { index: i + 1, total: valid.length, number: raw, status: 'sent' });
      console.log(`[${i + 1}/${valid.length}] Enviado a ${raw}`);
    } catch (err) {
      stats.totalErrors += 1;
      stats.activeSend.errors += 1;
      io.emit('progress', { index: i + 1, total: valid.length, number: raw, status: 'error' });
      console.log(`[${i + 1}/${valid.length}] Error en ${raw}: ${err.message}`);
    }
    if (i < valid.length - 1) await randomDelay();
  }

  isSending = false;
  stats.activeSend = null;
  io.emit('done', {});
});

// ── Sockets ───────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  connectedSockets.add(socket.id);

  socket.emit('status', isConnected ? 'ready' : currentQr ? 'qr' : 'loading');
  if (currentQr) socket.emit('qr', currentQr);

  socket.on('disconnect', () => { connectedSockets.delete(socket.id); });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => console.log(`SendWave corriendo en http://localhost:${PORT}`));
