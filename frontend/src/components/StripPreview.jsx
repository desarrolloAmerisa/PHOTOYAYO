import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = 'http://localhost:8766'

export default function StripPreview({ data }) {
  const [printing,     setPrinting]     = useState(false)
  const [printStatus,  setPrintStatus]  = useState(null)   // null | 'ok' | 'err'
  const [printMsg,     setPrintMsg]     = useState('')

  // Preview de impresión
  const [showPreview,  setShowPreview]  = useState(false)
  const [previewImg,   setPreviewImg]   = useState(null)
  const [previewInfo,  setPreviewInfo]  = useState(null)   // { paper_w_in, paper_h_in }
  const [loadingPrev,  setLoadingPrev]  = useState(false)

  // Auto-impresión con cuenta atrás
  const [autoCount,  setAutoCount]  = useState(5)
  const [autoPhase,  setAutoPhase]  = useState('countdown')  // 'countdown' | 'collecting' | 'cancelled'

  const doPrintRef = useRef(null)
  doPrintRef.current = async () => {
    try {
      await fetch(`${API}/api/print`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image_b64: data }),
      })
    } catch { /* ignorar — mostramos el cartel de todas formas */ }
    setAutoPhase('collecting')
  }

  useEffect(() => {
    if (autoPhase !== 'countdown') return
    if (autoCount <= 0) { doPrintRef.current?.(); return }
    const t = setTimeout(() => setAutoCount(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [autoCount, autoPhase])

  const handleShowPreview = async () => {
    setAutoPhase('cancelled')
    setLoadingPrev(true)
    setShowPreview(true)
    try {
      const r = await fetch(`${API}/api/print-preview`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image_b64: data }),
      })
      const j = await r.json()
      if (j.preview_b64) {
        setPreviewImg(j.preview_b64)
        setPreviewInfo({ w: j.paper_w_in, h: j.paper_h_in })
      } else {
        setPreviewImg(null)
      }
    } catch {
      setPreviewImg(null)
    } finally {
      setLoadingPrev(false)
    }
  }

  const handlePrint = async () => {
    setShowPreview(false)
    setPrinting(true)
    setPrintStatus(null)
    try {
      const r = await fetch(`${API}/api/print`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image_b64: data }),
      })
      const j = await r.json()
      if (j.ok) {
        setPrintStatus('ok')
        setPrintMsg('¡Enviado a imprimir!')
      } else {
        setPrintStatus('err')
        setPrintMsg(j.error ?? 'Error al imprimir')
      }
    } catch {
      setPrintStatus('err')
      setPrintMsg('No se pudo conectar con el backend')
    } finally {
      setPrinting(false)
      setTimeout(() => { setPrintStatus(null); setPrintMsg('') }, 4000)
    }
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Fondo oscuro */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      {/* ── Overlay recoger fotos ─────────────────────────────────────── */}
      <AnimatePresence>
        {autoPhase === 'collecting' && (
          <motion.div
            className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/92" />
            <div className="relative flex flex-col items-center gap-6 text-center px-8">
              <motion.span
                style={{ fontSize: 96, lineHeight: 1 }}
                animate={{ scale: [1, 1.12, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              >🎉</motion.span>
              <div>
                <h2 className="text-white font-black" style={{ fontSize: '3rem', lineHeight: 1.15 }}>
                  ¡Ya puedes
                </h2>
                <h2 className="gradient-text-anim font-black" style={{ fontSize: '3rem', lineHeight: 1.15 }}>
                  recoger tus fotos!
                </h2>
              </div>
              <p className="text-white/40 text-sm font-medium">La tira se ha enviado a imprimir</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal preview de impresión */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowPreview(false)}
          >
            <motion.div
              className="relative flex flex-col items-center gap-4 p-6 rounded-3xl bg-[#18181b] border border-white/10 shadow-2xl"
              style={{ maxWidth: '90vw', maxHeight: '90vh' }}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center">
                <h3 className="text-white font-black text-xl">Vista previa de impresión</h3>
                {previewInfo && (
                  <p className="text-white/40 text-xs mt-1">
                    Papel: {previewInfo.w}" × {previewInfo.h}" — tira centrada
                  </p>
                )}
              </div>

              {loadingPrev ? (
                <div className="w-32 h-48 flex items-center justify-center">
                  <span className="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : previewImg ? (
                <img
                  src={`data:image/jpeg;base64,${previewImg}`}
                  alt="Preview de impresión"
                  className="rounded-xl shadow-xl object-contain"
                  style={{ maxHeight: '65vh', maxWidth: '80vw' }}
                />
              ) : (
                <p className="text-white/40 text-sm">No se pudo generar la vista previa.</p>
              )}

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowPreview(false)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60
                             hover:bg-white/5 text-sm font-semibold transition-all"
                >
                  Cancelar
                </button>
                <motion.button
                  onClick={handlePrint}
                  whileTap={{ scale: 0.97 }}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white
                             bg-gradient-to-r from-pink-600 to-[#CC0000]
                             hover:from-pink-500 hover:to-[#990000] transition-all"
                >
                  🖨️ Confirmar e imprimir
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tarjeta principal */}
      <motion.div
        className="relative flex flex-col items-center gap-5"
        initial={{ scale: 0.85, y: 40, opacity: 0 }}
        animate={{ scale: 1,    y: 0,  opacity: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 180, delay: 0.1 }}
      >
        {/* Título */}
        <div className="text-center">
          <h2 className="gradient-text-anim font-black text-3xl tracking-tight">
            ¡Tus fotos están listas!
          </h2>
          <p className="text-white/40 text-sm mt-1">
            Guardadas en la carpeta del evento
          </p>
        </div>

        {/* Imagen de la tira */}
        <motion.div
          className="rounded-2xl overflow-hidden shadow-2xl glow-pink"
          style={{ maxHeight: '55vh' }}
          whileHover={{ scale: 1.01 }}
          transition={{ type: 'spring', damping: 20 }}
        >
          <img
            src={`data:image/jpeg;base64,${data}`}
            alt="Tira de fotos"
            className="block"
            style={{ maxHeight: '55vh', maxWidth: '90vw', objectFit: 'contain' }}
          />
        </motion.div>

        {/* Botones imprimir */}
        <div className="flex flex-col items-center gap-2">
          <motion.button
            onClick={handleShowPreview}
            disabled={printing}
            whileTap={!printing ? { scale: 0.96 } : undefined}
            className={`px-8 py-3 rounded-2xl font-black text-base flex items-center gap-3
              transition-all shadow-lg
              ${printing
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-gradient-to-r from-pink-600 to-[#CC0000] hover:from-pink-500 hover:to-[#990000] text-white'}`}
          >
            {printing
              ? <><span className="w-5 h-5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />Imprimiendo…</>
              : '🖨️ Imprimir tira'}
          </motion.button>

          {/* Feedback */}
          <AnimatePresence>
            {printStatus && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`text-sm font-semibold ${printStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {printStatus === 'ok' ? '✓' : '✗'} {printMsg}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Instrucción / Cuenta atrás auto-impresión */}
        {autoPhase === 'countdown' ? (
          <motion.div
            className="glass rounded-2xl px-8 py-5 flex flex-col items-center gap-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="text-white/60 text-sm font-semibold uppercase tracking-widest">
              🖨️ Impresión automática
            </p>
            <div className="flex items-baseline gap-3">
              <span className="text-white/60 text-xl font-semibold">Imprimiendo en</span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={autoCount}
                  className="text-white font-black"
                  style={{ fontSize: '4rem', lineHeight: 1 }}
                  initial={{ scale: 1.6, opacity: 0 }}
                  animate={{ scale: 1,   opacity: 1 }}
                  exit={{    scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {autoCount}
                </motion.span>
              </AnimatePresence>
            </div>
            <button
              onClick={() => setAutoPhase('cancelled')}
              className="text-white/30 hover:text-white/60 text-xs underline transition-colors mt-1"
            >
              Cancelar impresión automática
            </button>
          </motion.div>
        ) : autoPhase === 'cancelled' ? (
          <motion.div
            className="glass rounded-2xl px-8 py-4 flex items-center gap-4"
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <span style={{ fontSize: 44, lineHeight: 1 }}>⏳</span>
            <div>
              <p className="text-white font-black text-xl leading-tight">
                Volviendo en unos segundos…
              </p>
              <p className="text-white/50 font-medium text-sm mt-1">
                o abre la palma para ver el espejo
              </p>
            </div>
          </motion.div>
        ) : null}
      </motion.div>
    </motion.div>
  )
}

