import { motion } from 'framer-motion'

const MODES = [
  {
    id: 'photos',
    title: 'Cabina de fotos',
    subtitle: 'Photobooth clásico con tira e impresión',
    accent: 'from-pink-600 to-[#CC0000]',
    ring: 'hover:border-pink-500/50',
    icon: '📷',
  },
  {
    id: '360',
    title: 'Cabina 360',
    subtitle: 'Videos, marco, compresión y envío a ECA360',
    accent: 'from-sky-600 to-indigo-700',
    ring: 'hover:border-sky-500/40',
    icon: '🎥',
  },
]

export default function LauncherApp() {
  const pick = (mode) => {
    if (mode.id === 'photos') {
      window.electronBridge?.launchPhotos?.()
      return
    }
    if (mode.id === '360') {
      window.electronBridge?.launch360?.()
    }
  }

  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{
        fontFamily: "'Outfit', system-ui, sans-serif",
        background:
          'radial-gradient(1200px 600px at 20% -10%, rgba(255,45,120,0.22), transparent 55%),' +
          'radial-gradient(900px 500px at 90% 110%, rgba(14,165,233,0.16), transparent 50%),' +
          'linear-gradient(160deg, #09090B 0%, #121218 45%, #0A0A0C 100%)',
      }}
    >
      {/* Barra de arrastre */}
      <div
        className="absolute top-0 left-0 right-0 h-10 z-50"
        style={{ WebkitAppRegion: 'drag' }}
      />

      {/* Controles de ventana */}
      <div
        className="absolute top-3 right-3 z-50 flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        <button
          onClick={() => window.electronBridge?.minimizeWindow()}
          className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400 transition-colors"
          title="Minimizar"
        />
        <button
          onClick={() => window.electronBridge?.closeWindow()}
          className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors"
          title="Cerrar"
        />
      </div>

      <div className="relative z-10 h-full flex flex-col items-center justify-center px-8 gap-10">
        <div className="text-center">
          <p className="text-white/35 text-xs font-bold tracking-[0.35em] uppercase mb-3">
            Ecosistema
          </p>
          <h1 className="text-white font-black tracking-tight" style={{ fontSize: '3.25rem', lineHeight: 1.05 }}>
            ECA MID
          </h1>
          <p className="text-white/45 text-base mt-3 max-w-md mx-auto">
            Elige qué cabina quieres abrir
          </p>
        </div>

        <div className="grid grid-cols-2 gap-5 w-full max-w-3xl">
          {MODES.map((mode, i) => (
            <motion.button
              key={mode.id}
              onClick={() => pick(mode)}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.06, type: 'spring', damping: 22, stiffness: 200 }}
              whileHover={{ y: -4, scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              className={`relative text-left rounded-3xl border border-white/10 bg-white/[0.04]
                          px-7 py-8 transition-colors ${mode.ring}`}
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              <div
                className={`absolute inset-x-0 top-0 h-1 rounded-t-3xl bg-gradient-to-r ${mode.accent}`}
              />
              <span className="text-5xl block mb-5">{mode.icon}</span>
              <h2 className="text-white font-extrabold text-2xl tracking-tight">{mode.title}</h2>
              <p className="text-white/40 text-sm mt-2 leading-relaxed">{mode.subtitle}</p>
              <span className={`inline-flex items-center gap-2 mt-5 text-sm font-bold
                                bg-gradient-to-r ${mode.accent} bg-clip-text text-transparent`}>
                Abrir →
              </span>
            </motion.button>
          ))}
        </div>
      </div>

    </div>
  )
}
