'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

type Status = 'loading' | 'qr' | 'authenticated' | 'ready' | 'disconnected';

type ProgressItem = {
  index: number;
  total: number;
  number: string;
  status: 'sent' | 'error';
};

type Group = {
  id: string;
  name: string;
  memberCount: number;
};

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

export default function Home() {
  const [status, setStatus] = useState<Status>('loading');
  const [qr, setQr] = useState('');
  const [numbers, setNumbers] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [done, setDone] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [importingGroup, setImportingGroup] = useState<string | null>(null);
  const [showGroups, setShowGroups] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = io(BACKEND);
    socketRef.current = socket;

    socket.on('status', (s: Status) => setStatus(s));
    socket.on('qr', (q: string) => setQr(q));
    socket.on('progress', (p: ProgressItem) => {
      setProgress((prev) => [...prev, p]);
      setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
    });
    socket.on('done', () => {
      setSending(false);
      setDone(true);
    });

    return () => { socket.disconnect(); };
  }, []);

  const numberList = numbers
    .split('\n')
    .map((n) => n.trim().replace(/\s/g, ''))
    .filter((n) => n.length > 0);

  const handleSend = async () => {
    if (!numberList.length || !message.trim() || sending) return;
    setSending(true);
    setDone(false);
    setProgress([]);

    await fetch(`${BACKEND}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: numberList, message: message.trim() }),
    });
  };

  const handleReset = () => {
    setProgress([]);
    setDone(false);
    setSending(false);
  };

  const handleLoadGroups = async () => {
    setLoadingGroups(true);
    setShowGroups(true);
    try {
      const res = await fetch(`${BACKEND}/api/groups`);
      const data = await res.json();
      setGroups(data.groups ?? []);
    } catch {
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleImportGroup = async (groupId: string) => {
    setImportingGroup(groupId);
    try {
      const res = await fetch(`${BACKEND}/api/groups/${encodeURIComponent(groupId)}/members`);
      const data = await res.json();
      if (data.numbers?.length) {
        setNumbers((prev) => {
          const existing = new Set(
            prev.split('\n').map((n) => n.trim()).filter(Boolean)
          );
          const incoming = (data.numbers as string[]).filter((n) => !existing.has(n));
          const merged = [...existing, ...incoming].join('\n');
          return merged;
        });
      }
    } finally {
      setImportingGroup(null);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Iniciando WhatsApp...</p>
        </div>
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-3 h-3 rounded-full bg-red-500 mx-auto mb-4" />
          <p className="text-gray-700 font-medium">Desconectado</p>
          <p className="text-gray-400 text-sm mt-1">Reconectando...</p>
        </div>
      </div>
    );
  }

  if (status === 'qr' || status === 'authenticated') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">SendWave</h1>
          <p className="text-gray-500 text-sm mb-6">
            {status === 'authenticated'
              ? 'Autenticado, cargando...'
              : 'Abre WhatsApp en tu celular y escanea el código QR'}
          </p>
          {status === 'qr' && qr && (
            <div className="inline-block p-4 bg-white rounded-2xl shadow-md border">
              <QRCodeSVG value={qr} size={240} />
            </div>
          )}
          {status === 'authenticated' && (
            <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
          )}
        </div>
      </div>
    );
  }

  const sentCount = progress.filter((p) => p.status === 'sent').length;
  const errorCount = progress.filter((p) => p.status === 'error').length;
  const total = progress[progress.length - 1]?.total ?? numberList.length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-800">SendWave</h1>
        <span className="flex items-center gap-2 text-sm text-green-600 font-medium">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          WhatsApp conectado
        </span>
      </div>

      {/* Sección de grupos */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Mis grupos de WhatsApp</h2>
          <button
            onClick={handleLoadGroups}
            disabled={loadingGroups}
            className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium hover:bg-green-100 disabled:opacity-50 transition-colors"
          >
            {loadingGroups ? 'Cargando...' : 'Cargar grupos'}
          </button>
        </div>

        {showGroups && (
          <>
            {loadingGroups && (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <div className="w-3.5 h-3.5 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                Obteniendo grupos...
              </div>
            )}

            {!loadingGroups && groups.length === 0 && (
              <p className="text-xs text-gray-400 py-2">No se encontraron grupos.</p>
            )}

            {!loadingGroups && groups.length > 0 && (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{g.name}</p>
                      <p className="text-xs text-gray-400">{g.memberCount} miembro(s)</p>
                    </div>
                    <button
                      onClick={() => handleImportGroup(g.id)}
                      disabled={importingGroup === g.id || sending}
                      className="ml-3 shrink-0 text-xs px-3 py-1.5 rounded-lg bg-green-500 text-white font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                      {importingGroup === g.id ? 'Importando...' : 'Importar números'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Formulario de envío */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">
              Numeros de telefono
              <span className="text-gray-400 font-normal ml-1">(uno por linea, con codigo de pais)</span>
            </label>
            {numberList.length > 0 && (
              <button
                onClick={() => setNumbers('')}
                disabled={sending}
                className="text-xs text-gray-400 hover:text-red-400 transition-colors"
              >
                Limpiar
              </button>
            )}
          </div>
          <textarea
            className="w-full h-36 rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            placeholder={"51987654321\n51912345678\n51999888777"}
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            disabled={sending}
          />
          {numberList.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">{numberList.length} numero(s) detectado(s)</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje</label>
          <textarea
            className="w-full h-28 rounded-xl border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            placeholder="Escribe tu mensaje aqui..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={sending}
          />
          {message.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">{message.length} caracteres</p>
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={sending || !numberList.length || !message.trim()}
          className="w-full py-3 rounded-xl bg-green-500 text-white font-semibold text-sm hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? `Enviando... (${progress.length}/${total})` : `Enviar a ${numberList.length} numero(s)`}
        </button>
      </div>

      {(progress.length > 0 || done) && (
        <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Registro de envio</h2>
            <div className="flex gap-3 text-xs">
              <span className="text-green-600 font-medium">{sentCount} enviados</span>
              {errorCount > 0 && (
                <span className="text-red-500 font-medium">{errorCount} errores</span>
              )}
            </div>
          </div>

          {sending && progress.length > 0 && (
            <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(progress.length / total) * 100}%` }}
              />
            </div>
          )}

          <div
            ref={logRef}
            className="space-y-1 max-h-52 overflow-y-auto text-xs font-mono"
          >
            {progress.map((p, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-2 py-1 rounded-lg ${
                  p.status === 'sent' ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'
                }`}
              >
                <span>{p.status === 'sent' ? '✓' : '✗'}</span>
                <span>+{p.number}</span>
                <span className="text-gray-400 ml-auto">{p.index}/{p.total}</span>
              </div>
            ))}
          </div>

          {done && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Envio completado — {sentCount} de {total} mensajes enviados
              </p>
              <button
                onClick={handleReset}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
