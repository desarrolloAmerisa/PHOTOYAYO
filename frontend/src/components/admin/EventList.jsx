import { motion } from 'framer-motion'
import { useTheme } from '../../ThemeContext'

export default function EventList({
  events, activeId, selectedId, loading, onSelect, onCreate,
}) {
  const { t } = useTheme()
  return (
    <div className={`w-64 min-w-[220px] flex flex-col h-full ${t.bgSidebar} border-r ${t.border} transition-colors duration-300`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${t.border}`}>
        <h2 className={`${t.textMuted} font-bold text-xs tracking-widest uppercase`}>Eventos</h2>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-1">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 rounded-full border-2 border-pink-500/60
                            border-t-transparent animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <p className={`${t.textUltra} text-xs text-center py-10 leading-relaxed`}>
            No hay eventos.<br />Crea el primero 👇
          </p>
        ) : (
          events.map(evt => {
            const isSelected = selectedId === evt.id
            const isActive   = activeId   === evt.id
            return (
              <motion.button
                key={evt.id}
                onClick={() => onSelect(evt.id)}
                className={`w-full text-left rounded-xl px-3 py-3 transition-all
                  ${isSelected
                    ? 'bg-gradient-to-r from-pink-600/20 to-[#CC0000]/20 border border-pink-500/20'
                    : `border border-transparent ${t.bgHover}`
                  }`}
                whileTap={{ scale: 0.98 }}
              >
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
                      style={{ background: '#10B981', boxShadow: '0 0 6px #10B981' }}
                    />
                  )}
                  <span className={`font-semibold text-sm truncate
                    ${isSelected ? t.text : t.textMuted}`}>
                    {evt.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 ml-4">
                  <span className={`${t.textFaint} text-xs`}>
                    {evt.width}×{evt.height} px
                  </span>
                  {evt.hasTemplate && (
                    <span className={`${t.textUltra} text-xs`}>· 🖼️</span>
                  )}
                </div>
              </motion.button>
            )
          })
        )}
      </div>

      {/* Botón nuevo */}
      <div className={`p-3 border-t ${t.border}`}>
        <motion.button
          onClick={onCreate}
          className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all
            ${selectedId === null
              ? 'bg-gradient-to-r from-pink-600/80 to-[#CC0000]/80 text-white'
              : `${t.bgCard} ${t.textMuted} ${t.bgHover}`
            }`}
          whileTap={{ scale: 0.97 }}
        >
          + Nuevo evento
        </motion.button>
      </div>
    </div>
  )
}
