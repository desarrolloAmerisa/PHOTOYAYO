import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = 'http://localhost:8766'

export default function StripPreview({ data }) {
  const [autoCount, setAutoCount] = useState(5)
  const [autoPhase, setAutoPhase] = useState('countdown')  // 'countdown' | 'collecting'

  const doPrintRef = useRef(null)
  doPrintRef.current = async () => {
    try {
      await fetch(`${API}/api/print`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image_b64: data }),
      })
    } catch { /* el overlay de recoger se muestra igual */ }
    setAutoPhase('collecting')
  }

  useEffect(() => {
    if (autoPhase !== 'countdown') return
    if (autoCount <= 0) { doPrintRef.current?.(); return }
    const t = setTimeout(() => setAutoCount(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [autoCount, autoPhase])

  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

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

      <motion.div
        className="relative flex flex-col items-center gap-5"
        initial={{ scale: 0.85, y: 40, opacity: 0 }}
        animate={{ scale: 1,    y: 0,  opacity: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 180, delay: 0.1 }}
      >
        <div className="text-center">
          <h2 className="gradient-text-anim font-black text-3xl tracking-tight">
            ¡Tus fotos están listas!
          </h2>
          <p className="text-white/40 text-sm mt-1">
            Guardadas en la carpeta del evento
          </p>
        </div>

        <motion.div
          className="rounded-2xl overflow-hidden shadow-2xl glow-pink"
          style={{ maxHeight: '55vh' }}
          transition={{ type: 'spring', damping: 20 }}
        >
          <img
            src={`data:image/jpeg;base64,${data}`}
            alt="Tira de fotos"
            className="block"
            style={{ maxHeight: '55vh', maxWidth: '90vw', objectFit: 'contain' }}
          />
        </motion.div>

        {autoPhase === 'countdown' && (
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
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}
