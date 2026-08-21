import { motion, AnimatePresence } from 'framer-motion'

function Dot({ filled }) {
  return (
    <motion.div
      className="rounded-full"
      style={{ width: 10, height: 10 }}
      animate={{
        background: filled
          ? 'linear-gradient(135deg,#FF2D78,#CC0000)'
          : 'rgba(255,255,255,0.2)',
        scale: filled ? 1.2 : 1,
      }}
      transition={{ type: 'spring', damping: 14, stiffness: 200 }}
    />
  )
}

export default function TakingOverlay({ value, photoNum, totalPhotos }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Número del countdown */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={value}
          className="gradient-text font-black leading-none select-none"
          style={{ fontSize: 'clamp(120px, 18vw, 220px)' }}
          initial={{ scale: 1.5, opacity: 0, y: -20 }}
          animate={{ scale: 1,   opacity: 1, y: 0   }}
          exit={{    scale: 0.8, opacity: 0, y:  20 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200 }}
        >
          {value}
        </motion.div>
      </AnimatePresence>

      {/* Foto X / N */}
      <motion.p
        className="text-white/70 font-semibold tracking-widest uppercase text-base mt-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        Foto {photoNum} / {totalPhotos}
      </motion.p>

      {/* Puntos de progreso */}
      <div className="flex gap-2 mt-4">
        {Array.from({ length: totalPhotos }, (_, i) => (
          <Dot key={i} filled={i < photoNum - 1} />
        ))}
      </div>
    </motion.div>
  )
}
