import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import EventList    from './components/admin/EventList'
import EventEditor  from './components/admin/EventEditor'
import HardwareSetup from './components/admin/HardwareSetup'
import PrintConfig  from './components/admin/PrintConfig'
import TemplateList from './components/admin/TemplateList'
import TemplateEditor from './components/admin/TemplateEditor'
import LiveMonitor  from './components/admin/LiveMonitor'
import { ThemeProvider, useTheme } from './ThemeContext'
import DebugPanel  from './components/DebugPanel'
import { useWebSocket } from './hooks/useWebSocket'

const WS_URL = 'ws://localhost:8765'

const API = 'http://localhost:8766'

// ── Wrapper que provee el tema ────────────────────────────────────────────────
export default function AdminApp() {
  return (
    <ThemeProvider>
      <AdminAppInner />
    </ThemeProvider>
  )
}

// ── Ítem del checklist de configuración ──────────────────────────────────────
function CheckItem({ ok, label, onFix }) {
  const { isDark } = useTheme()
  return (
    <button
      onClick={!ok ? onFix : undefined}
      className={`flex items-center gap-1.5 text-xs font-semibold transition-colors
        ${ok
          ? (isDark ? 'text-emerald-400 cursor-default' : 'text-emerald-700 cursor-default')
          : (isDark
            ? 'text-amber-300 hover:text-white underline underline-offset-2'
            : 'text-amber-700 hover:text-gray-900 underline underline-offset-2')}`}
    >
      <span>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
      {!ok && (
        <span className={`font-normal no-underline ${isDark ? 'text-amber-400/60' : 'text-amber-700/70'}`}>
          (configurar →)
        </span>
      )}
    </button>
  )
}

