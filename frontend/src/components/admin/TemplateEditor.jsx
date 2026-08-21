import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '../../ThemeContext'

const API = 'http://localhost:8766'
const CANVAS_MAX_W = 520   // ancho máximo del canvas en pantalla (px)
const MIN_SLOT_PX  = 20    // tamaño mínimo de un slot en coords de plantilla

// Colores por photoIndex (1-based, cicla si hay más de 10)
const SLOT_COLORS = [
  '#ec4899', // 1 - rosa
  '#3b82f6', // 2 - azul
  '#22c55e', // 3 - verde
  '#f97316', // 4 - naranja
  '#a855f7', // 5 - violeta
  '#14b8a6', // 6 - teal
  '#f59e0b', // 7 - ámbar
  '#ef4444', // 8 - rojo
  '#06b6d4', // 9 - cian
  '#84cc16', // 10 - lima
]
const slotColor = (idx) => SLOT_COLORS[((idx - 1) % SLOT_COLORS.length + SLOT_COLORS.length) % SLOT_COLORS.length]

// Posición CSS de cada handle de redimensión
const handleCss = (h) => {
  const base = { position: 'absolute', width: 9, height: 9, background: '#fff',
                 border: '1.5px solid #555', borderRadius: 2, zIndex: 20 }
  const pos = {}
  if (h.includes('n')) pos.top = -5
  if (h.includes('s')) pos.bottom = -5
  if (h.includes('w')) pos.left = -5
  if (h.includes('e')) pos.right = -5
  if (h === 'n' || h === 's') { pos.left = '50%'; pos.transform = 'translateX(-50%)' }
  if (h === 'e' || h === 'w') { pos.top  = '50%'; pos.transform = 'translateY(-50%)' }
  const cursors = { nw:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize', se:'nwse-resize',
                    n:'ns-resize', s:'ns-resize', w:'ew-resize', e:'ew-resize' }
  pos.cursor = cursors[h]
  return { ...base, ...pos }
}

