import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Controles flotantes para el modo espejo.
 * - Barra draggable en la parte superior (arrastra la ventana Electron).
 * - Botón pantalla completa.
 * - Botón para salir del espejo.
 */
export default function MirrorControls({ onExit }) {
  const [fullscreen,   setFullscreen]   = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [timer,        setTimer]        = useState(null)

  // Al entrar al componente, detectar si ya estamos en fullscreen
  useEffect(() => {
    window.electronBridge?.isFullscreen?.().then?.(v => setFullscreen(!!v))
  }, [])

  // Auto-ocultar controles tras 3 s de inactividad
  const resetTimer = () => {
    setShowControls(true)
    clearTimeout(timer)
    const t = setTimeout(() => setShowControls(false), 3000)
    setTimer(t)
  }

  useEffect(() => {
    resetTimer()
    return () => clearTimeout(timer)
  }, [])

  const toggleFullscreen = () => {
    window.electronBridge?.toggleFullscreen()
    setFullscreen(f => !f)
    resetTimer()
  }

  return (
    <div
      className="absolute inset-0 z-40 pointer-events-none"
      onMouseMove={resetTimer}
      onTouchStart={resetTimer}
    >
      <AnimatePresence>
        {showControls && (
          <motion.div
            key="mirror-bar"
            className="absolute top-0 left-0 right-0 pointer-events-auto"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{    opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Barra: la mayor parte es drag handle */}
            <div
              className="flex items-center h-14 px-4 gap-3"
              style={{
                WebkitAppRegion: 'drag',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.30) 80%, transparent 100%)',
              }}
            >
              {/* Icono de arrastre (decorativo) */}
              <span className="text-white/70 text-sm font-semibold select-none tracking-wide" style={{ WebkitAppRegion: 'drag' }}>
                ⠿ espejo
              </span>

              {/* Spacer draggable */}
              <div className="flex-1" style={{ WebkitAppRegion: 'drag' }} />

              {/* Botones: no-drag */}
              <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
                <button
                  onClick={toggleFullscreen}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold
                             transition-all bg-white/25 hover:bg-white/40 text-white
                             shadow-lg border border-white/40"
                  title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                >
                  {fullscreen ? '⊠ Salir pantalla completa' : '⛶ Pantalla completa'}
                </button>
                <button
                  onClick={onExit}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold
                             transition-all bg-red-600/80 hover:bg-red-500 text-white
                             shadow-lg border border-red-400/60"
                  title="Salir del modo espejo"
                >
                  ✕ Ocultar espejo
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Indicador sutil en la esquina cuando los controles están ocultos */}
      <AnimatePresence>
        {!showControls && (
          <motion.div
            key="mirror-hint"
            className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            onMouseEnter={resetTimer}
          >
            <div className="w-8 h-1 rounded-full bg-white/50" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