function AdminAppInner() {
  const { t, isDark, toggle } = useTheme()
  const [events,     setEvents]     = useState([])
  const [activeId,   setActiveId]   = useState(null)
  const [selectedId, setSelectedId] = useState(null)  // null = modo "nuevo"
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('live')  // 'live' | 'events' | 'hardware' | 'print' | 'templates'

  // ── Estado de hardware (para el checklist) ────────────────────────────────
  const [hwConfig, setHwConfig] = useState({ camera: null, printer: null, loaded: false })
  // ── Plantillas ─────────────────────────────────────
  const [templates,    setTemplates]    = useState([])
  const [tplLoading,   setTplLoading]   = useState(false)
  const [selectedTplId, setSelectedTplId] = useState(null)  // id plantilla en editor
  const [creatingTpl,  setCreatingTpl]  = useState(false)   // mostrar formulario "nueva plantilla"

  const fetchTemplates = useCallback(async () => {
    setTplLoading(true)
    try {
      const r = await fetch(`${API}/api/templates`)
      const j = await r.json()
      setTemplates(j.templates || [])
    } catch {
      setTemplates([])
    } finally {
      setTplLoading(false)
    }
  }, [])
  const fetchHardware = useCallback(async () => {
    try {
      const [cR, pR] = await Promise.all([
        fetch(`${API}/api/cameras`),
        fetch(`${API}/api/printers`),
      ])
      const cJ = await cR.json()
      const pJ = await pR.json()
      setHwConfig({
        camera:  cJ.current ?? null,
        printer: pJ.current ?? null,
        loaded:  true,
      })
    } catch {
      setHwConfig(h => ({ ...h, loaded: true }))
    }
  }, [])

  // ── Debug panel ────────────────────────────────────────────────────
  const [showDebug,  setShowDebug]  = useState(false)
  const [dbGesture,  setDbGesture]  = useState({ handDetected:false, palm:false, peace:false })
  const [dbState,    setDbState]    = useState('idle')

  // ── Estado de impresión (broadcast WS) ──────────────────────────────
  const [printJob,   setPrintJob]   = useState(null)   // null | { phase, printer, copies, msg }
  const printTimerRef = useRef(null)
  const camRef = useRef(null)

  // ── Monitor en vivo ─────────────────────────────────────────────────
  const [liveCountdown,   setLiveCountdown]   = useState(0)
  const [livePhotoCount,  setLivePhotoCount]  = useState(0)
  const [liveTotalPhotos, setLiveTotalPhotos] = useState(3)
  const [livePhotos,      setLivePhotos]      = useState([])
  const [liveStrip,       setLiveStrip]       = useState(null)
  const [liveSession,     setLiveSession]     = useState(null)
  const [liveEvent,       setLiveEvent]       = useState(null)

  const sendWs = useWebSocket(WS_URL, useCallback((msg) => {
    if (msg.type === 'frame') {
      if (camRef.current && msg.data)
        camRef.current.src = `data:image/jpeg;base64,${msg.data}`
      if (msg.gesture)  setDbGesture(msg.gesture)
      if (msg.debugMode !== undefined) setShowDebug(msg.debugMode)
    }
    if (msg.type === 'state') {
      setDbState(msg.state)
      if (msg.totalPhotos !== undefined) setLiveTotalPhotos(msg.totalPhotos)
      if (msg.photoCount  !== undefined) setLivePhotoCount(msg.photoCount)
      if (msg.session     !== undefined) setLiveSession(msg.session)
      if (msg.state === 'idle')      { setLiveStrip(null); setLivePhotoCount(0); setLivePhotos([]) }
      if (msg.state === 'countdown') { setLivePhotos([]); setLiveStrip(null) }
    }
    if (msg.type === 'countdown') {
      if (msg.value !== undefined) setLiveCountdown(msg.value)
    }
    if (msg.type === 'flash') {
      setLivePhotoCount(msg.photoNum)
      if (msg.photo) setLivePhotos(prev => [...prev, msg.photo])
    }
    if (msg.type === 'strip') {
      setLiveStrip(msg.data)
      if (msg.session !== undefined) setLiveSession(msg.session)
    }
    if (msg.type === 'init') {
      setDbState(msg.state || 'idle')
      setShowDebug(msg.debug || false)
      setLiveEvent(msg.activeEvent || null)
      if (msg.activeId !== undefined) setActiveId(msg.activeId || null)
      setLiveTotalPhotos(msg.activeEvent?.photoCount ?? 3)
    }
    if (msg.type === 'active_event') {
      setLiveEvent(msg.activeEvent || null)
      setActiveId(msg.activeId || null)
      setLiveTotalPhotos(msg.activeEvent?.photoCount ?? 3)
    }
    if (msg.type === 'print_start') {
      clearTimeout(printTimerRef.current)
      setPrintJob({
        phase: 'printing',
        printer: msg.printer,
        copies: msg.copies,
        session: msg.session,
      })
      printTimerRef.current = setTimeout(() => {
        setPrintJob(prev => prev?.phase === 'printing'
          ? { ...prev, phase: 'err', msg: 'Sin respuesta de la impresora (timeout)' }
          : prev
        )
      }, 20000)
    }
    if (msg.type === 'print_done') {
      clearTimeout(printTimerRef.current)
      const phase = msg.cancelled ? 'cancelled' : (msg.ok ? 'ok' : 'err')
      setPrintJob(prev => prev ? { ...prev, phase, msg: msg.msg } : {
        phase, printer: msg.printer, copies: msg.copies, msg: msg.msg, session: msg.session,
      })
      if (phase !== 'err') {
        printTimerRef.current = setTimeout(() => setPrintJob(null), 5000)
      }
    }
  }, []))

  const toggleDebug = () => sendWs({ type: 'toggle_debug' })
  const startSession = () => {
    if (dbState === 'idle' || dbState === 'mirror') sendWs({ type: 'start_session' })
  }
  const cancelPrint = async () => {
    try {
      await fetch(`${API}/api/print/cancel`, { method: 'POST' })
    } catch { /* el toast se actualiza por WS */ }
  }

  // Espacio también inicia sesión desde el panel admin (sin ir a la ventana de cámara)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return
      e.preventDefault()
      if (dbState === 'idle' || dbState === 'mirror') {
        sendWs({ type: 'start_session' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dbState, sendWs])

  // ── Cargar eventos al montar ──────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    try {
      const r    = await fetch(`${API}/api/events`)
      const data = await r.json()
      setEvents(data.events || [])
      setActiveId(data.activeId || null)
    } catch {
      setError('No se puede conectar con el backend (puerto 8766)')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => { fetchHardware() }, [fetchHardware])
  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  // ── Callbacks del editor ──────────────────────────────────────────────────
  const handleSaved = (updatedEvent, previousId) => {
    setEvents(prev => {
      const key = previousId || updatedEvent.id
      const idx = prev.findIndex(e => e.id === key || e.id === updatedEvent.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = updatedEvent
        return next
      }
      return [...prev, updatedEvent]
    })
    setSelectedId(updatedEvent.id)
    if (previousId && activeId === previousId) setActiveId(updatedEvent.id)
  }

  const handleDeleted = (id) => {
    setEvents(prev => prev.filter(e => e.id !== id))
    setSelectedId(null)
    if (activeId === id) setActiveId(null)
  }

  const handleActivated = (id) => {
    setActiveId(id)
    setHwConfig(h => ({ ...h }))  // fuerza re-render del checklist
  }

  const selectedEvent = selectedId
    ? events.find(e => e.id === selectedId) ?? null
    : null

  return (
    <div className={`w-screen h-screen flex flex-col overflow-hidden transition-colors duration-300 ${t.bgApp}`}>
      {/* ── Barra superior ──────────────────────────────────────────────── */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${t.border}
                      ${t.bgBar} flex-shrink-0`} style={{ WebkitAppRegion: 'drag' }}>
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
          <span className={`font-black text-base tracking-wider ${t.text}`}>⚙️ ADMIN</span>
          <span className={`text-xs font-mono ${t.textFaint}`}>Photobooth ECA 360</span>
        </div>

        {/* Indicador de conexión */}
        <div className={`flex items-center gap-2 text-xs ${t.textFaint}`}>
          <span className={`w-2 h-2 rounded-full ${error ? 'bg-red-500' : 'bg-green-400'}`} />
          {error ? 'Sin conexión' : 'Backend conectado'}
        </div>

        {/* Controles de ventana + toggle tema */}
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
          <button
            onClick={() => window.electronBridge?.returnToLauncher?.()}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold
                        transition-colors border ${t.borderMed} ${t.bgCard} ${t.text} ${t.bgHover}`}
            title="Volver al menú de selección"
          >
            ← Menú
          </button>
          {/* Botón debug */}
          <button
            onClick={toggleDebug}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                        transition-colors border ${t.borderMed} ${
                          showDebug
                            ? 'bg-green-500/20 text-green-400 border-green-500/40'
                            : `${t.bgCard} ${t.textMuted} ${t.bgHover}`
                        }`}
            title="Activar/desactivar panel de debug"
          >
            {showDebug ? '🟢 Debug ON' : '⚫ Debug'}
          </button>
          {/* Botón modo claro/oscuro */}
          <button
            onClick={toggle}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                        transition-colors border ${t.borderMed} ${t.bgCard} ${t.textMuted}
                        ${t.bgHover}`}
            title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {isDark ? '☀️ Claro' : '🌙 Oscuro'}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => window.electronBridge?.minimizeWindow()}
              className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400 transition-colors"
            />
            <button
              onClick={() => window.electronBridge?.maximizeWindow()}
              className="w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 transition-colors"
            />
            <button
              onClick={() => window.electronBridge?.closeWindow()}
              className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* ── Cuerpo principal ────────────────────────────────────────────── */}
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-red-400 font-semibold text-lg">⚠️ {error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); fetchEvents() }}
            className={`px-5 py-2 rounded-xl ${t.bgCard} ${t.bgHover}
                       ${t.textMuted} hover:${t.text} text-sm transition-colors`}
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden flex-col">

          {/* ── Checklist de configuración ── */}
          <AnimatePresence>
            {hwConfig.loaded && (!activeId || hwConfig.camera === null || hwConfig.printer === null) && (
              <motion.div
                key="checklist"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex-shrink-0 overflow-hidden"
              >
                <div className={`mx-4 mt-3 px-4 py-3 rounded-xl border
                                 bg-amber-500/10 border-amber-500/30 flex flex-wrap items-center gap-x-6 gap-y-2`}>
                  <span className="text-amber-400 font-bold text-sm">⚠️ Antes de usar el photobooth:</span>
                  {/* Evento */}
                  <CheckItem ok={!!activeId} label="Evento activo" onFix={() => setActiveTab('events')} />
                  {/* Cámara */}
                  <CheckItem
                    ok={hwConfig.camera !== null}
                    label="Cámara configurada"
                    onFix={() => setActiveTab('hardware')}
                  />
                  {/* Impresora */}
                  <CheckItem
                    ok={hwConfig.printer !== null}
                    label="Impresora configurada"
                    onFix={() => setActiveTab('hardware')}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Notificación de fallback (barra espaciadora) ── */}
          <AnimatePresence>
            {activeId && (
              <motion.div
                key="spacebar-hint"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex-shrink-0 overflow-hidden"
              >
                <div className={`mx-4 mt-3 px-4 py-3 rounded-xl border
                                 bg-blue-500/10 border-blue-500/30 flex items-center gap-3`}>
                  <span className="text-blue-400 font-semibold text-sm">💡 Fallback:</span>
                  <span className="text-blue-300/80 text-sm">Usa <span className="font-semibold">Iniciar sesión</span> en En vivo, o la <span className="font-mono font-bold">BARRA ESPACIADORA</span></span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Tabs ── */}
          <div className={`flex items-center gap-1 px-4 pt-3 pb-0 flex-shrink-0 border-b ${t.border}`}>
            {[
              { id: 'live',      label: '📡 En vivo'    },
              { id: 'events',    label: '📋 Eventos'    },
              { id: 'hardware',  label: '⚙️ Hardware'   },
              { id: 'print',     label: '🖨️ Impresión' },
              { id: 'templates', label: '📐 Plantillas' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all border-b-2
                  ${activeTab === tab.id
                    ? `${t.text} border-pink-500`
                    : `${t.textMuted} border-transparent ${t.bgHover}`}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              {activeTab === 'live' ? (
                <motion.div
                  key="live-tab"
                  className="flex flex-1 overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <LiveMonitor
                    camRef={camRef}
                    appState={dbState}
                    countdown={liveCountdown}
                    photoCount={livePhotoCount}
                    totalPhotos={liveTotalPhotos}
                    takenPhotos={livePhotos}
                    strip={liveStrip}
                    lastSession={liveSession}
                    activeEvent={liveEvent || events.find(e => e.id === activeId) || null}
                    activeId={activeId}
                    printJob={printJob}
                    onStartSession={startSession}
                    onCancelPrint={cancelPrint}
                  />
                </motion.div>
              ) : activeTab === 'events' ? (
                <motion.div
                  key="events-tab"
                  className="flex flex-1 overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {/* Sidebar */}
                  <EventList
                    events={events}
                    activeId={activeId}
                    selectedId={selectedId}
                    loading={loading}
                    onSelect={setSelectedId}
                    onCreate={() => setSelectedId(null)}
                  />

                  {/* Panel editor */}
                  <div className="flex-1 overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={selectedId ?? '__new__'}
                        className="h-full"
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0  }}
                        exit={{    opacity: 0, x: -8 }}
                        transition={{ duration: 0.18 }}
                      >
                        <EventEditor
                          event={selectedEvent}
                          activeId={activeId}
                          onSaved={handleSaved}
                          onDeleted={handleDeleted}
                          onActivated={handleActivated}
                          templates={templates}
                        />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </motion.div>
              ) : activeTab === 'hardware' ? (
                <motion.div
                  key="hardware-tab"
                  className="flex-1 overflow-y-auto p-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <HardwareSetup
                    onSaved={(data) => setHwConfig(h => ({
                      ...h,
                      ...(data.camera  !== undefined ? { camera:  data.camera  } : {}),
                      ...(data.printer !== undefined ? { printer: data.printer } : {}),
                    }))}
                  />
                </motion.div>
              ) : activeTab === 'print' ? (
                <motion.div
                  key="print-tab"
                  className="flex-1 overflow-y-auto p-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <PrintConfig />
                </motion.div>
              ) : (
                <motion.div
                  key="templates-tab"
                  className="flex flex-1 overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <TemplateList
                    templates={templates}
                    loading={tplLoading}
                    selectedId={selectedTplId}
                    onSelect={id => { setSelectedTplId(id); setCreatingTpl(false) }}
                    onCreate={() => { setSelectedTplId(null); setCreatingTpl(true) }}
                  />
                  {creatingTpl ? (
                    <TemplateEditor.NewPanel
                      onCreate={tpl => {
                        setTemplates(prev => [...prev, tpl])
                        setSelectedTplId(tpl.id)
                        setCreatingTpl(false)
                      }}
                    />
                  ) : selectedTplId ? (
                    <TemplateEditor
                      template={templates.find(t => t.id === selectedTplId)}
                      onSaved={tpl => setTemplates(prev => prev.map(t => t.id === tpl.id ? tpl : t))}
                      onDeleted={id => {
                        setTemplates(prev => prev.filter(t => t.id !== id))
                        setSelectedTplId(null)
                      }}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className={`text-sm ${t.textFaint}`}>Selecciona una plantilla o crea una nueva</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}      {/* ── Toast técnico de impresión ───────────────────────────────── */}
      <AnimatePresence>
        {printJob && (
          <motion.div
            key="admin-print-toast"
            className="fixed bottom-4 right-4 z-[60] min-w-[280px] max-w-xs"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: 16, scale: 0.95  }}
            transition={{ type: 'spring', damping: 22, stiffness: 200 }}
          >
            <div className={`rounded-2xl border shadow-2xl p-4 flex items-start gap-3
              ${
                printJob.phase === 'printing'  ? `bg-[#18181b] border-pink-500/40` :
                printJob.phase === 'ok'        ? `bg-[#18181b] border-emerald-500/40` :
                printJob.phase === 'cancelled' ? `bg-[#18181b] border-amber-500/40` :
                                                 `bg-[#18181b] border-red-500/40`
              }`}>
              {/* Icono / spinner */}
              <div className="mt-0.5 flex-shrink-0">
                {printJob.phase === 'printing' ? (
                  <motion.div
                    className="w-5 h-5 rounded-full border-2 border-pink-400 border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                  />
                ) : printJob.phase === 'ok' ? (
                  <span className="text-emerald-400 text-lg">✓</span>
                ) : printJob.phase === 'cancelled' ? (
                  <span className="text-amber-300 text-lg">✋</span>
                ) : (
                  <span className="text-red-400 text-lg">✗</span>
                )}
              </div>
              {/* Texto */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold ${
                  printJob.phase === 'printing'  ? 'text-pink-300' :
                  printJob.phase === 'ok'        ? 'text-emerald-300' :
                  printJob.phase === 'cancelled' ? 'text-amber-300' : 'text-red-400'
                }`}>
                  {printJob.phase === 'printing'  ? `🖨️ Imprimiendo${printJob.session ? ` tira ${printJob.session}` : ''}…` :
                   printJob.phase === 'ok'        ? '🖨️ Trabajo enviado' :
                   printJob.phase === 'cancelled' ? '🖨️ Impresión cancelada' : '🖨️ Error de impresión'}
                </p>
                <p className="text-xs text-white/40 mt-0.5 truncate">{printJob.printer}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs text-white/30 font-mono">
                    {printJob.copies} {printJob.copies === 1 ? 'copia' : 'copias'}
                  </span>
                  {printJob.msg && printJob.phase !== 'printing' && (
                    <span className={`text-xs font-medium ${
                      printJob.phase === 'ok' ? 'text-emerald-400/70' :
                      printJob.phase === 'cancelled' ? 'text-amber-400/70' : 'text-red-400/70'
                    }`}>{printJob.msg}</span>
                  )}
                </div>
                {printJob.phase === 'printing' && (
                  <button
                    onClick={cancelPrint}
                    className="mt-2 w-full py-1.5 rounded-lg bg-red-600/90 hover:bg-red-500
                               text-white text-xs font-bold"
                  >
                    Cancelar y vaciar cola
                  </button>
                )}
              </div>
              {/* Cerrar */}
              <button
                onClick={() => setPrintJob(null)}
                className="text-white/20 hover:text-white/50 text-base leading-none transition-colors flex-shrink-0"
              >×</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ── Debug panel flotante ──────────────────────────────────────── */}
      <AnimatePresence>
        {showDebug && (
          <DebugPanel
            key="admin-debug"
            gesture={dbGesture}
            appState={dbState}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
