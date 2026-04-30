'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import Link from 'next/link';

type WaStatus = 'loading' | 'qr' | 'authenticated' | 'ready' | 'disconnected';

type ActiveSend = { total: number; sent: number; errors: number } | null;

type AdminData = {
  connectedClients: number;
  waStatus: WaStatus;
  stats: {
    totalSent: number;
    totalErrors: number;
    qrScans: number;
    activeSend: ActiveSend;
  };
};

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

const waStatusLabel: Record<WaStatus, string> = {
  loading: 'Iniciando',
  qr: 'Esperando QR',
  authenticated: 'Autenticando',
  ready: 'Conectado',
  disconnected: 'Desconectado',
};

const waStatusColor: Record<WaStatus, string> = {
  loading: 'text-yellow-600 bg-yellow-50',
  qr: 'text-blue-600 bg-blue-50',
  authenticated: 'text-yellow-600 bg-yellow-50',
  ready: 'text-green-600 bg-green-50',
  disconnected: 'text-red-600 bg-red-50',
};

const waStatusDot: Record<WaStatus, string> = {
  loading: 'bg-yellow-400',
  qr: 'bg-blue-400',
  authenticated: 'bg-yellow-400',
  ready: 'bg-green-500',
  disconnected: 'bg-red-500',
};

const TOKEN_KEY = 'sw_admin_token';

function getStoredToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-3xl font-bold ${accent ?? 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────
function LoginForm({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Error al iniciar sesión');
        return;
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      onSuccess(data.token);
    } catch {
      setError('No se pudo conectar con el servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">Admin</h1>
          <p className="text-sm text-gray-400 mt-1">Acceso restringido</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Usuario</label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent"
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Contraseña</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent"
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2.5 rounded-xl bg-gray-800 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>

        <p className="text-center mt-4">
          <Link href="/" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            ← Volver al inicio
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [socketOk, setSocketOk] = useState(false);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    const socket = io(BACKEND);

    socket.on('connect', () => {
      setSocketOk(true);
      socket.emit('join-admin', token);
    });

    socket.on('disconnect', () => setSocketOk(false));

    socket.on('admin-update', (d: AdminData) => setData(d));

    socket.on('admin-auth-error', () => {
      setAuthError(true);
      socket.disconnect();
    });

    return () => { socket.disconnect(); };
  }, [token]);

  if (authError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Sesión expirada. Vuelve a iniciar sesión.</p>
          <button
            onClick={onLogout}
            className="text-sm px-4 py-2 rounded-xl bg-gray-800 text-white hover:bg-gray-700 transition-colors"
          >
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  const s = data?.stats;
  const activeSend = s?.activeSend ?? null;
  const sendProgress = activeSend
    ? Math.round(((activeSend.sent + activeSend.errors) / activeSend.total) * 100)
    : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Admin</h1>
          <p className="text-sm text-gray-400 mt-0.5">Monitoreo en tiempo real</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-xs font-medium ${socketOk ? 'text-green-600' : 'text-gray-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${socketOk ? 'bg-green-500' : 'bg-gray-300'}`} />
            {socketOk ? 'En vivo' : 'Desconectado'}
          </span>
          <button
            onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Cerrar sesión
          </button>
          <Link
            href="/"
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
          >
            ← Volver
          </Link>
        </div>
      </div>

      {!data ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
          Cargando...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Estado WhatsApp */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Estado WhatsApp</p>
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${waStatusColor[data.waStatus]}`}>
                <span className={`w-2 h-2 rounded-full ${waStatusDot[data.waStatus]}`} />
                {waStatusLabel[data.waStatus]}
              </span>
              {data.waStatus === 'qr' && (
                <span className="text-xs text-gray-400">Esperando escaneo de QR</span>
              )}
            </div>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Clientes conectados"
              value={data.connectedClients}
              sub="pestañas abiertas"
              accent="text-blue-600"
            />
            <StatCard
              label="QR escaneados"
              value={s?.qrScans ?? 0}
              sub="autenticaciones"
              accent="text-purple-600"
            />
            <StatCard
              label="Mensajes enviados"
              value={s?.totalSent ?? 0}
              sub="en esta sesión"
              accent="text-green-600"
            />
            <StatCard
              label="Errores"
              value={s?.totalErrors ?? 0}
              sub="en esta sesión"
              accent={s?.totalErrors ? 'text-red-500' : 'text-gray-400'}
            />
          </div>

          {/* Envío activo */}
          {activeSend ? (
            <div className="bg-white rounded-2xl border border-green-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                  Envío en curso
                </p>
                <span className="text-xs text-gray-400">
                  {activeSend.sent + activeSend.errors} / {activeSend.total} procesados
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${sendProgress}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-green-600 font-medium">{activeSend.sent} enviados</span>
                {activeSend.errors > 0 && (
                  <span className="text-red-500 font-medium">{activeSend.errors} errores</span>
                )}
                <span className="text-gray-400 ml-auto">{sendProgress}%</span>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5">
              <p className="text-sm text-gray-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                Sin envío activo en este momento
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setToken(getStoredToken());
    setChecked(true);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  };

  if (!checked) return null;

  if (!token) {
    return <LoginForm onSuccess={(t) => setToken(t)} />;
  }

  return <Dashboard token={token} onLogout={handleLogout} />;
}
