import { motion, AnimatePresence } from 'framer-motion'

// ── SVG ring de progreso ──────────────────────────────────────────────────────
const R = 54
const C = 2 * Math.PI * R

function PalmRing({ progress }) {
  const offset = C * (1 - progress)
  return (
    <svg width={128} height={128} viewBox="0 0 128 128"
      style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={64} cy={64} r={R} fill="none"
        stroke="rgba(255,255,255,0.1)" strokeWidth={7} />
      <motion.circle
        cx={64} cy={64} r={R} fill="none"
        stroke="url(#pg)" strokeWidth={7} strokeLinecap="round"
        strokeDasharray={C}
        animate={{ strokeDashoffset: offset }}
        transition={{ ease: 'linear', duration: 0.08 }}
      />
      <defs>
        <linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#FF2D78" />
          <stop offset="100%" stopColor="#CC0000" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ── Tarjeta de instrucción ────────────────────────────────────────────────────
const CARD_STYLES = [
  { bg: 'rgba(25,5,5,0.92)',   border: '#CC0000', glow: 'rgba(204,0,0,0.4)'     },  // palma  → rojo
  { bg: 'rgba(5,20,30,0.92)',  border: '#06B6D4', glow: 'rgba(6,182,212,0.4)'   },  // índice → cian
  { bg: 'rgba(5,25,10,0.92)',  border: '#10B981', glow: 'rgba(16,185,129,0.4)'  },  // pulgar → verde
]

function Card({ emoji, title, desc, delay = 0, styleIdx = 0 }) {
  const s = CARD_STYLES[styleIdx]
  return (
    <motion.div
      className="rounded-3xl px-8 py-6 flex flex-col items-center gap-3 min-w-[200px]"
      style={{
        background: s.bg,
        border: `1.5px solid ${s.border}`,
        boxShadow: `0 0 24px ${s.glow}, inset 0 0 12px rgba(0,0,0,0.3)`,
      }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0  }}
      transition={{ delay, type: 'spring', damping: 20, stiffness: 180 }}
    >
      <span style={{ fontSize: 64, lineHeight: 1 }}>{emoji}</span>
      <p className="text-white font-bold text-xl text-center leading-tight">{title}</p>
      <p className="text-white/60 font-medium text-sm text-center leading-snug">{desc}</p>
    </motion.div>
  )
}

// ── Overlay principal ─────────────────────────────────────────────────────────
export default function IdleOverlay({ palmProgress }) {
  const showRing = palmProgress > 0

  return (
    <motion.div
      className="absolute inset-0 flex flex-col pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Título superior */}
      <motion.div
        className="flex flex-col items-center pt-10 pb-4"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0  }}
        transition={{ delay: 0.05 }}
      >
        <h1
          className="gradient-text-anim font-black tracking-tight leading-none"
          style={{ fontSize: 'clamp(42px, 6vw, 80px)' }}
        >
          PHOTOBOOTH
        </h1>
        <p className="text-white/40 font-semibold tracking-widest uppercase text-sm mt-2">
          ¡Muéstrale tus gestos a la cámara! 📸
        </p>
      </motion.div>

      {/* Tarjetas de instrucciones */}
      <div className="flex items-center justify-center gap-6 px-8 flex-1">
        <Card
          emoji="✌️"
          title="Amor y paz"
          desc={"Sostén quieto 0.6 s\npara iniciar la sesión"}
          delay={0.1}
          styleIdx={1}
        />
      </div>

      {/* Indicador de gesto activo: paz */}
      <AnimatePresence>
        {showRing && (
          <motion.div
            key="ring"
            className="absolute inset-0 flex flex-col items-center justify-center gap-4"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1  }}
            exit={{    opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', damping: 18, stiffness: 200 }}
          >
            {/* Fondo oscuro detrás del ring */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative flex items-center justify-center z-10">
              <PalmRing progress={palmProgress} />
              <span className="absolute animate-pulsering"
                style={{ fontSize: 52 }}>✌️</span>
            </div>
            <p className="relative z-10 text-white font-bold tracking-wide"
              style={{ fontSize: 22 }}>
              Sostén el gesto de paz…
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

