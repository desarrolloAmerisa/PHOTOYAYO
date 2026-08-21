import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../../ThemeContext'

const API = 'http://localhost:8766'

const PAPER_PRESETS = [
  { id: '4x6',    label: '4" × 6"  —  Fotografía estándar', w: 4.0,   h: 6.0   },
  { id: '5x7',    label: '5" × 7"  —  Fotografía mediana',  w: 5.0,   h: 7.0   },
  { id: 'letter', label: 'Letter  (8.5" × 11")',             w: 8.5,   h: 11.0  },
  { id: 'a4',     label: 'A4  (210 × 297 mm)',               w: 8.268, h: 11.693},
  { id: 'a5',     label: 'A5  (148 × 210 mm)',               w: 5.827, h: 8.268 },
  { id: 'custom', label: 'Personalizado…',                   w: 0,     h: 0     },
]

const DEFAULT_CFG = {
  paper_preset:     '4x6',
  paper_w_in:       4.0,
  paper_h_in:       6.0,
  orientation:      'portrait',
  margin_top_mm:    5,
  margin_bottom_mm: 5,
  margin_left_mm:   5,
  margin_right_mm:  5,
  copies:           1,
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function inToMm(inches) { return +(inches * 25.4).toFixed(1) }
function mmToIn(mm)     { return +(mm / 25.4).toFixed(3)     }

export default function PrintConfig({ onSaved }) {
  const { t } = useTheme()
  const [cfg,     setCfg]     = useState(DEFAULT_CFG)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [status,  setStatus]  = useState(null)  // null | 'ok' | 'err'

  // ── Dimensiones en mm para el UI del papel personalizado ─────────────────
  const customWmm = inToMm(cfg.paper_w_in)
  const customHmm = inToMm(cfg.paper_h_in)

  // ── Cargar config al montar ───────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/print-config`)
      const j = await r.json()
      setCfg({ ...DEFAULT_CFG, ...j })
    } catch {
      // backend sin conectar — mantener defaults
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  // ── Guardar ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const r = await fetch(`${API}/api/print-config`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(cfg),
      })
      const j = await r.json()
      if (j.ok) {
        setStatus('ok')
        setCfg({ ...DEFAULT_CFG, ...j.print_config })
        onSaved?.()
        setTimeout(() => setStatus(null), 3000)
      } else {
        setStatus('err')
      }
    } catch {
      setStatus('err')
    } finally {
      setSaving(false)
    }
  }

  // ── Setters parciales ─────────────────────────────────────────────────────
  const set = (key, val) => setCfg(c => ({ ...c, [key]: val }))

  const selectPreset = (presetId) => {
    const p = PAPER_PRESETS.find(x => x.id === presetId)
    if (!p) return
    if (presetId === 'custom') {
      setCfg(c => ({ ...c, paper_preset: 'custom' }))
    } else {
      setCfg(c => ({ ...c, paper_preset: presetId, paper_w_in: p.w, paper_h_in: p.h }))
    }
  }

  // ── Visualización de papel ─────────────────────────────────────────────────
  const isLandscape   = cfg.orientation === 'landscape'
  const dispW         = isLandscape ? cfg.paper_h_in : cfg.paper_w_in
  const dispH         = isLandscape ? cfg.paper_w_in : cfg.paper_h_in
  const previewAspect = dispH > 0 ? dispW / dispH : 1
  const previewH      = 120
  const previewW      = Math.max(50, Math.round(previewH * previewAspect))

  // márgenes relativos para el diagrama
  const mScale = previewH / (dispH * 25.4)   // px per mm
  const mTop  = Math.round(cfg.margin_top_mm    * mScale)
  const mBot  = Math.round(cfg.margin_bottom_mm * mScale)
  const mLeft = Math.round(cfg.margin_left_mm   * mScale)
  const mRight= Math.round(cfg.margin_right_mm  * mScale)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* ── Título ── */}
      <div>
        <h2 className={`text-xl font-black ${t.text}`}>🖨️ Configuración de impresión</h2>
        <p className={`text-sm ${t.textFaint} mt-0.5`}>
          Estas preferencias se aplican a cada impresión y vista previa.
        </p>
      </div>

      {/* ── Tamaño de papel ── */}
      <Section t={t} title="Tamaño de papel">
        <div className="grid grid-cols-1 gap-2">
          {PAPER_PRESETS.map(p => (
            <label
              key={p.id}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-all
                ${cfg.paper_preset === p.id
                  ? 'border-pink-500 bg-pink-500/10'
                  : `${t.borderMed} ${t.bgCard} ${t.bgHover}`}`}
            >
              <input
                type="radio"
                name="paper_preset"
                value={p.id}
                checked={cfg.paper_preset === p.id}
                onChange={() => selectPreset(p.id)}
                className="accent-pink-500"
              />
              <span className={`text-sm font-medium ${cfg.paper_preset === p.id ? 'text-pink-400' : t.text}`}>
                {p.label}
              </span>
              {p.id !== 'custom' && p.w > 0 && (
                <span className={`ml-auto text-xs font-mono ${t.textFaint}`}>
                  {inToMm(p.w)} × {inToMm(p.h)} mm
                </span>
              )}
            </label>
          ))}
        </div>

        {/* Dimensiones personalizadas */}
        {cfg.paper_preset === 'custom' && (
          <div className="flex items-center gap-4 mt-3 px-1">
            <label className={`text-sm ${t.textMuted}`}>Ancho (mm)</label>
            <input
              type="number" min="25" max="600" step="1"
              value={customWmm}
              onChange={e => set('paper_w_in', mmToIn(+e.target.value))}
              className={`w-24 px-3 py-1.5 rounded-lg border text-sm ${t.borderMed} ${t.bgCard} ${t.text} outline-none focus:border-pink-500`}
            />
            <label className={`text-sm ${t.textMuted}`}>Alto (mm)</label>
            <input
              type="number" min="25" max="600" step="1"
              value={customHmm}
              onChange={e => set('paper_h_in', mmToIn(+e.target.value))}
              className={`w-24 px-3 py-1.5 rounded-lg border text-sm ${t.borderMed} ${t.bgCard} ${t.text} outline-none focus:border-pink-500`}
            />
          </div>
        )}
      </Section>

      {/* ── Orientación ── */}
      <Section t={t} title="Orientación">
        <div className="flex items-start gap-6">
          {/* Controles */}
          <div className="flex gap-3">
            {[
              { id: 'portrait',  icon: '▯', label: 'Vertical' },
              { id: 'landscape', icon: '▭', label: 'Horizontal' },
            ].map(o => (
              <button
                key={o.id}
                onClick={() => set('orientation', o.id)}
                className={`flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl border text-sm font-semibold transition-all
                  ${cfg.orientation === o.id
                    ? 'border-pink-500 bg-pink-500/10 text-pink-400'
                    : `${t.borderMed} ${t.bgCard} ${t.textMuted} ${t.bgHover}`}`}
              >
                <span className="text-2xl leading-none">{o.icon}</span>
                {o.label}
              </button>
            ))}
          </div>

          {/* Diagrama de papel */}
          <div className="flex flex-col items-center gap-1 ml-4">
            <div
              className="relative rounded border-2 border-dashed border-white/20 bg-white/5 flex-shrink-0"
              style={{ width: previewW, height: previewH }}
            >
              {/* Área imprimible */}
              <div
                className="absolute border border-pink-400/50 border-dashed rounded-sm"
                style={{
                  top: mTop, left: mLeft,
                  right: mRight, bottom: mBot,
                }}
              />
              {/* Icono tira */}
              <div
                className="absolute inset-0 flex items-center justify-center text-white/10 font-black text-lg pointer-events-none"
                style={{ top: mTop + 2, left: mLeft + 2, right: mRight + 2, bottom: mBot + 2 }}
              >
                ▮
              </div>
            </div>
            <span className={`text-xs ${t.textFaint}`}>
              {isLandscape
                ? `${inToMm(cfg.paper_h_in)} × ${inToMm(cfg.paper_w_in)} mm`
                : `${inToMm(cfg.paper_w_in)} × ${inToMm(cfg.paper_h_in)} mm`}
            </span>
          </div>
        </div>
      </Section>

      {/* ── Márgenes ── */}
      <Section t={t} title="Márgenes (mm)">
        <div className="grid grid-cols-2 gap-4">
          {[
            { key: 'margin_top_mm',    label: 'Superior ↑' },
            { key: 'margin_bottom_mm', label: 'Inferior ↓' },
            { key: 'margin_left_mm',   label: 'Izquierdo ←' },
            { key: 'margin_right_mm',  label: 'Derecho →' },
          ].map(m => (
            <div key={m.key}>
              <label className={`text-xs font-semibold ${t.textMuted} block mb-1`}>{m.label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="range" min="0" max="50" step="1"
                  value={cfg[m.key]}
                  onChange={e => set(m.key, +e.target.value)}
                  className="flex-1 accent-pink-500"
                />
                <input
                  type="number" min="0" max="50" step="1"
                  value={cfg[m.key]}
                  onChange={e => set(m.key, Math.max(0, Math.min(50, +e.target.value)))}
                  className={`w-14 px-2 py-1 rounded-lg border text-sm text-center
                    ${t.borderMed} ${t.bgCard} ${t.text} outline-none focus:border-pink-500`}
                />
              </div>
            </div>
          ))}
        </div>
        <p className={`text-xs ${t.textFaint} mt-2`}>
          Las líneas punteadas de la vista previa reflejan estos márgenes.
        </p>
      </Section>

      {/* ── Copias ── */}
      <Section t={t} title="Número de copias">
        <div className="flex items-center gap-4">
          <button
            onClick={() => set('copies', Math.max(1, cfg.copies - 1))}
            className={`w-9 h-9 rounded-full text-lg font-bold border ${t.borderMed}
              ${t.bgCard} ${t.textMuted} ${t.bgHover} transition-colors`}
          >−</button>
          <span className={`text-3xl font-black w-12 text-center ${t.text}`}>{cfg.copies}</span>
          <button
            onClick={() => set('copies', Math.min(10, cfg.copies + 1))}
            className={`w-9 h-9 rounded-full text-lg font-bold border ${t.borderMed}
              ${t.bgCard} ${t.textMuted} ${t.bgHover} transition-colors`}
          >+</button>
          <span className={`text-sm ${t.textFaint}`}>copia{cfg.copies !== 1 ? 's' : ''} por sesión</span>
        </div>
      </Section>

      {/* ── Botón guardar ── */}
      <div className="flex items-center gap-4 pb-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all
            ${saving
              ? 'bg-pink-500/40 text-pink-300 cursor-wait'
              : 'bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-500/20'}`}
        >
          {saving ? 'Guardando…' : '💾 Guardar configuración'}
        </button>
        {status === 'ok'  && <span className="text-emerald-400 text-sm font-semibold">✓ Guardado</span>}
        {status === 'err' && <span className="text-red-400 text-sm font-semibold">✗ Error al guardar</span>}
      </div>
    </div>
  )
}

// ── Sub-componente sección ────────────────────────────────────────────────────
function Section({ t, title, children }) {
  return (
    <div className={`rounded-2xl border ${t.border} ${t.bgCard} p-5 space-y-4`}>
      <h3 className={`text-sm font-bold uppercase tracking-widest ${t.textFaint}`}>{title}</h3>
      {children}
    </div>
  )
}
