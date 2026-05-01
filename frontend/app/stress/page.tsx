'use client';

import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

type Result = {
  id: string;
  label: string;
  status: 'ok' | 'error' | 'running' | 'pending';
  ms: number | null;
  detail: string;
};

type Summary = {
  total: number;
  passed: number;
  failed: number;
  avgMs: number;
  maxMs: number;
  minMs: number;
};

async function timed(fn: () => Promise<string>): Promise<{ ms: number; detail: string; ok: boolean }> {
  const start = performance.now();
  try {
    const detail = await fn();
    return { ms: Math.round(performance.now() - start), detail, ok: true };
  } catch (e: unknown) {
    return { ms: Math.round(performance.now() - start), detail: e instanceof Error ? e.message : 'Error', ok: false };
  }
}

function connectSocket(): Promise<{ ms: number; detail: string; ok: boolean }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = io(BACKEND, { timeout: 8000, transports: ['polling', 'websocket'] });
    const t = setTimeout(() => {
      socket.disconnect();
      resolve({ ms: Math.round(performance.now() - start), detail: 'Timeout >8s', ok: false });
    }, 8000);
    socket.on('connect', () => {
      clearTimeout(t);
      const ms = Math.round(performance.now() - start);
      socket.disconnect();
      resolve({ ms, detail: `ID: ${socket.id}`, ok: true });
    });
    socket.on('connect_error', (err) => {
      clearTimeout(t);
      socket.disconnect();
      resolve({ ms: Math.round(performance.now() - start), detail: err.message, ok: false });
    });
  });
}

