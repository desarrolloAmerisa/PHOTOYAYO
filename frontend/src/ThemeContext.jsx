import { createContext, useContext, useState } from 'react'

// ── Paletas de clases Tailwind / inline ───────────────────────────────────────
export const DARK = {
  // Fondos
  bgApp:       'bg-[#09090B]',
  bgBar:       'bg-[#0D0D0F]',
  bgSidebar:   'bg-[#0A0A0C]',
  bgCard:      'bg-white/5',
  bgInput:     'bg-white/5',
  bgHover:     'hover:bg-white/10',
  bgSection:   'bg-white/3',

  // Texto
  text:        'text-white',
  textMuted:   'text-white/50',
  textFaint:   'text-white/30',
  textUltra:   'text-white/20',

  // Bordes
  border:      'border-white/5',
  borderMed:   'border-white/10',
  borderFaint: 'border-white/8',

  // Input completo
  input: 'bg-white/5 border border-white/10 text-white placeholder-white/20 focus:border-pink-500/50 focus:bg-white/8',

  // Indicador activo (badge verde)
  badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',

  // Label superior en formulario
  label: 'text-white/50',
  hint:  'text-white/25',

  // Danger zone
  dangerZone: 'bg-red-500/5 border-red-500/15',

  // Separador
  divider: 'border-white/5',
}

export const LIGHT = {
  bgApp:       'bg-[#F5F5F7]',
  bgBar:       'bg-white',
  bgSidebar:   'bg-[#EAEAEC]',
  bgCard:      'bg-black/5',
  bgInput:     'bg-black/5',
  bgHover:     'hover:bg-black/8',
  bgSection:   'bg-black/3',

  text:        'text-gray-900',
  textMuted:   'text-gray-500',
  textFaint:   'text-gray-400',
  textUltra:   'text-gray-300',

  border:      'border-black/8',
  borderMed:   'border-black/12',
  borderFaint: 'border-black/8',

  input: 'bg-black/5 border border-black/12 text-gray-900 placeholder-gray-400 focus:border-pink-500/70 focus:bg-black/8',

  badge: 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30',

  label: 'text-gray-500',
  hint:  'text-gray-400',

  dangerZone: 'bg-red-500/5 border-red-400/20',

  divider: 'border-black/8',
}

// ── Context ───────────────────────────────────────────────────────────────────
const ThemeCtx = createContext({ t: DARK, isDark: true, toggle: () => {} })

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true)
  const t = isDark ? DARK : LIGHT
  return (
    <ThemeCtx.Provider value={{ t, isDark, toggle: () => setIsDark(d => !d) }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export const useTheme = () => useContext(ThemeCtx)
