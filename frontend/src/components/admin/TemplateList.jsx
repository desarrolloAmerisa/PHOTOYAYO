import { motion } from 'framer-motion'
import { useTheme } from '../../ThemeContext'

export default function TemplateList({ templates, loading, selectedId, onSelect, onCreate }) {
  const { t } = useTheme()

  return (
    <div className={`w-64 flex-shrink-0 flex flex-col border-r ${t.border} ${t.bgBar}`}>
      {/* Cabecera */}
      <div className={`px-4 py-3 border-b ${t.border} flex items-center justify-between`}>
        <span className={`text-xs font-bold uppercase tracking-widest ${t.textFaint}`}>
          Plantillas
        </span>
        <button
          onClick={onCreate}
          className="w-6 h-6 rounded-full bg-pink-600 hover:bg-pink-500 text-white
                     text-base leading-none flex items-center justify-center
                     transition-colors font-black"
          title="Nueva plantilla"
        >
          +
        </button>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <span className="w-5 h-5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className={`px-4 py-6 text-center ${t.textFaint} text-xs`}>
            <p className="text-2xl mb-2">📐</p>
            <p>No hay plantillas aún.</p>
            <p className="mt-1">Crea una con el botón +</p>
          </div>
        ) : (
          templates.map(tpl => {
            const photoCount = tpl.slots?.length
              ? Math.max(...tpl.slots.map(s => s.photoIndex))
              : 0
            const isSelected = tpl.id === selectedId
            return (
              <motion.button
                key={tpl.id}
                onClick={() => onSelect(tpl.id)}
                className={`w-full text-left px-4 py-3 transition-colors
                  ${isSelected
                    ? `${t.bgCard} border-l-2 border-pink-500`
                    : `border-l-2 border-transparent ${t.bgHover}`}`}
                whileTap={{ scale: 0.98 }}
              >
                <p className={`text-sm font-semibold leading-tight truncate
                               ${isSelected ? t.text : t.textMuted}`}>
                  {tpl.name}
                </p>
                <p className={`text-xs mt-0.5 ${t.textFaint}`}>
                  {tpl.width}×{tpl.height} px
                  {tpl.slots?.length > 0 && (
                    <> · {tpl.slots.length} {tpl.slots.length === 1 ? 'hueco' : 'huecos'} · 📷{photoCount}</>
                  )}
                </p>
              </motion.button>
            )
          })
        )}
      </div>
    </div>
  )
}
