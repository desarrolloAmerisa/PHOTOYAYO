import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '../../ThemeContext'

const API = 'http://localhost:8766'

const STATE_META_DARK = {
  idle:       { label: 'Esperando',     color: 'text-white/60 bg-white/10' },
  mirror:     { label: 'Espejo',        color: 'text-sky-300 bg-sky-500/15' },
  countdown:  { label: 'Cuenta atrás',  color: 'text-amber-300 bg-amber-500/15' },
  taking:     { label: 'Tomando fotos', color: 'text-pink-300 bg-pink-500/15' },
  waiting:    { label: 'Espera Espacio', color: 'text-violet-300 bg-violet-500/15' },
  preview:    { label: 'Vista previa',  color: 'text-emerald-300 bg-emerald-500/15' },
  connecting: { label: 'Conectando',    color: 'text-white/50 bg-white/10' },
}

const STATE_META_LIGHT = {
  idle:       { label: 'Esperando',     color: 'text-gray-700 bg-black/8' },
  mirror:     { label: 'Espejo',        color: 'text-sky-700 bg-sky-500/15' },
  countdown:  { label: 'Cuenta atrás',  color: 'text-amber-700 bg-amber-500/15' },
  taking:     { label: 'Tomando fotos', color: 'text-pink-700 bg-pink-500/15' },
  waiting:    { label: 'Espera Espacio', color: 'text-violet-700 bg-violet-500/15' },
  preview:    { label: 'Vista previa',  color: 'text-emerald-700 bg-emerald-500/15' },
  connecting: { label: 'Conectando',    color: 'text-gray-600 bg-black/8' },
}

function formatTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts * 1000).toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function LiveMonitor({
  camRef,
  appState,
  countdown,
  photoCount,
  totalPhotos,
  takenPhotos,
  strip,
  lastSession,
  activeEvent,
  activeId,
  printJob,
  captureMode = 'auto',
  onCaptureModeChange,
  testSession = false,
  cancelMsg = null,
  onStartSession,
  onStartTestSession,
  onCancelSession,
  onCancelPrint,
}) {
  const { t, isDark } = useTheme()
  const STATE_META = isDark ? STATE_META_DARK : STATE_META_LIGHT
  const [strips, setStrips]       = useState([])
  const [loading, setLoading]     = useState(false)
  const [selected, setSelected]   = useState(null)
  const [reprinting, setReprinting] = useState(false)
  const [reprintMsg, setReprintMsg] = useState(null)
  const [queueCount, setQueueCount] = useState(0)
  const [clearing, setClearing]     = useState(false)
  const [showHelp, setShowHelp]     = useState(false)

  const sessionActive = !['idle', 'mirror', 'connecting'].includes(appState)
  const canStart = !!activeId && (appState === 'idle' || appState === 'mirror' || appState === 'waiting')
  const canTest = !!activeId && (appState === 'idle' || appState === 'mirror')
  const isWaiting = appState === 'waiting'
  const meta = STATE_META[appState] || STATE_META.idle
  const slots = Math.max(1, totalPhotos || 3)
  const modeLocked = sessionActive

  const fetchStrips = useCallback(async () => {
    if (!activeId) { setStrips([]); return }
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/events/${encodeURIComponent(activeId)}/strips`)
      const j = await r.json()
      setStrips(j.strips || [])
    } catch {
      setStrips([])
    } finally {
      setLoading(false)
    }
  }, [activeId])

  useEffect(() => { fetchStrips() }, [fetchStrips])
  useEffect(() => {
    if (lastSession) fetchStrips()
  }, [lastSession, fetchStrips])

  const fetchQueue = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/print/queue`)
      const j = await r.json()
      setQueueCount(j.count ?? 0)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    fetchQueue()
    const t = setInterval(fetchQueue, 3000)
    return () => clearInterval(t)
  }, [fetchQueue, printJob?.phase])

  const handleClearQueue = async () => {
    if (clearing) return
    if (queueCount > 1 && !window.confirm(`¿Vaciar ${queueCount} trabajos de la cola?`)) return
    setClearing(true)
    try {
      await onCancelPrint?.()
      await fetchQueue()
    } finally {
      setClearing(false)
    }
  }

  const handleReprint = async (session) => {
    if (!activeId || reprinting) return
    setReprinting(true)
    setReprintMsg(null)
    try {
      const r = await fetch(`${API}/api/print`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ eventId: activeId, session }),
      })
      const j = await r.json()
      if (j.cancelled) setReprintMsg({ ok: false, text: 'Cancelado' })
      else if (j.ok)   setReprintMsg({ ok: true,  text: 'Enviada a imprimir' })
      else             setReprintMsg({ ok: false, text: j.error || j.msg || 'Error' })
    } catch {
      setReprintMsg({ ok: false, text: 'Sin conexión con el backend' })
    } finally {
      setReprinting(false)
      setTimeout(() => setReprintMsg(null), 4000)
    }
  }

  if (!activeId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
        <span className="text-5xl">📡</span>
        <p className={`font-bold text-lg ${t.text}`}>Sin evento activo</p>
        <p className={`text-sm text-center max-w-sm ${t.textMuted}`}>
          Activa un evento en la pestaña Eventos para ver la cámara, las fotos y las tiras en vivo.
        </p>
      </div>
    )
  }

  return (
    <div className="relative flex-1 flex min-h-0 overflow-hidden">
      {/* ── Cámara + controles ─────────────────────────────────────────── */}
      <div className={`w-[64%] min-w-[420px] flex flex-col border-r ${t.border} ${t.bgSidebar}`}>
        <div className={`px-3 py-2 border-b ${t.border} flex items-center justify-between gap-3`}>
          <div className="min-w-0">
            <p className={`text-[10px] uppercase tracking-widest font-bold ${t.textFaint}`}>En vivo</p>
            <div className="flex items-center gap-2 min-w-0">
              <p className={`text-sm font-bold truncate ${t.text}`}>{activeEvent?.name || activeId}</p>
              {testSession && sessionActive ? (
                <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide
                                 bg-amber-500 text-black">
                  Prueba
                </span>
              ) : (
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide
                                  ${t.bgCard} ${t.textFaint}`}>
                  Real
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className={`flex rounded-lg overflow-hidden border text-[11px] font-bold
                ${modeLocked ? 'opacity-55' : ''} ${t.borderMed}`}
              title={modeLocked ? 'No se puede cambiar durante la sesión' : 'Modo de captura'}
            >
              <button
                type="button"
                disabled={modeLocked}
                onClick={() => onCaptureModeChange?.('auto')}
                className={`px-2.5 py-1 transition-colors ${
                  captureMode === 'auto'
                    ? 'bg-pink-600 text-white'
                    : `${t.bgCard} ${t.textMuted} ${modeLocked ? '' : t.bgHover}`
                } ${modeLocked ? 'cursor-not-allowed' : ''}`}
              >
                Automático
              </button>
              <button
                type="button"
                disabled={modeLocked}
                onClick={() => onCaptureModeChange?.('manual')}
                className={`px-2.5 py-1 transition-colors ${
                  captureMode === 'manual'
                    ? 'bg-violet-600 text-white'
                    : `${t.bgCard} ${t.textMuted} ${modeLocked ? '' : t.bgHover}`
                } ${modeLocked ? 'cursor-not-allowed' : ''}`}
              >
                Manual
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold border
                         bg-sky-500/15 border-sky-400/40 text-sky-300
                         hover:bg-sky-500/25 transition-colors"
              title="Atajos y cómo usar la cabina"
            >
              ? Instrucciones
            </button>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${meta.color}`}>
              {meta.label}
            </span>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 bg-black">
          <img
            ref={camRef}
            alt="Cámara en vivo"
            className="absolute inset-0 w-full h-full object-contain"
          />
          {testSession && sessionActive && (
            <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none">
              <div className="mx-auto max-w-lg rounded-xl bg-amber-500 text-black px-4 py-2 text-center
                              shadow-lg shadow-amber-500/30">
                <p className="font-black text-sm uppercase tracking-widest">Sesión de prueba</p>
                <p className="text-[11px] font-semibold opacity-80">
                  No se guarda · no se imprime · no se sube
                </p>
              </div>
            </div>
          )}
          {(appState === 'countdown' || appState === 'taking') && countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-white font-black text-7xl drop-shadow-lg">{countdown}</span>
            </div>
          )}
          {isWaiting && (
            <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none">
              <div className={`mx-auto max-w-md rounded-xl bg-black/70 px-4 py-3 text-center border
                ${testSession ? 'border-amber-400/50' : 'border-violet-400/40'}`}>
                <p className={`font-bold text-sm ${testSession ? 'text-amber-200' : 'text-violet-200'}`}>
                  Foto {photoCount}/{slots} lista{testSession ? ' · prueba' : ''}
                </p>
                <p className="text-white/70 text-xs mt-0.5">
                  Espacio o ▶ para la siguiente ({activeEvent?.timerSecs ?? 3} s)
                </p>
              </div>
            </div>
          )}
          {printJob?.phase === 'printing' && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-pink-400 border-t-transparent animate-spin" />
              <p className="text-pink-200 font-bold text-sm">
                Imprimiendo{printJob.session ? ` tira ${printJob.session}` : ''}…
              </p>
              <button
                onClick={handleClearQueue}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold"
              >
                Cancelar y vaciar cola
              </button>
            </div>
          )}
        </div>

        <div className={`px-3 py-2.5 border-t ${t.border} flex items-center gap-2`}>
          <button
            onClick={onStartSession}
            disabled={!canStart}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-colors
              ${canStart
                ? isWaiting
                  ? 'bg-violet-600 hover:bg-violet-500 text-white'
                  : 'bg-gradient-to-r from-pink-600 to-[#CC0000] text-white hover:from-pink-500 hover:to-[#990000]'
                : `${t.bgCard} ${t.textFaint} cursor-not-allowed`}`}
          >
            {isWaiting
              ? `▶ Siguiente foto (${photoCount + 1}/${slots})`
              : '▶ Sesión real'}
          </button>
          <button
            onClick={onStartTestSession}
            disabled={!canTest}
            className={`px-3 py-3 rounded-xl text-xs font-bold transition-colors border
              ${canTest
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                : `${t.bgCard} ${t.textFaint} border-transparent cursor-not-allowed`}`}
            title="Prueba: preview sin guardar, imprimir ni subir (tecla P)"
          >
            🧪 Prueba
          </button>
          <button
            type="button"
            onClick={() => onCancelSession?.()}
            disabled={!sessionActive}
            className={`px-3 py-3 rounded-xl text-xs font-bold transition-colors border
              ${sessionActive
                ? 'bg-red-600/20 border-red-500/40 text-red-300 hover:bg-red-600/35'
                : `${t.bgCard} ${t.textFaint} border-transparent cursor-not-allowed`}`}
            title="Cancelar sesión y borrar fotos (tecla C)"
          >
            ✕ Cancelar
          </button>
          <button
            onClick={handleClearQueue}
            disabled={clearing}
            className={`px-3 py-3 rounded-xl text-xs font-bold transition-colors
              ${queueCount > 0
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : `${t.bgCard} ${t.textMuted} ${t.bgHover}`}`}
            title="Vacía todos los trabajos de la impresora"
          >
            {clearing ? 'Vaciando…' : queueCount > 0 ? `Vaciar cola (${queueCount})` : 'Vaciar cola'}
          </button>
          <div className={`text-right text-xs ${t.textMuted} min-w-[7.5rem]`}>
            <p className="font-mono font-bold">
              Foto {Math.min(photoCount, slots)} / {slots}
            </p>
            <p className={t.textFaint}>
              {cancelMsg
                ? cancelMsg
                : testSession && sessionActive
                  ? 'En prueba · C cancela'
                  : captureMode === 'manual'
                    ? 'Manual · C cancela'
                    : 'Espacio real · P prueba · C cancela'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Sesión + galería ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className={`px-4 py-3 border-b ${t.border} flex-shrink-0`}>
          <p className={`text-[10px] uppercase tracking-widest font-bold ${t.textFaint}`}>Sesión actual</p>
          <div className="mt-3 flex items-end gap-2 overflow-x-auto pb-1">
            {Array.from({ length: slots }).map((_, i) => (
              <div
                key={i}
                className={`h-28 w-20 flex-shrink-0 rounded-lg overflow-hidden border ${t.borderMed} ${t.bgCard}`}
              >
                {takenPhotos[i] ? (
                  <img
                    src={`data:image/jpeg;base64,${takenPhotos[i]}`}
                    alt={`Foto ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center text-xs ${t.textUltra}`}>
                    {i + 1}
                  </div>
                )}
              </div>
            ))}
            {strip && (
              <img
                src={`data:image/jpeg;base64,${strip}`}
                alt="Tira"
                className="h-28 w-auto rounded-lg border border-pink-500/40"
              />
            )}
          </div>
        </div>

        <div className={`px-4 py-3 border-b ${t.border} flex items-center justify-between flex-shrink-0`}>
          <div>
            <p className={`text-[10px] uppercase tracking-widest font-bold ${t.textFaint}`}>Tiras del evento</p>
            <p className={`text-xs ${t.textMuted}`}>{strips.length} guardada(s)</p>
          </div>
          <button
            onClick={fetchStrips}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${t.bgCard} ${t.textMuted} ${t.bgHover}`}
          >
            Actualizar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && strips.length === 0 ? (
            <div className="flex justify-center py-10">
              <div className="w-5 h-5 rounded-full border-2 border-pink-500/60 border-t-transparent animate-spin" />
            </div>
          ) : strips.length === 0 ? (
            <p className={`text-sm text-center py-10 ${t.textFaint}`}>
              Aún no hay tiras. Inicia una sesión para verlas aquí.
            </p>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {strips.map(s => (
                <button
                  key={s.session}
                  onClick={() => setSelected(s)}
                  className={`text-left rounded-xl overflow-hidden border transition-colors
                    ${selected?.session === s.session
                      ? 'border-pink-500/70'
                      : `${t.borderMed} ${t.bgHover}`}`}
                >
                  <img
                    src={`${API}/api/events/${encodeURIComponent(activeId)}/strips/${s.session}?thumb=1`}
                    alt={`Tira ${s.session}`}
                    className="w-full h-40 object-contain bg-black/40"
                  />
                  <div className="px-2.5 py-2">
                    <p className={`text-xs font-bold ${t.text}`}>Tira {s.session}</p>
                    <p className={`text-[10px] ${t.textFaint}`}>{formatTime(s.mtime)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button className="absolute inset-0 bg-black/70" onClick={() => setSelected(null)} />
            <motion.div
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              className={`relative z-10 w-full max-w-md rounded-2xl border ${t.borderMed} ${t.bgBar} p-4 shadow-2xl`}
            >
              <div className="flex items-center justify-between mb-3">
                <p className={`font-bold ${t.text}`}>Tira {selected.session}</p>
                <button onClick={() => setSelected(null)} className={`${t.textFaint} hover:${t.text}`}>×</button>
              </div>
              <img
                src={`${API}/api/events/${encodeURIComponent(activeId)}/strips/${selected.session}`}
                alt={`Tira ${selected.session}`}
                className="w-full max-h-[55vh] object-contain rounded-xl bg-black"
              />
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => handleReprint(selected.session)}
                  disabled={reprinting || printJob?.phase === 'printing'}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-[#CC0000]
                             text-white text-sm font-bold disabled:opacity-50"
                >
                  {reprinting ? 'Enviando…' : '🖨️ Reimprimir'}
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${t.bgCard} ${t.textMuted}`}
                >
                  Cerrar
                </button>
              </div>
              {reprintMsg && (
                <p className={`mt-2 text-xs font-semibold ${reprintMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {reprintMsg.text}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHelp && (
          <motion.div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
              aria-label="Cerrar"
              onClick={() => setShowHelp(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-title"
              className={`relative z-10 flex w-full max-w-lg max-h-[min(85vh,640px)] flex-col overflow-hidden
                          rounded-2xl border shadow-2xl ${t.borderMed} ${t.bgBar}`}
              initial={{ scale: 0.94, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 8, opacity: 0 }}
            >
              {/* Header fijo — la X siempre visible */}
              <div className={`flex-shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b ${t.border}`}>
                <div className="min-w-0">
                  <p id="help-title" className={`font-black text-lg ${t.text}`}>Instrucciones</p>
                  <p className={`text-xs mt-0.5 ${t.textFaint}`}>Atajos y flujo de la cabina</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className={`flex-shrink-0 w-9 h-9 rounded-lg text-xl leading-none font-bold
                              ${t.bgCard} ${t.textMuted} ${t.bgHover}`}
                  aria-label="Cerrar instrucciones"
                >
                  ×
                </button>
              </div>

              {/* Solo el contenido hace scroll */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
                <section className="mb-4">
                  <p className={`text-[10px] uppercase tracking-widest font-bold mb-2 ${t.textFaint}`}>
                    Teclas
                  </p>
                  <div className="space-y-2">
                    {[
                      { key: 'Espacio', desc: 'Inicia una sesión real. En modo Manual, también dispara la siguiente foto.' },
                      { key: 'P', desc: 'Inicia una sesión de prueba (solo preview: no guarda, no imprime, no sube).' },
                      { key: 'C', desc: 'Cancela la sesión en curso y borra las fotos/tira de esa sesión.' },
                      { key: 'D', desc: 'Activa/desactiva el modo debug de gestos (en la ventana de cabina).' },
                    ].map(row => (
                      <div key={row.key} className={`flex gap-3 items-start rounded-xl px-3 py-2.5 ${t.bgCard}`}>
                        <kbd className="flex-shrink-0 min-w-[4.5rem] text-center px-2 py-1 rounded-md text-xs font-black
                                        bg-pink-600/20 text-pink-300 border border-pink-500/30">
                          {row.key}
                        </kbd>
                        <p className={`text-sm leading-snug ${t.textMuted}`}>{row.desc}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mb-4">
                  <p className={`text-[10px] uppercase tracking-widest font-bold mb-2 ${t.textFaint}`}>
                    Cómo hacer una sesión
                  </p>
                  <ol className={`list-decimal list-inside space-y-1.5 text-sm ${t.textMuted}`}>
                    <li>Activa un evento en la pestaña Eventos.</li>
                    <li>Elige <span className={t.text}>Automático</span> o <span className={t.text}>Manual</span> (solo antes de empezar).</li>
                    <li>Pulsa <span className={t.text}>Sesión real</span> o <kbd className="px-1 rounded bg-white/10 text-xs">Espacio</kbd>.</li>
                    <li>En automático la cabina toma todas las fotos sola.</li>
                    <li>En manual: cuenta del temporizador del evento → foto → espera → <kbd className="px-1 rounded bg-white/10 text-xs">Espacio</kbd> otra vez, hasta completar.</li>
                    <li>Al final ves la tira; en sesión real se imprime y se sube al ingest si hay URL.</li>
                  </ol>
                </section>

                <section className="mb-4">
                  <p className={`text-[10px] uppercase tracking-widest font-bold mb-2 ${t.textFaint}`}>
                    Sesión de prueba
                  </p>
                  <p className={`text-sm leading-relaxed ${t.textMuted}`}>
                    Usa el botón <span className="text-amber-300 font-bold">🧪 Prueba</span> o la tecla{' '}
                    <kbd className="px-1 rounded bg-amber-500/20 text-amber-300 text-xs">P</kbd>.
                    Sirve para revisar marco/plantilla sin ensuciar el evento ni mandar a imprimir.
                    Cuando termina, <span className={t.text}>Sesión real</span> / Espacio vuelve a ser normal.
                  </p>
                </section>

                <section>
                  <p className={`text-[10px] uppercase tracking-widest font-bold mb-2 ${t.textFaint}`}>
                    Badges
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 rounded-md font-black uppercase bg-amber-500 text-black">Prueba</span>
                    <span className={`px-2 py-1 rounded-md font-bold uppercase ${t.bgCard} ${t.textFaint}`}>Real</span>
                    <span className="px-2 py-1 rounded-full font-bold text-violet-300 bg-violet-500/15">Espera Espacio</span>
                  </div>
                </section>
              </div>

              {/* Footer fijo */}
              <div className={`flex-shrink-0 px-5 pt-3 pb-5 border-t ${t.border}`}>
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className="w-full py-2.5 rounded-xl text-sm font-bold
                             bg-gradient-to-r from-pink-600 to-[#CC0000] text-white"
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
