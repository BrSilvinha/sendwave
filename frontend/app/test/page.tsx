'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

type CheckStatus = 'pending' | 'ok' | 'error' | 'running';

type Check = {
  id: string;
  label: string;
  detail: string;
  status: CheckStatus;
};

const initialChecks: Check[] = [
  { id: 'health',   label: 'Backend accesible',     detail: 'GET /health',                    status: 'pending' },
  { id: 'cors',     label: 'CORS configurado',       detail: 'Origen permitido',               status: 'pending' },
  { id: 'socket',   label: 'Socket.IO conectado',    detail: 'Conexión en tiempo real',        status: 'pending' },
  { id: 'wstatus',  label: 'Estado de WhatsApp',     detail: 'GET /api/status',                status: 'pending' },
  { id: 'groups',   label: 'Endpoint de grupos',     detail: 'GET /api/groups',                status: 'pending' },
];

function statusIcon(s: CheckStatus) {
  if (s === 'pending') return <span className="text-gray-300">○</span>;
  if (s === 'running') return <span className="text-blue-400 animate-pulse">◌</span>;
  if (s === 'ok')      return <span className="text-green-500">✓</span>;
  return                      <span className="text-red-500">✗</span>;
}

function statusBg(s: CheckStatus) {
  if (s === 'ok')    return 'bg-green-50 border-green-100';
  if (s === 'error') return 'bg-red-50 border-red-100';
  if (s === 'running') return 'bg-blue-50 border-blue-100';
  return 'bg-gray-50 border-gray-100';
}

export default function TestPage() {
  const [checks, setChecks] = useState<Check[]>(initialChecks);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  function update(id: string, status: CheckStatus, detail?: string) {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    if (detail) setDetails((prev) => ({ ...prev, [id]: detail }));
  }

  async function runChecks() {
    setRunning(true);
    setDone(false);
    setChecks(initialChecks.map((c) => ({ ...c, status: 'pending' })));
    setDetails({});

    // 1. Health check
    update('health', 'running');
    try {
      const r = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        update('health', 'ok', `uptime: ${Math.round(d.uptime)}s | waStatus: ${d.waStatus}`);
      } else {
        update('health', 'error', `HTTP ${r.status}`);
      }
    } catch (e: unknown) {
      update('health', 'error', e instanceof Error ? e.message : 'No se pudo conectar');
    }

    // 2. CORS
    update('cors', 'running');
    try {
      const r = await fetch(`${BACKEND}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      update('cors', r.ok ? 'ok' : 'error', r.ok ? 'Cabeceras CORS correctas' : `HTTP ${r.status}`);
    } catch (e: unknown) {
      update('cors', 'error', e instanceof Error ? e.message : 'Error CORS');
    }

    // 3. Socket.IO
    update('socket', 'running');
    await new Promise<void>((resolve) => {
      const socket = io(BACKEND, { timeout: 8000, transports: ['polling', 'websocket'] });
      const t = setTimeout(() => {
        socket.disconnect();
        update('socket', 'error', 'Timeout — sin respuesta en 8s');
        resolve();
      }, 9000);

      socket.on('connect', () => {
        clearTimeout(t);
        update('socket', 'ok', `Socket ID: ${socket.id}`);
        socket.disconnect();
        resolve();
      });

      socket.on('connect_error', (err) => {
        clearTimeout(t);
        update('socket', 'error', err.message);
        socket.disconnect();
        resolve();
      });
    });

    // 4. WhatsApp status
    update('wstatus', 'running');
    try {
      const r = await fetch(`${BACKEND}/api/status`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        update('wstatus', 'ok', `connected: ${d.connected} | status: ${d.waStatus}`);
      } else {
        update('wstatus', 'error', `HTTP ${r.status}`);
      }
    } catch (e: unknown) {
      update('wstatus', 'error', e instanceof Error ? e.message : 'Error');
    }

    // 5. Groups endpoint
    update('groups', 'running');
    try {
      const r = await fetch(`${BACKEND}/api/groups`, { signal: AbortSignal.timeout(8000) });
      if (r.status === 400) {
        const d = await r.json();
        update('groups', 'ok', `Endpoint responde: "${d.error}" (esperado si WA no conectado)`);
      } else if (r.ok) {
        const d = await r.json();
        update('groups', 'ok', `${d.groups?.length ?? 0} grupo(s) encontrado(s)`);
      } else {
        update('groups', 'error', `HTTP ${r.status}`);
      }
    } catch (e: unknown) {
      update('groups', 'error', e instanceof Error ? e.message : 'Error');
    }

    setRunning(false);
    setDone(true);
  }

  useEffect(() => { runChecks(); }, []);

  const okCount = checks.filter((c) => c.status === 'ok').length;
  const errCount = checks.filter((c) => c.status === 'error').length;
  const allOk = done && errCount === 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Test de sistema</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Backend: <span className="font-mono text-xs">{BACKEND}</span>
          </p>
        </div>
        <button
          onClick={runChecks}
          disabled={running}
          className="px-4 py-2 rounded-xl bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {running ? 'Ejecutando...' : 'Repetir tests'}
        </button>
      </div>

      {done && (
        <div className={`rounded-2xl border p-4 mb-6 flex items-center gap-3 ${allOk ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <span className={`text-2xl font-bold ${allOk ? 'text-green-600' : 'text-red-500'}`}>
            {allOk ? '✓' : '✗'}
          </span>
          <div>
            <p className={`font-semibold ${allOk ? 'text-green-700' : 'text-red-600'}`}>
              {allOk ? 'Todo funcionando correctamente' : `${errCount} problema(s) detectado(s)`}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{okCount}/{checks.length} checks pasaron</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {checks.map((c) => (
          <div key={c.id} className={`rounded-2xl border p-4 ${statusBg(c.status)}`}>
            <div className="flex items-center gap-3">
              <span className="text-lg w-5 text-center">{statusIcon(c.status)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{c.label}</p>
                <p className="text-xs text-gray-400">{c.detail}</p>
              </div>
              {c.status === 'running' && (
                <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
              )}
            </div>
            {details[c.id] && (
              <p className="mt-2 ml-8 text-xs font-mono text-gray-500 break-all">{details[c.id]}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <a href="/" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          ← Volver a la app
        </a>
      </div>
    </div>
  );
}
