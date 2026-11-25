import { useState, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useWebSocket }     from './hooks/useWebSocket'
import VideoFeed            from './components/VideoFeed'
import IdleOverlay          from './components/IdleOverlay'
import CountdownOverlay     from './components/CountdownOverlay'
import TakingOverlay        from './components/TakingOverlay'
import StripBuilder         from './components/StripBuilder'
import StripPreview         from './components/StripPreview'
import MirrorControls       from './components/MirrorControls'

export default function App() {
  // ── Video (ref directo, sin React state) ────────────────────────────────
  const imgRef      = useRef(null)
  const flashTimer  = useRef(null)

  // ── App state ────────────────────────────────────────────────────────────
  const [connected,   setConnected]   = useState(false)
  const [appState,    setAppState]    = useState('connecting')
  const [countdown,   setCountdown]   = useState(3)
  const [photoNum,    setPhotoNum]    = useState(1)
  const [photoCount,  setPhotoCount]  = useState(0)
  const [totalPhotos,  setTotalPhotos]  = useState(3)

  // ── Gestos ───────────────────────────────────────────────────────────────
  const [palmProgress, setPalmProgress] = useState(0)

  // ── Extras ───────────────────────────────────────────────────────────────
  const [flash,        setFlash]        = useState(false)
  const [strip,        setStrip]        = useState(null)
  const [debug,        setDebug]        = useState(false)
  const [activeEvent,  setActiveEvent]  = useState(null)
  const [takenPhotos,  setTakenPhotos]  = useState([])  // fotos b64 por slot
  const [printJob,     setPrintJob]     = useState(null) // null | { phase, printer, copies }
  const printTimerRef  = useRef(null)
  const [ingestMsg,    setIngestMsg]    = useState(null) // { phase, file, msg }
  const ingestTimerRef = useRef(null)
  const [testSession,  setTestSession]  = useState(false)
  const [captureMode,  setCaptureMode]  = useState('auto') // 'auto' | 'manual'
  const [cancelToast,  setCancelToast]  = useState(null)
  const cancelToastRef = useRef(null)

  // ── Handler WebSocket ────────────────────────────────────────────────────
  const handleMessage = useCallback((msg) => {
    switch (msg.type) {

      case 'init':
        setConnected(true)
        setAppState(msg.state || 'idle')
        setDebug(msg.debug || false)
        setActiveEvent(msg.activeEvent || null)
        setTotalPhotos(msg.totalPhotos ?? msg.activeEvent?.photoCount ?? 3)
        if (msg.captureMode) setCaptureMode(msg.captureMode)
        if (msg.photoCount !== undefined) setPhotoCount(msg.photoCount)
        if (msg.test !== undefined) setTestSession(!!msg.test)
        break

      case 'active_event':
        setActiveEvent(msg.activeEvent || null)
        setTotalPhotos(msg.activeEvent?.photoCount ?? 3)
        break

      case 'capture_mode':
        if (msg.mode) setCaptureMode(msg.mode)
        break

      case 'frame':
        // Direct DOM update → no re-render en 30fps
        if (imgRef.current && msg.data)
          imgRef.current.src = `data:image/jpeg;base64,${msg.data}`

        if (msg.palmProgress !== undefined) setPalmProgress(msg.palmProgress)

        if (msg.flash) {
          setFlash(true)
          clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setFlash(false), 280)
        }
        break

      case 'state':
        setAppState(msg.state)
        if (msg.totalPhotos !== undefined) setTotalPhotos(msg.totalPhotos)
        if (msg.photoCount  !== undefined) setPhotoCount(msg.photoCount)
        if (msg.test !== undefined) setTestSession(!!msg.test)
        if (msg.captureMode !== undefined) setCaptureMode(msg.captureMode)
        if (msg.state === 'idle') {
          setStrip(null)
          setPhotoCount(0)
          setTakenPhotos([])
          setTestSession(false)
        }
        // Solo resetear thumbs al arrancar sesión (foto 0), no al reanudar manual
        if (msg.state === 'countdown' && !msg.photoCount) {
          setTakenPhotos([])
        }
        break

      case 'countdown':
        setCountdown(msg.value)
        if (msg.photoNum !== undefined) setPhotoNum(msg.photoNum)
        break

      case 'camera_error':
        console.warn('[CAM]', msg.msg)
        break

      case 'ingest_status':
        clearTimeout(ingestTimerRef.current)
        setIngestMsg({ phase: msg.phase, file: msg.file, msg: msg.msg })
        ingestTimerRef.current = setTimeout(() => setIngestMsg(null), msg.phase === 'uploading' ? 12000 : 4000)
        break

      case 'flash':
        setFlash(true)
        setPhotoCount(msg.photoNum)
        if (msg.photo) setTakenPhotos(prev => [...prev, msg.photo])
        clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash(false), 280)
        break

      case 'strip':
        setStrip(msg.data)
        if (msg.test !== undefined) setTestSession(!!msg.test)
        break

      case 'session_cancelled':
        setStrip(null)
        setPhotoCount(0)
        setTakenPhotos([])
        setTestSession(false)
        setCancelToast(
          msg.test
            ? 'Sesión de prueba cancelada'
            : `Sesión cancelada${msg.photoCount ? ` · ${msg.photoCount} foto(s) borrada(s)` : ''}`
        )
        clearTimeout(cancelToastRef.current)
        cancelToastRef.current = setTimeout(() => setCancelToast(null), 3500)
        break

      case 'print_start':
        clearTimeout(printTimerRef.current)
        setPrintJob({ phase: 'printing', printer: msg.printer, copies: msg.copies })
        // Seguridad: si print_done nunca llega, quitar overlay a los 15 s
        printTimerRef.current = setTimeout(() => setPrintJob(null), 15000)
        break

      case 'print_done':
        clearTimeout(printTimerRef.current)
        if (msg.cancelled) {
          setPrintJob(null)
          break
        }
        setPrintJob(prev => prev ? {
          ...prev,
          phase: msg.ok ? 'ok' : 'err',
          msg: msg.msg,
        } : null)
        printTimerRef.current = setTimeout(() => setPrintJob(null), 4000)
        break

      default:
        break
    }
  }, [])

  const send = useWebSocket('ws://localhost:8765', handleMessage)

  const toggleDebug = () => {
    send({ type: 'toggle_debug' })
    setDebug(d => !d)
  }

  // ── Keyboard (en pantalla de inicio) ─────────────────────────────────────
  const handleKey = useCallback((e) => {
    if (e.key === 'd' || e.key === 'D') toggleDebug()
    // Espacio: inicia sesión o siguiente foto (manual)
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault()
      if (appState === 'idle' || appState === 'mirror' || appState === 'waiting') {
        send({ type: 'start_session' })
      }
    }
    // P: sesión de prueba (preview de tira, sin guardar / print / ingest)
    if (e.key === 'p' || e.key === 'P') {
      if (appState === 'idle' || appState === 'mirror') {
        send({ type: 'start_session', test: true })
      }
    }
    // C: cancelar sesión en curso (borra fotos locales)
    if (e.key === 'c' || e.key === 'C') {
      if (['countdown', 'taking', 'waiting', 'preview'].includes(appState)) {
        send({ type: 'cancel_session' })
      }
    }
  }, [send, appState])

  return (
    <div
      className="relative w-screen h-screen bg-[#09090B] overflow-hidden"
      tabIndex={0}
      onKeyDown={handleKey}
      style={{ outline: 'none' }}
    >
      {/* ── Video feed ─────────────────────────────────────────────────── */}
      <VideoFeed ref={imgRef} flash={flash} blur={appState === 'idle'} contain={!!activeEvent} />

      {/* ── Sin evento activo ────────────────────────────────── */}
      <AnimatePresence>
        {connected && !activeEvent && (
          <motion.div
            key="no-event"
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6
                       bg-[#09090B]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
          >
            <span style={{ fontSize: 72 }}>📋</span>
            <div className="text-center">
              <h2 className="text-white font-black text-3xl mb-2">Sin evento activo</h2>
              <p className="text-white/40 text-sm leading-relaxed">
                Abre el panel de admin y activa un evento<br />
                para empezar a usar el photobooth.
              </p>
            </div>
            <button
              onClick={() => window.electronBridge?.openAdmin()}
              className="mt-2 px-7 py-3 rounded-2xl font-bold text-sm
                         bg-gradient-to-r from-pink-600 to-[#CC0000]
                         hover:from-pink-500 hover:to-[#990000]
                         text-white transition-all"
            >
              ⚙️ Abrir panel de admin
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ── Toast sesión cancelada ─────────────────────────────────────── */}
      <AnimatePresence>
        {cancelToast && (
          <motion.div
            key="cancel-toast"
            className="absolute top-16 left-1/2 -translate-x-1/2 z-[60]
                       px-5 py-3 rounded-2xl bg-red-950/90 border border-red-500/40
                       text-red-200 text-sm font-bold shadow-lg"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            ⛔ {cancelToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Overlay imprimiendo (para clientes) ─────────────────────────── */}
      <AnimatePresence>
        {printJob && (
          <motion.div
            key="print-overlay"
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
            <div className="relative flex flex-col items-center gap-5 text-center px-8">
              {printJob.phase === 'printing' ? (
                <>
                  <motion.div
                    className="w-20 h-20 rounded-full border-4 border-pink-500 border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                  />
                  <div>
                    <h2 className="text-white font-black" style={{ fontSize: '2.6rem', lineHeight: 1.15 }}>
                      Imprimiendo…
                    </h2>
                    <p className="text-white/50 text-base mt-2">
                      Ya casi está lista tu tira de fotos 🖨️
                    </p>
                  </div>
                </>
              ) : printJob.phase === 'ok' ? (
                <>
                  <motion.span
                    style={{ fontSize: 88, lineHeight: 1 }}
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 0.5 }}
                  >🎉</motion.span>
                  <div>
                    <h2 className="text-white font-black" style={{ fontSize: '2.4rem', lineHeight: 1.2 }}>
                      ¡Ya puedes
                    </h2>
                    <h2 className="gradient-text-anim font-black" style={{ fontSize: '2.4rem', lineHeight: 1.2 }}>
                      recoger tus fotos!
                    </h2>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 72 }}>⚠️</span>
                  <p className="text-red-400 font-bold text-xl">Error al imprimir</p>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ── Sin conexión ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {!connected && (
          <motion.div
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#09090B]"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              className="w-12 h-12 rounded-full border-4 border-brand-pink border-t-transparent"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
            />
            <p className="text-white/50 text-sm tracking-widest uppercase">
              Conectando con el backend…
            </p>
            <p className="text-white/25 text-xs">ws://localhost:8765</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Estado upload ECA360 (no bloquea) ───────────────────────────── */}
      <AnimatePresence>
        {ingestMsg && (
          <motion.div
            key="ingest"
            className="absolute bottom-4 right-4 z-40 rounded-xl px-4 py-2.5 text-xs font-semibold
                       backdrop-blur-md border pointer-events-none"
            style={{
              background: ingestMsg.phase === 'err' ? 'rgba(127,29,29,0.85)'
                : ingestMsg.phase === 'ok' ? 'rgba(6,78,59,0.85)'
                : 'rgba(0,0,0,0.75)',
              borderColor: ingestMsg.phase === 'err' ? 'rgba(248,113,113,0.4)'
                : ingestMsg.phase === 'ok' ? 'rgba(52,211,153,0.4)'
                : 'rgba(255,255,255,0.15)',
              color: '#fff',
            }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {ingestMsg.phase === 'uploading' && `↑ Subiendo ${ingestMsg.file}…`}
            {ingestMsg.phase === 'ok' && `✓ Enviada ${ingestMsg.file}`}
            {ingestMsg.phase === 'err' && `⚠ No se subió ${ingestMsg.file}${ingestMsg.msg ? `: ${ingestMsg.msg}` : ''}`}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Botón panel admin (esquina inf. izquierda) ───────────────────── */}
      <button
        className="absolute bottom-4 left-4 z-40 text-white/15 hover:text-white/50
                   transition-colors text-xs tracking-widest"
        onClick={() => window.electronBridge?.openAdmin()}
        title="Panel de administración"
      >
        ⚙
      </button>

      {/* ── Barra de arrastre invisible en la parte superior ──────────── */}
      <div
        className="absolute top-0 left-0 right-0 h-8 z-50"
        style={{ WebkitAppRegion: 'drag' }}
      />

      {/* ── Controles de ventana (frameless) ────────────────────────── */}
      <div className="absolute top-3 right-3 z-50 flex items-center gap-2"
           style={{ WebkitAppRegion: 'no-drag' }}>
        {/* Badge del evento + modo sesión */}
        {activeEvent && (
          <span className="text-white/30 text-xs font-mono truncate max-w-[160px]"
            title={activeEvent.name}>
            {activeEvent.name}
          </span>
        )}
        {testSession && appState !== 'idle' ? (
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wide
                           bg-amber-500 text-black shadow-lg shadow-amber-500/40">
            Sesión de prueba
          </span>
        ) : activeEvent ? (
          <span className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide
                           text-white/35 bg-white/5 border border-white/10">
            Real
          </span>
        ) : null}
        <button
          onClick={() => window.electronBridge?.returnToLauncher?.()}
          className="px-2.5 py-1 rounded-lg text-xs font-bold text-white/80
                     bg-white/10 hover:bg-white/20 border border-white/15
                     transition-colors focus:outline-none"
          title="Volver al menú de selección"
        >
          ← Menú
        </button>
        <button
          onClick={() => window.electronBridge?.minimizeWindow()}
          className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400
                     transition-colors focus:outline-none"
          title="Minimizar"
        />
        <button
          onClick={() => window.electronBridge?.closeWindow()}
          className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500
                     transition-colors focus:outline-none"
          title="Cerrar"
        />
      </div>

      {/* ── Overlays por estado ─────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {appState === 'idle' && (
          <IdleOverlay
            key="idle"
            palmProgress={palmProgress}
          />
        )}

        {appState === 'countdown' && (
          <CountdownOverlay
            key="countdown"
            value={countdown}
            label={`Foto ${Math.min(photoCount + 1, totalPhotos)} / ${totalPhotos}${testSession ? ' · PRUEBA' : ''}${captureMode === 'manual' ? ' · Manual' : ''}`}
          />
        )}

        {appState === 'taking' && (
          <TakingOverlay
            key="taking"
            value={countdown}
            photoNum={photoCount + 1}
            totalPhotos={totalPhotos}
          />
        )}

        {appState === 'waiting' && (
          <motion.div
            key="waiting"
            className="absolute inset-0 z-30 flex flex-col items-center justify-end pb-16 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className={`glass rounded-2xl px-8 py-5 text-center border
              ${testSession ? 'border-amber-400/40' : 'border-violet-400/30'}`}>
              <p className={`font-bold text-sm uppercase tracking-widest
                ${testSession ? 'text-amber-300' : 'text-violet-200'}`}>
                {testSession ? 'Prueba · manual' : 'Modo manual'}
              </p>
              <h2 className="text-white font-black text-2xl mt-1">
                Foto {photoCount} / {totalPhotos} lista
              </h2>
              <p className="text-white/50 text-sm mt-2">
                Presiona <span className="text-white font-bold">ESPACIO</span> para la siguiente
              </p>
            </div>
          </motion.div>
        )}

        {appState === 'preview' && strip && (
          <StripPreview key={testSession ? 'preview-test' : 'preview'} data={strip} test={testSession} />
        )}
      </AnimatePresence>

      {/* ── Mirror controls ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {appState === 'mirror' && (
          <MirrorControls
            key="mirror"
            onExit={() => send({ type: 'dismiss_mirror' })}
          />
        )}
      </AnimatePresence>

      {/* ── Strip builder (fuera del AnimatePresence de estados) ─────── */}
      <AnimatePresence>
        {(appState === 'taking' || appState === 'countdown' || appState === 'waiting') && (
          <StripBuilder
            key="strip-builder"
            photos={takenPhotos}
            totalPhotos={totalPhotos}
          />
        )}
      </AnimatePresence>


    </div>
  )
}
