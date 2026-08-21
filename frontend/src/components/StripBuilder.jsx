import { motion, AnimatePresence } from 'framer-motion'

/**
 * Muestra la tira construyéndose slot por slot mientras se toman las fotos.
 * Aparece superpuesto a la derecha durante el estado "taking".
 */
export default function StripBuilder({ photos, totalPhotos }) {
  return (
    <motion.div
      className="absolute right-6 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3"
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0  }}
      exit={{    opacity: 0, x: 60 }}
      transition={{ type: 'spring', damping: 22, stiffness: 180 }}
    >
      {/* Etiqueta */}
      <p className="text-white/30 text-xs font-bold tracking-widest uppercase text-center mb-1">
        Tu tira
      </p>

      {Array.from({ length: totalPhotos }, (_, i) => {
        const photo = photos[i] ?? null
        return (
          <div
            key={i}
            className="relative rounded-xl overflow-hidden"
            style={{ width: 110, height: 110 }}
          >
            {/* Slot vacío */}
            <div className="absolute inset-0 rounded-xl border-2 border-dashed border-white/15
                            bg-white/3 flex items-center justify-center">
              <span className="text-white/15 text-2xl font-black">{i + 1}</span>
            </div>

            {/* Foto animada al llegar */}
            <AnimatePresence>
              {photo && (
                <motion.div
                  key="photo"
                  className="absolute inset-0 rounded-xl overflow-hidden"
                  initial={{ scale: 2.5, opacity: 0, rotate: -6 }}
                  animate={{ scale: 1,   opacity: 1, rotate:  0 }}
                  transition={{
                    type:      'spring',
                    damping:   18,
                    stiffness: 220,
                    duration:  0.45,
                  }}
                >
                  <img
                    src={`data:image/jpeg;base64,${photo}`}
                    alt={`Foto ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {/* Borde brillante al entrar */}
                  <motion.div
                    className="absolute inset-0 rounded-xl"
                    style={{
                      boxShadow: '0 0 0 2px rgba(255,45,120,0.8), 0 0 20px rgba(255,45,120,0.4)',
                    }}
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ delay: 0.4, duration: 0.6 }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </motion.div>
  )
}
