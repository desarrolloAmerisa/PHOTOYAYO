import { motion } from 'framer-motion'

function Row({ label, value, active }) {
  return (
    <div className="flex justify-between items-center gap-4 text-xs">
      <span className="text-white/40 font-mono">{label}</span>
      <span
        className="font-mono font-semibold"
        style={{ color: active ? '#10B981' : 'rgba(255,255,255,0.3)' }}
      >
        {String(value)}
      </span>
    </div>
  )
}

export default function DebugPanel({ gesture, appState }) {
  return (
    <motion.div
      className="absolute top-4 right-4 z-50 glass rounded-2xl p-4 min-w-[200px]"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0  }}
      exit={{    opacity: 0, x: 20 }}
      transition={{ type: 'spring', damping: 20, stiffness: 180 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ background: '#FF2D78', boxShadow: '0 0 6px #FF2D78' }}
        />
        <span className="text-xs font-bold tracking-widest uppercase text-white/60">
          Debug  [D]
        </span>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-2">
        <Row label="Mano"    value={gesture.handDetected ? 'detectada' : 'no'} active={gesture.handDetected} />
        <Row label="Palma"   value={gesture.palm  ? 'abierta' : 'cerrada'}     active={gesture.palm}         />
        <Row label="Paz"     value={gesture.peace ? '✌️ ok' : 'no'}             active={gesture.peace}        />
        <div className="my-1 border-t border-white/10" />
        <Row label="Estado"  value={appState}    active />
      </div>
    </motion.div>
  )
}