// ── Nuevo panel de plantilla ──────────────────────────────────────────────────
function NewTemplatePanel({ onCreate }) {
  const { t } = useTheme()
  const [name,   setName]   = useState('')
  const [width,  setWidth]  = useState(800)
  const [height, setHeight] = useState(1200)
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)

  const handleCreate = async () => {
    if (!name.trim()) { setErr('El nombre es requerido'); return }
    setSaving(true); setErr(null)
    try {
      const r = await fetch(`${API}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), width: +width, height: +height }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      onCreate(j)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <motion.div className="w-full max-w-sm" initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }}>
        <h2 className={`${t.text} font-black text-2xl mb-1`}>Nueva plantilla</h2>
        <p className={`${t.textFaint} text-sm mb-6`}>
          Define el lienzo. Después agregas los huecos de foto arrastrando sobre él.
        </p>
        <div className="flex flex-col gap-4">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${t.textFaint}`}>
              Nombre
            </label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Ej. Tira 3 fotos, Collage 6…"
              className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none ${t.input}`} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${t.textFaint}`}>
                Ancho (px)
              </label>
              <input type="number" value={width} onChange={e => setWidth(+e.target.value)}
                min={50} max={8000}
                className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none ${t.input}`} />
            </div>
            <div className="flex-1">
              <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${t.textFaint}`}>
                Alto (px)
              </label>
              <input type="number" value={height} onChange={e => setHeight(+e.target.value)}
                min={50} max={8000}
                className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none ${t.input}`} />
            </div>
          </div>
          {err && <p className="text-red-400 text-xs">⚠️ {err}</p>}
          <motion.button
            onClick={handleCreate} disabled={saving || !name.trim()}
            className={`rounded-xl py-2.5 font-bold text-sm text-white transition-all
              ${saving || !name.trim() ? 'bg-pink-600/40 cursor-not-allowed' : 'bg-pink-600 hover:bg-pink-500 shadow-lg shadow-pink-500/20'}`}
            whileTap={{ scale: 0.97 }}
          >
            {saving ? 'Creando…' : '+ Crear plantilla'}
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Editor principal ──────────────────────────────────────────────────────────
export default function TemplateEditor({ template, onSaved, onDeleted }) {
  const { t } = useTheme()
  const containerRef     = useRef(null)
  const bgInputRef       = useRef(null)
  const wrapperRef       = useRef(null)
  const effectiveScaleRef = useRef(1)
  const slotsRef         = useRef([])    // siempre actualizado → para handlers de mouse

  const [name,        setName]        = useState(template.name)
  const [slots,       setSlots]       = useState(template.slots || [])
  const [selected,    setSelected]    = useState(null)     // slot id
  const [creating,    setCreating]    = useState(null)     // { x, y, w, h }
  const [bgTs,        setBgTs]        = useState(Date.now()) // fuerza reload imagen fondo
  const [saving,      setSaving]      = useState(false)
  const [saveStatus,  setSaveStatus]  = useState(null)
  const [bgUploading, setBgUploading] = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [bgRemoving,  setBgRemoving]  = useState(false)
  const [hasBg,       setHasBg]       = useState(template.background)
  const [clipboard,   setClipboard]   = useState(null)  // slot copiado
  const [zoom,        setZoom]        = useState(1.0)

  // Mantener ref sincronizado
  useEffect(() => { slotsRef.current = slots }, [slots])

  // Reset cuando cambia la plantilla
  useEffect(() => {
    setName(template.name)
    setSlots(template.slots || [])
    setSelected(null)
    setCreating(null)
    setHasBg(template.background)
    setBgTs(Date.now())
    setZoom(1.0)
  }, [template.id])

  // Escala de visualización
  const scale         = CANVAS_MAX_W / template.width
  const displayW      = CANVAS_MAX_W
  const displayH      = Math.round(template.height * scale)
  const effectiveScale = scale * zoom
  effectiveScaleRef.current = effectiveScale
  const canvasW       = Math.round(displayW * zoom)
  const canvasH       = Math.round(displayH * zoom)

  // Slot seleccionado
  const selectedSlot = slots.find(s => s.id === selected) ?? null

  // Max photoIndex actual
  const maxPhotoIndex = slots.reduce((m, s) => Math.max(m, s.photoIndex), 0)

  // ── Coords: cliente → espacio de plantilla ────────────────────────────────
  const clientToTpl = useCallback((cx, cy) => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.round((cx - rect.left) / effectiveScaleRef.current),
      y: Math.round((cy - rect.top)  / effectiveScaleRef.current),
    }
  }, [])

  // Referencia de interacción activa (evita closures stale en mousemove global)
  const iaRef = useRef(null)

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleCanvasMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    if (e.target !== containerRef.current) return  // solo en fondo vacío
    e.preventDefault()
    setSelected(null)
    const { x, y } = clientToTpl(e.clientX, e.clientY)
    const cx = Math.max(0, Math.min(template.width,  x))
    const cy = Math.max(0, Math.min(template.height, y))
    iaRef.current = { type: 'create', startX: cx, startY: cy }
    setCreating({ x: cx, y: cy, w: 0, h: 0 })
  }, [clientToTpl, template.width, template.height])

  const handleSlotMouseDown = useCallback((e, slotId) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    setSelected(slotId)
    const { x, y } = clientToTpl(e.clientX, e.clientY)
    const slot = slotsRef.current.find(s => s.id === slotId)
    if (!slot) return
    iaRef.current = { type: 'drag', slotId, offsetX: x - slot.x, offsetY: y - slot.y }
  }, [clientToTpl])

  const handleResizeMouseDown = useCallback((e, slotId, handle) => {
    e.preventDefault(); e.stopPropagation()
    const slot = slotsRef.current.find(s => s.id === slotId)
    if (!slot) return
    iaRef.current = {
      type: 'resize', slotId, handle,
      origSlot: { ...slot },
      startX: Math.round(e.clientX / effectiveScaleRef.current),
      startY: Math.round(e.clientY / effectiveScaleRef.current),
    }
  }, [])

  // Listener global de mousemove/mouseup
  useEffect(() => {
    const onMove = (e) => {
      const ia = iaRef.current
      if (!ia) return

      if (ia.type === 'create') {
        const { x, y } = clientToTpl(e.clientX, e.clientY)
        const cx = Math.max(0, Math.min(template.width,  x))
        const cy = Math.max(0, Math.min(template.height, y))
        const sx = Math.min(ia.startX, cx)
        const sy = Math.min(ia.startY, cy)
        setCreating({ x: sx, y: sy, w: Math.abs(cx - ia.startX), h: Math.abs(cy - ia.startY) })
      } else if (ia.type === 'drag') {
        const { x, y } = clientToTpl(e.clientX, e.clientY)
        setSlots(prev => prev.map(s => {
          if (s.id !== ia.slotId) return s
          return {
            ...s,
            x: Math.max(0, Math.min(template.width  - s.w, x - ia.offsetX)),
            y: Math.max(0, Math.min(template.height - s.h, y - ia.offsetY)),
          }
        }))
      } else if (ia.type === 'resize') {
        const dx = Math.round(e.clientX / effectiveScaleRef.current) - ia.startX
        const dy = Math.round(e.clientY / effectiveScaleRef.current) - ia.startY
        const o  = ia.origSlot
        setSlots(prev => prev.map(s => {
          if (s.id !== ia.slotId) return s
          let { x: sx, y: sy, w: sw, h: sh } = o
          if (ia.handle.includes('e')) sw = Math.max(MIN_SLOT_PX, o.w + dx)
          if (ia.handle.includes('s')) sh = Math.max(MIN_SLOT_PX, o.h + dy)
          if (ia.handle.includes('w')) {
            sw = Math.max(MIN_SLOT_PX, o.w - dx); sx = o.x + o.w - sw
          }
          if (ia.handle.includes('n')) {
            sh = Math.max(MIN_SLOT_PX, o.h - dy); sy = o.y + o.h - sh
          }
          sx = Math.max(0, sx); sy = Math.max(0, sy)
          sw = Math.min(sw, template.width  - sx)
          sh = Math.min(sh, template.height - sy)
          return { ...s, x: sx, y: sy, w: sw, h: sh }
        }))
      }
    }

    const onUp = (e) => {
      const ia = iaRef.current
      if (!ia) return
      if (ia.type === 'create') {
        const { x, y } = clientToTpl(e.clientX, e.clientY)
        const cx = Math.max(0, Math.min(template.width,  x))
        const cy = Math.max(0, Math.min(template.height, y))
        const sw = Math.abs(cx - ia.startX)
        const sh = Math.abs(cy - ia.startY)
        if (sw >= MIN_SLOT_PX && sh >= MIN_SLOT_PX) {
          const newId = Math.random().toString(36).slice(2)
          setSlots(prev => {
            const maxIdx = prev.reduce((m, s) => Math.max(m, s.photoIndex), 0)
            return [...prev, {
              id: newId,
              photoIndex: maxIdx + 1,
              x: Math.min(ia.startX, cx),
              y: Math.min(ia.startY, cy),
              w: sw, h: sh,
            }]
          })
          setSelected(newId)
        }
        setCreating(null)
      }
      iaRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [clientToTpl, template.width, template.height])

  // ── Zoom con Ctrl + rueda del ratón ───────────────────────────────────────
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = wrapper.getBoundingClientRect()
      const relX  = e.clientX - rect.left
      const relY  = e.clientY - rect.top
      const cvsX  = relX + wrapper.scrollLeft
      const cvsY  = relY + wrapper.scrollTop
      setZoom(prev => {
        const factor  = e.deltaY < 0 ? 1.12 : 1 / 1.12
        const newZoom = Math.max(0.25, Math.min(4.0, prev * factor))
        const ratio   = newZoom / prev
        requestAnimationFrame(() => {
          if (!wrapperRef.current) return
          wrapperRef.current.scrollLeft = cvsX * ratio - relX
          wrapperRef.current.scrollTop  = cvsY * ratio - relY
        })
        return newZoom
      })
    }
    wrapper.addEventListener('wheel', onWheel, { passive: false })
    return () => wrapper.removeEventListener('wheel', onWheel)
  }, [])

  // ── Atajos de teclado Ctrl+C / Ctrl+V / Delete / Flechas ─────────────────
  useEffect(() => {
    const onKey = (e) => {
      // No interferir si el foco está en un input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selected) copySlot(selected)
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        pasteSlot()
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        setZoom(1.0)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected) deleteSlot(selected)
      } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        if (!selected) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1   // Shift = pasos de 10px
        setSlots(prev => prev.map(s => {
          if (s.id !== selected) return s
          let { x, y } = s
          if (e.key === 'ArrowLeft')  x = Math.max(0, x - step)
          if (e.key === 'ArrowRight') x = Math.min(template.width  - s.w, x + step)
          if (e.key === 'ArrowUp')    y = Math.max(0, y - step)
          if (e.key === 'ArrowDown')  y = Math.min(template.height - s.h, y + step)
          return { ...s, x, y }
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, clipboard, template.width, template.height])

  // ── Helper: zoom centrado en el área visible ──────────────────────────────
  const zoomBy = useCallback((factor) => {
    const wrapper = wrapperRef.current
    setZoom(prev => {
      const newZoom = Math.max(0.25, Math.min(4.0, prev * factor))
      if (wrapper) {
        const ratio = newZoom / prev
        const cx = wrapper.scrollLeft + wrapper.clientWidth  / 2
        const cy = wrapper.scrollTop  + wrapper.clientHeight / 2
        requestAnimationFrame(() => {
          if (!wrapperRef.current) return
          wrapperRef.current.scrollLeft = cx * ratio - wrapperRef.current.clientWidth  / 2
          wrapperRef.current.scrollTop  = cy * ratio - wrapperRef.current.clientHeight / 2
        })
      }
      return newZoom
    })
  }, [])

  // ── Acciones de slots ─────────────────────────────────────────────────────
  const deleteSlot = (slotId) => {
    setSlots(prev => prev.filter(s => s.id !== slotId))
    if (selected === slotId) setSelected(null)
  }

  const copySlot = (slotId) => {
    const slot = slotsRef.current.find(s => s.id === slotId)
    if (slot) setClipboard(slot)
  }

  const pasteSlot = () => {
    if (!clipboard) return
    const offset = 20  // desplazamiento para que no quede exactamente encima
    const newId  = Math.random().toString(36).slice(2)
    const nx = Math.min(clipboard.x + offset, template.width  - clipboard.w)
    const ny = Math.min(clipboard.y + offset, template.height - clipboard.h)
    const newSlot = { ...clipboard, id: newId, x: Math.max(0, nx), y: Math.max(0, ny) }
    setSlots(prev => [...prev, newSlot])
    setSelected(newId)
  }

  const updateSlotPhotoIndex = (slotId, val) => {
    const n = Math.max(1, Math.min(20, parseInt(val) || 1))
    setSlots(prev => prev.map(s => s.id === slotId ? { ...s, photoIndex: n } : s))
  }

  // ── Guardar nombre + slots ────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true); setSaveStatus(null)
    try {
      const r = await fetch(`${API}/api/templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slots }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setSaveStatus('ok')
      onSaved(j)
      setTimeout(() => setSaveStatus(null), 2500)
    } catch {
      setSaveStatus('err')
    } finally {
      setSaving(false) }
  }

  // ── Subir fondo ───────────────────────────────────────────────────────────
  const handleBgUpload = async (file) => {
    if (!file) return
    setBgUploading(true)
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await fetch(`${API}/api/templates/${template.id}/background`, { method:'POST', body: fd })
      const j = await r.json()
      if (j.background !== undefined) setHasBg(j.background)
      setBgTs(Date.now())
      onSaved(j)
    } finally { setBgUploading(false) }
  }

  const handleBgRemove = async () => {
    setBgRemoving(true)
    try {
      await fetch(`${API}/api/templates/${template.id}/background`, { method:'DELETE' })
      setHasBg(false); setBgTs(Date.now())
      onSaved({ ...template, background: false })
    } finally { setBgRemoving(false) }
  }

  // ── Eliminar plantilla ────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!window.confirm(`¿Eliminar la plantilla "${template.name}"?\nLos eventos que la usen perderán su plantilla.`)) return
    setDeleting(true)
    try {
      await fetch(`${API}/api/templates/${template.id}`, { method:'DELETE' })
      onDeleted(template.id)
    } finally { setDeleting(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ── Cabecera: nombre + guardar ── */}
        <div className="flex items-center gap-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none ${t.input}`}
            placeholder="Nombre de la plantilla"
          />
          <motion.button
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all
              ${saving ? 'bg-pink-600/40 text-pink-300 cursor-wait'
                       : 'bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-500/20'}`}
            whileTap={{ scale: 0.97 }}
          >
            {saving ? 'Guardando…' : '💾 Guardar'}
          </motion.button>
          {saveStatus === 'ok'  && <span className="text-emerald-400 text-sm font-semibold">✓</span>}
          {saveStatus === 'err' && <span className="text-red-400 text-sm font-semibold">✗ Error</span>}
        </div>

        {/* ── Info huecos ── */}
        {slots.length > 0 && (
          <div className={`flex flex-wrap gap-2 px-4 py-2 rounded-xl border ${t.borderFaint} ${t.bgSection}`}>
            <span className={`text-xs ${t.textFaint}`}>
              {slots.length} {slots.length === 1 ? 'hueco' : 'huecos'} ·
              necesita <strong className={t.textMuted}>{maxPhotoIndex} foto{maxPhotoIndex !== 1 ? 's' : ''}</strong> por sesión
            </span>
            {Array.from(new Set(slots.map(s => s.photoIndex))).sort((a,b)=>a-b).map(pi => (
              <span key={pi} className="text-xs px-2 py-0.5 rounded-full font-bold"
                    style={{ background: slotColor(pi) + '33', color: slotColor(pi), border: `1px solid ${slotColor(pi)}55` }}>
                📷{pi}
              </span>
            ))}
          </div>
        )}

        {/* ── Área principal: canvas + sidebar ── */}
        <div className="flex gap-5 items-start">

          {/* Canvas interactivo */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <p className={`text-xs flex-1 ${t.textFaint}`}>
                Arrastra para crear huecos · Clic para seleccionar · Esquinas para redimensionar · <kbd className="px-1 rounded border border-white/10">↑↓←→</kbd> mover · <kbd className="px-1 rounded border border-white/10">Ctrl+rueda</kbd> zoom
              </p>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => zoomBy(1 / 1.12)}
                  title="Alejar (Ctrl+rueda↓)"
                  className={`w-6 h-6 rounded border ${t.borderMed} ${t.bgCard} ${t.textMuted} ${t.bgHover} text-sm font-bold leading-none`}
                >−</button>
                <span className={`text-xs font-mono ${t.textMuted} w-10 text-center tabular-nums`}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => zoomBy(1.12)}
                  title="Acercar (Ctrl+rueda↑)"
                  className={`w-6 h-6 rounded border ${t.borderMed} ${t.bgCard} ${t.textMuted} ${t.bgHover} text-sm font-bold leading-none`}
                >+</button>
                {zoom !== 1.0 && (
                  <button
                    onClick={() => setZoom(1.0)}
                    title="Restablecer zoom (Ctrl+0)"
                    className={`px-2 h-6 rounded border ${t.borderFaint} ${t.textFaint} ${t.bgHover} text-xs`}
                  >↺</button>
                )}
              </div>
            </div>
            <div
              ref={wrapperRef}
              className="rounded-xl border border-white/10 overflow-auto"
              style={{ width: displayW, maxHeight: 'min(72vh, 680px)' }}
            >
            <div
              ref={containerRef}
              onMouseDown={handleCanvasMouseDown}
              className="relative overflow-hidden flex-shrink-0"
              style={{
                width:  canvasW,
                height: canvasH,
                background: '#1a1a1a',
                cursor: 'crosshair',
                userSelect: 'none',
              }}
            >
              {/* Grid tenue si no hay marco */}
              {!hasBg && (
                <div style={{
                  position:'absolute', inset:0, pointerEvents:'none',
                  backgroundImage: `linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
                                    linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)`,
                  backgroundSize: `${20 * effectiveScale}px ${20 * effectiveScale}px`,
                }} />
              )}

              {/* Slots (capa inferior — debajo del marco) */}
              {slots.map(slot => {
                const color = slotColor(slot.photoIndex)
                const isSelected = slot.id === selected
                return (
                  <div
                    key={slot.id}
                    onMouseDown={e => handleSlotMouseDown(e, slot.id)}
                    style={{
                      position: 'absolute',
                      left:   slot.x * effectiveScale,
                      top:    slot.y * effectiveScale,
                      width:  slot.w * effectiveScale,
                      height: slot.h * effectiveScale,
                      border: `2px solid ${isSelected ? color : color + 'aa'}`,
                      background: color + (isSelected ? '28' : '12'),
                      boxSizing: 'border-box',
                      cursor: 'move',
                      outline: isSelected ? `2px solid ${color}` : 'none',
                      outlineOffset: 2,
                      zIndex: isSelected ? 10 : 2,
                    }}
                  >
                    {/* Badge foto # */}
                    <div style={{
                      position:'absolute', top:3, left:3,
                      background: color, color:'#fff', borderRadius:4,
                      padding:'1px 6px', fontSize:11, fontWeight:'bold',
                      lineHeight:'1.4', userSelect:'none', whiteSpace:'nowrap',
                    }}>
                      📷 {slot.photoIndex}
                    </div>

                    {/* Handles de redimensión (solo cuando seleccionado) */}
                    {isSelected && ['nw','n','ne','e','se','s','sw','w'].map(h => (
                      <div
                        key={h}
                        style={handleCss(h)}
                        onMouseDown={e => handleResizeMouseDown(e, slot.id, h)}
                      />
                    ))}
                  </div>
                )
              })}

              {/* Slot en creación */}
              {creating && creating.w > 0 && creating.h > 0 && (
                <div style={{
                  position: 'absolute',
                  left:   creating.x * effectiveScale,
                  top:    creating.y * effectiveScale,
                  width:  creating.w * effectiveScale,
                  height: creating.h * effectiveScale,
                  border: '2px dashed #ec4899',
                  background: '#ec489922',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }} />
              )}

              {/* Marco/overlay encima de los huecos (mismo orden que la tira final) */}
              {hasBg && (
                <img
                  src={`${API}/api/templates/${template.id}/background?t=${bgTs}`}
                  alt="marco"
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    objectFit: 'fill', pointerEvents: 'none', zIndex: 5,
                  }}
                />
              )}

              {/* Hint vacío */}
              {slots.length === 0 && !creating && (
                <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
                              alignItems:'center', justifyContent:'center', gap:8, pointerEvents:'none' }}>
                  <span style={{ fontSize:32, opacity:.25 }}>📷</span>
                  <p style={{ color:'rgba(255,255,255,.2)', fontSize:13, textAlign:'center', padding:'0 20px' }}>
                    Arrastra aquí para crear un hueco de foto
                  </p>
                </div>
              )}
            </div>
            </div>

            {/* Dimensiones en footer */}
            <p className={`text-xs text-center ${t.textFaint}`}>
              {template.width}×{template.height} px · zoom {Math.round(zoom * 100)}%
            </p>
          </div>

          {/* Sidebar: slot seleccionado + lista */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* Detalle del slot seleccionado */}
            <div className={`rounded-2xl border ${t.border} ${t.bgCard} p-4`}>
              {selectedSlot ? (
                <>
                  <h3 className={`text-xs font-bold uppercase tracking-wider ${t.textFaint} mb-3`}>Hueco seleccionado</h3>
                  <div className="space-y-3">
                    {/* Foto # */}
                    <div>
                      <label className={`text-xs font-semibold ${t.textMuted} block mb-1.5`}>
                        Foto número
                        <span className={`font-normal ml-1 ${t.textFaint}`}>(misma foto en varios huecos = repetida)</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateSlotPhotoIndex(selectedSlot.id, selectedSlot.photoIndex - 1)}
                          className={`w-7 h-7 rounded-lg text-base font-bold border ${t.borderMed} ${t.bgCard} ${t.textMuted} ${t.bgHover}`}
                        >−</button>
                        <input
                          type="number" min="1" max="20"
                          value={selectedSlot.photoIndex}
                          onChange={e => updateSlotPhotoIndex(selectedSlot.id, e.target.value)}
                          className={`w-14 px-2 py-1 rounded-lg border text-sm text-center font-bold
                            ${t.borderMed} ${t.bgCard} ${t.text} outline-none focus:border-pink-500`}
                          style={{ color: slotColor(selectedSlot.photoIndex) }}
                        />
                        <button
                          onClick={() => updateSlotPhotoIndex(selectedSlot.id, selectedSlot.photoIndex + 1)}
                          className={`w-7 h-7 rounded-lg text-base font-bold border ${t.borderMed} ${t.bgCard} ${t.textMuted} ${t.bgHover}`}
                        >+</button>
                        <span className="text-lg" style={{ color: slotColor(selectedSlot.photoIndex) }}>●</span>
                      </div>
                    </div>
                    {/* Info posición / tamaño */}
                    <div className={`text-xs ${t.textFaint} space-y-1 font-mono`}>
                      <div>Posición: {selectedSlot.x}, {selectedSlot.y} px</div>
                      <div>Tamaño: {selectedSlot.w} × {selectedSlot.h} px</div>
                    </div>
                    {/* Copiar / Eliminar */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => copySlot(selectedSlot.id)}
                        className={`flex-1 py-1.5 rounded-lg border ${t.borderFaint} ${t.textMuted} ${t.bgHover} text-xs font-semibold transition-colors`}
                      >
                        📋 Copiar hueco
                      </button>
                      <button
                        onClick={() => deleteSlot(selectedSlot.id)}
                        className="flex-1 py-1.5 rounded-lg border border-red-500/30 text-red-400
                                   hover:bg-red-500/10 text-xs font-semibold transition-colors"
                      >
                        🗑 Eliminar
                      </button>
                    </div>
                    {clipboard && (
                      <button
                        onClick={pasteSlot}
                        className="w-full py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400
                                   hover:bg-emerald-500/10 text-xs font-semibold transition-colors"
                      >
                        📌 Pegar copia (📷{clipboard.photoIndex} · {clipboard.w}×{clipboard.h})
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className={`text-center py-4 ${t.textFaint} text-xs`}>
                  <p className="text-xl mb-2">↖</p>
                  <p>Haz clic en un hueco para editarlo</p>
                  <p className="mt-1">o arrastra en el canvas para crear uno nuevo</p>
                  {clipboard && (
                    <button
                      onClick={pasteSlot}
                      className="mt-3 w-full py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400
                                 hover:bg-emerald-500/10 text-xs font-semibold transition-colors"
                    >
                      📌 Pegar copia (📷{clipboard.photoIndex} · {clipboard.w}×{clipboard.h})
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Lista de todos los slots */}
            {slots.length > 0 && (
              <div className={`rounded-2xl border ${t.border} ${t.bgCard} p-4`}>
                <h3 className={`text-xs font-bold uppercase tracking-wider ${t.textFaint} mb-3`}>
                  Todos los huecos ({slots.length})
                </h3>
                <div className="space-y-1.5">
                  {slots.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => setSelected(s.id)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs
                        transition-colors text-left
                        ${s.id === selected
                          ? `border ${t.borderMed} ${t.bgSection}`
                          : `border border-transparent ${t.bgHover}`}`}
                    >
                      <span className="w-4 h-4 rounded-sm flex-shrink-0"
                            style={{ background: slotColor(s.photoIndex) + '55', border:`1px solid ${slotColor(s.photoIndex)}` }} />
                      <span className={`font-semibold ${t.textMuted}`}>#{i + 1}</span>
                      <span className={`flex-1 ${t.textFaint}`}>{s.w}×{s.h}</span>
                      <span className="font-bold" style={{ color: slotColor(s.photoIndex) }}>📷{s.photoIndex}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Controles de fondo ── */}
        <div className={`rounded-2xl border ${t.border} ${t.bgCard} p-4 flex items-center gap-4`}>
          <div className="flex-1">
            <h3 className={`text-xs font-bold uppercase tracking-wider ${t.textFaint} mb-1`}>Marco / overlay</h3>
            <p className={`text-xs ${t.textFaint}`}>
              Se coloca encima de las fotos. Usa PNG con transparencias en los huecos.
              Se redimensiona a {template.width}×{template.height} px.
            </p>
          </div>
          <input ref={bgInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => handleBgUpload(e.target.files[0])} />
          {hasBg && (
            <div className="w-16 h-10 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
              <img src={`${API}/api/templates/${template.id}/background?t=${bgTs}`}
                   alt="fondo" className="w-full h-full object-cover" />
            </div>
          )}
          {hasBg ? (
            <button
              onClick={handleBgRemove} disabled={bgRemoving}
              className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400
                         hover:bg-red-500/10 text-xs font-semibold transition-colors"
            >
              {bgRemoving ? '…' : '🗑 Quitar marco'}
            </button>
          ) : null}
          <button
            onClick={() => bgInputRef.current?.click()} disabled={bgUploading}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all
              ${bgUploading ? 'opacity-50 cursor-wait' : ''}
              border ${t.borderMed} ${t.bgCard} ${t.textMuted} ${t.bgHover}`}
          >
            {bgUploading ? 'Subiendo…' : hasBg ? '↑ Cambiar marco' : '↑ Subir marco'}
          </button>
        </div>

        {/* ── Zona peligrosa ── */}
        <div className={`rounded-2xl border p-4 ${t.dangerZone}`}>
          <p className={`text-xs font-semibold uppercase tracking-wide ${t.textMuted} mb-3`}>Zona peligrosa</p>
          <button
            onClick={handleDelete} disabled={deleting}
            className="px-4 py-2 rounded-xl border border-red-500/20 bg-red-600/20
                       hover:bg-red-600/40 text-red-400 text-sm font-semibold transition-colors"
          >
            {deleting ? 'Eliminando…' : '🗑 Eliminar plantilla'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Props: (template=null) → modo selección de nueva plantilla
TemplateEditor.NewPanel = NewTemplatePanel