export default function StressPage() {
  const [results, setResults] = useState<Result[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  function setResult(id: string, patch: Partial<Result>) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function runStress() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setSummary(null);

    const tests: Result[] = [
      { id: 'health_1',  label: 'GET /health (req 1)',           status: 'pending', ms: null, detail: '' },
      { id: 'health_2',  label: 'GET /health (req 2)',           status: 'pending', ms: null, detail: '' },
      { id: 'health_3',  label: 'GET /health (req 3)',           status: 'pending', ms: null, detail: '' },
      { id: 'health_4',  label: 'GET /health (req 4)',           status: 'pending', ms: null, detail: '' },
      { id: 'health_5',  label: 'GET /health (req 5)',           status: 'pending', ms: null, detail: '' },
      { id: 'status_1',  label: 'GET /api/status (req 1)',       status: 'pending', ms: null, detail: '' },
      { id: 'status_2',  label: 'GET /api/status (req 2)',       status: 'pending', ms: null, detail: '' },
      { id: 'status_3',  label: 'GET /api/status (req 3)',       status: 'pending', ms: null, detail: '' },
      { id: 'login_bad', label: 'POST /api/admin/login (401)',   status: 'pending', ms: null, detail: '' },
      { id: 'groups',    label: 'GET /api/groups (sin WA)',      status: 'pending', ms: null, detail: '' },
      { id: 'sock_1',    label: 'Socket.IO conexión 1',         status: 'pending', ms: null, detail: '' },
      { id: 'sock_2',    label: 'Socket.IO conexión 2',         status: 'pending', ms: null, detail: '' },
      { id: 'sock_3',    label: 'Socket.IO conexión 3',         status: 'pending', ms: null, detail: '' },
      { id: 'sock_4',    label: 'Socket.IO conexión 4',         status: 'pending', ms: null, detail: '' },
      { id: 'sock_5',    label: 'Socket.IO conexión 5',         status: 'pending', ms: null, detail: '' },
      { id: 'burst_1',   label: 'Burst: /health x5 simultáneo', status: 'pending', ms: null, detail: '' },
      { id: 'burst_2',   label: 'Burst: Socket x5 simultáneo',  status: 'pending', ms: null, detail: '' },
    ];

    setResults(tests);

    // ── HTTP tests (secuencial para no saturar el browser) ────────────────────
    const httpIds = ['health_1','health_2','health_3','health_4','health_5'];
    for (const id of httpIds) {
      setResult(id, { status: 'running' });
      const r = await timed(async () => {
        const res = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(8000) });
        const d = await res.json();
        return `HTTP ${res.status} | waStatus: ${d.waStatus} | uptime: ${Math.round(d.uptime)}s`;
      });
      setResult(id, { status: r.ok ? 'ok' : 'error', ms: r.ms, detail: r.detail });
    }

    const statusIds = ['status_1','status_2','status_3'];
    for (const id of statusIds) {
      setResult(id, { status: 'running' });
      const r = await timed(async () => {
        const res = await fetch(`${BACKEND}/api/status`, { signal: AbortSignal.timeout(8000) });
        const d = await res.json();
        return `connected: ${d.connected} | waStatus: ${d.waStatus}`;
      });
      setResult(id, { status: r.ok ? 'ok' : 'error', ms: r.ms, detail: r.detail });
    }

    setResult('login_bad', { status: 'running' });
    const loginR = await timed(async () => {
      const res = await fetch(`${BACKEND}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'stress', password: 'test' }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401) return 'Auth funciona: 401 correctamente';
      throw new Error(`HTTP inesperado: ${res.status}`);
    });
    setResult('login_bad', { status: loginR.ok ? 'ok' : 'error', ms: loginR.ms, detail: loginR.detail });

    setResult('groups', { status: 'running' });
    const groupsR = await timed(async () => {
      const res = await fetch(`${BACKEND}/api/groups`, { signal: AbortSignal.timeout(8000) });
      const d = await res.json();
      if (res.status === 400) return `Endpoint responde: "${d.error}"`;
      if (res.ok) return `${d.groups?.length ?? 0} grupo(s)`;
      throw new Error(`HTTP ${res.status}`);
    });
    setResult('groups', { status: groupsR.ok ? 'ok' : 'error', ms: groupsR.ms, detail: groupsR.detail });

    // ── Socket tests (secuencial) ─────────────────────────────────────────────
    for (const id of ['sock_1','sock_2','sock_3','sock_4','sock_5']) {
      setResult(id, { status: 'running' });
      const r = await connectSocket();
      setResult(id, { status: r.ok ? 'ok' : 'error', ms: r.ms, detail: r.detail });
    }

    // ── Burst: 5 HTTP simultáneos ─────────────────────────────────────────────
    setResult('burst_1', { status: 'running' });
    {
      const start = performance.now();
      const reqs = Array.from({ length: 5 }, () =>
        fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false)
      );
      const results = await Promise.all(reqs);
      const ms = Math.round(performance.now() - start);
      const ok = results.filter(Boolean).length;
      setResult('burst_1', {
        status: ok === 5 ? 'ok' : ok > 0 ? 'error' : 'error',
        ms,
        detail: `${ok}/5 respondieron OK en paralelo`,
      });
    }

    // ── Burst: 5 sockets simultáneos ─────────────────────────────────────────
    setResult('burst_2', { status: 'running' });
    {
      const start = performance.now();
      const conns = Array.from({ length: 5 }, () => connectSocket());
      const results = await Promise.all(conns);
      const ms = Math.round(performance.now() - start);
      const ok = results.filter((r) => r.ok).length;
      const avgConn = Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length);
      setResult('burst_2', {
        status: ok >= 3 ? 'ok' : 'error',
        ms,
        detail: `${ok}/5 conectados | promedio conexión: ${avgConn}ms`,
      });
    }

    // ── Calcular resumen ──────────────────────────────────────────────────────
    setResults((prev) => {
      const finished = prev.filter((r) => r.ms !== null);
      const passed = finished.filter((r) => r.status === 'ok').length;
      const times = finished.map((r) => r.ms!);
      setSummary({
        total: finished.length,
        passed,
        failed: finished.length - passed,
        avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        maxMs: Math.max(...times),
        minMs: Math.min(...times),
      });
      return prev;
    });

    runningRef.current = false;
    setRunning(false);
  }

  useEffect(() => { runStress(); }, []);

  const statusColor = {
    ok: 'text-green-600 bg-green-50 border-green-100',
    error: 'text-red-500 bg-red-50 border-red-100',
    running: 'text-blue-500 bg-blue-50 border-blue-100',
    pending: 'text-gray-400 bg-gray-50 border-gray-100',
  };

  const statusIcon = { ok: '✓', error: '✗', running: '◌', pending: '○' };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Stress Test</h1>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{BACKEND}</p>
        </div>
        <button
          onClick={runStress}
          disabled={running}
          className="px-4 py-2 rounded-xl bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {running ? 'Ejecutando...' : 'Repetir'}
        </button>
      </div>

      {summary && (
        <div className={`rounded-2xl border p-4 mb-6 ${summary.failed === 0 ? 'bg-green-50 border-green-100' : summary.passed > summary.failed ? 'bg-yellow-50 border-yellow-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-2xl font-bold ${summary.failed === 0 ? 'text-green-600' : summary.passed > summary.failed ? 'text-yellow-600' : 'text-red-500'}`}>
              {summary.failed === 0 ? '✓' : summary.passed > summary.failed ? '⚠' : '✗'}
            </span>
            <div>
              <p className="font-semibold text-gray-800">
                {summary.failed === 0 ? 'Backend aguanta sin problemas' : summary.passed > summary.failed ? 'Backend parcialmente estable' : 'Backend inestable'}
              </p>
              <p className="text-xs text-gray-500">{summary.passed}/{summary.total} tests pasaron</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-white rounded-xl p-2 border border-gray-100">
              <p className="text-lg font-bold text-gray-800">{summary.avgMs}ms</p>
              <p className="text-xs text-gray-400">Promedio</p>
            </div>
            <div className="bg-white rounded-xl p-2 border border-gray-100">
              <p className="text-lg font-bold text-gray-800">{summary.minMs}ms</p>
              <p className="text-xs text-gray-400">Mínimo</p>
            </div>
            <div className="bg-white rounded-xl p-2 border border-gray-100">
              <p className="text-lg font-bold text-gray-800">{summary.maxMs}ms</p>
              <p className="text-xs text-gray-400">Máximo</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {results.map((r) => (
          <div key={r.id} className={`rounded-xl border px-4 py-3 ${statusColor[r.status]}`}>
            <div className="flex items-center gap-3">
              <span className={`text-base w-4 text-center ${r.status === 'running' ? 'animate-pulse' : ''}`}>
                {statusIcon[r.status]}
              </span>
              <span className="text-sm font-medium text-gray-800 flex-1">{r.label}</span>
              {r.ms !== null && (
                <span className={`text-xs font-mono font-bold ${r.ms < 500 ? 'text-green-600' : r.ms < 1500 ? 'text-yellow-600' : 'text-red-500'}`}>
                  {r.ms}ms
                </span>
              )}
              {r.status === 'running' && (
                <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            {r.detail && (
              <p className="text-xs font-mono text-gray-500 mt-1 ml-7 break-all">{r.detail}</p>
            )}
          </div>
        ))}
      </div>

      <p className="text-center mt-6">
        <a href="/test" className="text-xs text-gray-400 hover:text-gray-600 mr-4">← Tests normales</a>
        <a href="/" className="text-xs text-gray-400 hover:text-gray-600">← App</a>
      </p>
    </div>
  );
}
