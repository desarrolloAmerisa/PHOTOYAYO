import { motion, AnimatePresence } from 'framer-motion'

export default function CountdownOverlay({ value, label }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-20"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Fondo semi-oscuro */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Número animado */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={value}
          className="relative gradient-text font-black leading-none select-none"
          style={{ fontSize: 'clamp(160px, 22vw, 280px)' }}
          initial={{ scale: 2.2, opacity: 0, filter: 'blur(24px)' }}
          animate={{ scale: 1,   opacity: 1, filter: 'blur(0px)'  }}
          exit={{    scale: 0.4, opacity: 0, filter: 'blur(12px)' }}
          transition={{ type: 'spring', damping: 18, stiffness: 180 }}
        >
          {value}
        </motion.div>
      </AnimatePresence>

      {/* Etiqueta */}
      <motion.p
        className="relative text-white/60 font-semibold tracking-widest uppercase text-lg mt-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0  }}
        transition={{ delay: 0.15 }}
      >
        {label}
      </motion.p>

      {/* Pulse ring decorativo */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          className="rounded-full border border-white/10"
          animate={{ scale: [1, 1.6], opacity: [0.3, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
          style={{ width: 180, height: 180 }}
        />
      </div>
    </motion.div>
  )
}
