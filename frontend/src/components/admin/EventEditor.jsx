import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '../../ThemeContext'

const API = 'http://localhost:8766'
const eventUrl = (id, suffix = '') =>
  `${API}/api/events/${encodeURIComponent(id)}${suffix}`

// ── Sub-componentes ──────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  const { t } = useTheme()
  return (
    <div>
      <label className={`block ${t.label} text-xs font-semibold tracking-wide uppercase mb-1.5`}>
        {label}
        {hint && <span className={`normal-case font-normal ml-2 ${t.hint}`}>{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder, min, max }) {
  const { t } = useTheme()
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      className={`w-full rounded-xl px-4 py-2.5 text-sm
                 focus:outline-none transition-colors ${t.input}`}
    />
  )
}

function Btn({ children, onClick, variant = 'default', loading = false, disabled = false, small = false }) {
  const { t } = useTheme()
  const base = `rounded-xl font-semibold transition-all flex items-center justify-center gap-2
                ${small ? 'px-4 py-2 text-sm' : 'px-5 py-2.5 text-sm'}`
  const styles = {
    primary:  'bg-gradient-to-r from-pink-600 to-[#CC0000] hover:from-pink-500 hover:to-[#990000] text-white',
    green:    'bg-emerald-600/80 hover:bg-emerald-500 text-white',
    danger:   `bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20`,
    default:  `${t.bgCard} ${t.bgHover} ${t.textMuted} border ${t.borderMed}`,
    outline:  `border ${t.borderMed} ${t.bgHover} ${t.textMuted}`,
  }
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${styles[variant]} ${(disabled || loading) ? 'opacity-50 cursor-not-allowed' : ''}`}
      whileTap={!disabled && !loading ? { scale: 0.97 } : undefined}
    >
      {loading
        ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        : children}
    </motion.button>
  )
}

// ── Sección de plantilla ──────────────────────────────────────────────────────

function TemplateSection({ event, onSaved }) {
  const { t } = useTheme()
  const fileRef     = useRef(null)
  const [pending,   setPending]   = useState(null)   // File
  const [preview,   setPreview]   = useState(null)   // objectURL
  const [tplErr,    setTplErr]    = useState(null)
  const [uploading, setUploading] = useState(false)
  const [removing,  setRemoving]  = useState(false)
  const [dragOver,  setDragOver]  = useState(false)

  // Limpiar cuando cambia el evento
  useEffect(() => {
    setPending(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setTplErr(null)
  }, [event?.id])

  // Cleanup al desmontar
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [])

  const validate = (file) => {
    if (!file) return
    const isPng = file.name.toLowerCase().endsWith('.png') || file.type === 'image/png'
    if (!isPng) { setTplErr('Solo se aceptan archivos PNG'); return }

    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      if (img.width !== event.width || img.height !== event.height) {
        URL.revokeObjectURL(url)
        setTplErr(
          `La plantilla debe ser ${event.width}×${event.height} px.\n` +
          `Este archivo es ${img.width}×${img.height} px.`
        )
        setPending(null)
        setPreview(null)
        return
      }
      if (preview) URL.revokeObjectURL(preview)
      setTplErr(null)
      setPending(file)
      setPreview(url)
    }
    img.onerror = () => { URL.revokeObjectURL(url); setTplErr('No se pudo leer la imagen') }
    img.src = url
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) validate(file)
  }

  const handleUpload = async () => {
    if (!pending) return
    setUploading(true); setTplErr(null)
    try {
      const fd = new FormData()
      fd.append('file', pending)
      const r    = await fetch(eventUrl(event.id, '/template'), { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      onSaved(data, event.id)
      setPending(null)
      // preview stays to show uploaded image
    } catch (e) {
      setTplErr(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async () => {
    setRemoving(true)
    try {
      await fetch(eventUrl(event.id, '/template'), { method: 'DELETE' })
      onSaved({ ...event, hasTemplate: false }, event.id)
      setPending(null)
      if (preview) { URL.revokeObjectURL(preview); setPreview(null) }
    } finally {
      setRemoving(false)
    }
  }

  const tplSrc = preview
    ? preview
    : event.hasTemplate
      ? `${eventUrl(event.id, '/template')}?t=${Date.now()}`
      : null

  const hasTpl = event.hasTemplate || pending

  return (
    <div>
      <label className={`block ${t.label} text-xs font-semibold tracking-wide uppercase mb-1.5`}>
        Plantilla overlay
        <span className={`normal-case font-normal ml-2 ${t.hint}`}>PNG con transparencia</span>
      </label>

      {/* Requerimiento de dimensiones */}
      <p className={`${t.hint} text-xs mb-3`}>
        Debe ser exactamente <span className={`${t.textMuted} font-mono`}>{event.width}×{event.height} px</span> en formato PNG
      </p>

      <div className="flex gap-4 items-start">
        {/* Drop zone / thumbnail */}
        <div
          className={`relative w-32 h-32 rounded-xl border-2 flex-shrink-0 overflow-hidden
            transition-all cursor-pointer
            ${dragOver
              ? 'border-pink-500 bg-pink-500/10'
              : hasTpl
                ? `border-black/20 dark:border-white/20`
                : `border-dashed ${t.borderMed} ${t.bgSection}`
            }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true)  }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {tplSrc ? (
            <>
              <img src={tplSrc} alt="plantilla" className="w-full h-full object-cover" />
              {/* Checkerboard hint for transparency */}
              <div className="absolute inset-0 bg-[image:repeating-conic-gradient(#ffffff10_0%_25%,transparent_0%_50%)]
                              bg-[length:8px_8px] -z-10" />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-1.5 p-2">
              <span className="text-2xl opacity-40">🖼️</span>
              <p className={`${t.textUltra} text-xs text-center leading-tight`}>
                Haz clic o arrastra un PNG
              </p>
            </div>
          )}
        </div>

        <input ref={fileRef} type="file" accept=".png,image/png" className="hidden"
          onChange={e => { if (e.target.files[0]) validate(e.target.files[0]) }} />

        {/* Acciones */}
        <div className="flex flex-col gap-2 flex-1">
          {pending && (
            <Btn variant="primary" onClick={handleUpload} loading={uploading} small>
              ↑ Subir plantilla
            </Btn>
          )}
          {pending && (
            <Btn variant="outline" onClick={() => { setPending(null); URL.revokeObjectURL(preview); setPreview(null) }} small>
              Cancelar
            </Btn>
          )}
          {event.hasTemplate && !pending && (
            <Btn variant="danger" onClick={handleRemove} loading={removing} small>
              🗑 Quitar plantilla
            </Btn>
          )}
          {!hasTpl && !pending && (
            <Btn variant="default" onClick={() => fileRef.current?.click()} small>
              Elegir archivo…
            </Btn>
          )}
        </div>
      </div>

      {/* Error de plantilla */}
      <AnimatePresence>
        {tplErr && (
          <motion.p
            className="mt-2 text-red-400 text-xs leading-snug whitespace-pre-line"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            ⚠️ {tplErr}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Editor principal ──────────────────────────────────────────────────────────

export default function EventEditor({ event, activeId, onSaved, onDeleted, onActivated, templates = [] }) {
  const { t } = useTheme()
  const [name,       setName]       = useState('')
  const [width,      setWidth]      = useState(600)
  const [height,     setHeight]     = useState(600)
  const [photoCount, setPhotoCount] = useState(3)
  const [timerSecs,  setTimerSecs]  = useState(3)
  const [templateId, setTemplateId] = useState(null)   // id de plantilla interactiva
  const [ingestUrl,  setIngestUrl]  = useState('')     // ECA360 carousel ingest

  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [activating, setActivating] = useState(false)
  const [error,      setError]      = useState(null)
  const [success,    setSuccess]    = useState(null)

  // Sincronizar form cuando cambia el evento seleccionado
  useEffect(() => {
    if (event) {
      setName(event.name)
      setWidth(event.width)
      setHeight(event.height)
      setPhotoCount(event.photoCount ?? 3)
      setTimerSecs(event.timerSecs ?? 3)
      setTemplateId(event.templateId ?? null)
      setIngestUrl(event.ingestUrl ?? '')
    } else {
      setName(''); setWidth(600); setHeight(600)
      setPhotoCount(3); setTimerSecs(3); setTemplateId(null); setIngestUrl('')
    }
    setError(null); setSuccess(null)
  }, [event?.id])

  const isActive   = event && event.id === activeId
  const dimChanged = event && (parseInt(width) !== event.width || parseInt(height) !== event.height)

  const handleSave = async () => {
    setError(null); setSaving(true)
    try {
      const url    = event ? eventUrl(event.id) : `${API}/api/events`
      const method = event ? 'PUT' : 'POST'
      const r      = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          width:      parseInt(width),
          height:     parseInt(height),
          photoCount: parseInt(photoCount),
          timerSecs:  parseInt(timerSecs),
          templateId: templateId || null,
          ingestUrl:  ingestUrl.trim() || null,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error al guardar')
      onSaved(data, event?.id)
      setSuccess(event ? 'Guardado ✓' : null)
      if (success) setTimeout(() => setSuccess(null), 2500)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleActivate = async () => {
    if (!event) return
    setActivating(true)
    try {
      const method = isActive ? 'DELETE' : 'POST'
      await fetch(eventUrl(event.id, '/activate'), { method })
      onActivated(isActive ? null : event.id)
    } finally { setActivating(false) }
  }

  const handleDelete = async () => {
    if (!event) return
    if (!window.confirm(`¿Eliminar el evento "${event.name}"?\nSe borrarán todas sus fotos y plantilla.`)) return
    setDeleting(true)
    try {
      const r    = await fetch(eventUrl(event.id), { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      onDeleted(event.id)
    } catch (e) { setError(e.message) }
    finally { setDeleting(false) }
  }

  // ── Modo: crear nuevo evento ──────────────────────────────────────────────
  if (!event) {
    // Foto count derivado de la plantilla seleccionada (si aplica)
    const selectedTpl   = templates.find(x => x.id === templateId)
    const tplPhotoCount = selectedTpl?.slots?.length
      ? Math.max(...selectedTpl.slots.map(s => s.photoIndex))
      : null

    return (
      <div className="h-full flex items-center justify-center p-10">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className={`${t.text} font-black text-2xl mb-1`}>Nuevo evento</h2>
          <p className={`${t.textFaint} text-sm mb-8`}>
            Configura el nombre y las dimensiones de las fotos.
          </p>

          <div className="flex flex-col gap-5">
            <Field label="Nombre del evento">
              <Input value={name} onChange={setName} placeholder="Ej. Boda García, Cumpleaños Ana…" />
            </Field>

            <div className="flex gap-3">
              <Field label="Ancho" hint="px">
                <Input type="number" value={width}  onChange={setWidth}  min={50} max={8000} />
              </Field>
              <Field label="Alto" hint="px">
                <Input type="number" value={height} onChange={setHeight} min={50} max={8000} />
              </Field>
            </div>

            {/* Plantilla interactiva */}
            <Field label="Plantilla interactiva" hint="opcional">
              {templates.length === 0 ? (
                <p className={`${t.hint} text-xs`}>
                  Crea plantillas en el tab <strong>📐 Plantillas</strong>.
                </p>
              ) : (
                <select
                  value={templateId ?? ''}
                  onChange={e => setTemplateId(e.target.value || null)}
                  className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none ${t.input}`}
                >
                  <option value="">— Sin plantilla —</option>
                  {templates.map(tpl => {
                    const maxPi = tpl.slots?.length ? Math.max(...tpl.slots.map(s => s.photoIndex)) : 0
                    return (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.width}×{tpl.height}{maxPi ? ` · 📷${maxPi}` : ''})
                      </option>
                    )
                  })}
                </select>
              )}
            </Field>

            {!templateId && (
              <div className="flex gap-3">
                <Field label="Fotos por sesión" hint="1–10">
                  <Input type="number" value={photoCount} onChange={setPhotoCount} min={1} max={10} />
                </Field>
                <Field label="Temporizador" hint="seg (1–30)">
                  <Input type="number" value={timerSecs}  onChange={setTimerSecs}  min={1} max={30} />
                </Field>
              </div>
            )}
            {templateId && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={`block ${t.label} text-xs font-semibold tracking-wide uppercase mb-1.5`}>
                    Fotos por sesión
                  </label>
                  <div className={`rounded-xl px-4 py-2.5 text-sm ${t.bgSection} border ${t.borderFaint} ${t.textFaint}`}>
                    {tplPhotoCount ?? '–'} <span className={`text-xs ${t.textFaint}`}>(definido por plantilla)</span>
                  </div>
                </div>
                <Field label="Temporizador" hint="seg (1–30)">
                  <Input type="number" value={timerSecs}  onChange={setTimerSecs}  min={1} max={30} />
                </Field>
              </div>
            )}

            <Field label="Carrusel ECA360" hint="opcional · URL de ingest">
              <Input
                value={ingestUrl}
                onChange={setIngestUrl}
                placeholder="https://eca360.com.mx/ingest/boda-ana"
              />
              <p className={`text-xs mt-1.5 ${t.textFaint}`}>
                Si pegas una URL, cada foto y la tira se suben solas al terminar la sesión.
                Vacío = no sube nada.
              </p>
            </Field>

            <div className={`p-3 rounded-xl ${t.bgSection} border ${t.borderFaint} ${t.textFaint} text-xs`}>
              Las fotos van en:{" "}
              <span className={`${t.textMuted} font-mono`}>events/Nombre del evento/sessions/foto1_1.jpg</span>…
            </div>

            {error && <p className="text-red-400 text-sm">⚠️ {error}</p>}

            <Btn variant="primary" onClick={handleSave} loading={saving}
                 disabled={!name.trim()}>
              Crear evento
            </Btn>
          </div>
        </motion.div>
      </div>
    )
  }

  // ── Modo: editar evento existente ─────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto p-8">
      {/* Cabecera */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {isActive && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${t.badge}`}>
                ● Activo
              </span>
            )}
            <h2 className={`${t.text} font-black text-2xl`}>{event.name}</h2>
          </div>
          <p className={`${t.textFaint} text-xs font-mono`}>ID: {event.id}</p>
        </div>

        {/* Botón activar / desactivar */}
        <Btn
          variant={isActive ? 'default' : 'green'}
          onClick={handleActivate}
          loading={activating}
        >
          {isActive ? '⏹ Desactivar' : '▶ Activar evento'}
        </Btn>
      </div>

      {/* Formulario */}
      <div className="flex flex-col gap-6 max-w-xl">

        {/* Nombre */}
        <Field label="Nombre del evento">
          <Input value={name} onChange={setName} placeholder="Nombre del evento" />
        </Field>

        {/* Dimensiones */}
        <div>
          <label className={`block ${t.label} text-xs font-semibold tracking-wide uppercase mb-1.5`}>
            Dimensiones de foto
            <span className={`normal-case font-normal ml-2 ${t.hint}`}>px</span>
          </label>
          <div className="flex items-center gap-3">
            <Input type="number" value={width}  onChange={setWidth}  min={50} max={8000} />
            <span className={`${t.textFaint} font-bold text-lg`}>×</span>
            <Input type="number" value={height} onChange={setHeight} min={50} max={8000} />
          </div>

          {dimChanged && event.hasTemplate && (
            <motion.p
              className="mt-2 text-amber-400 text-xs"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            >
              ⚠️ Al cambiar las dimensiones la plantilla actual quedará inválida.
              Deberás subir una nueva después de guardar.
            </motion.p>
          )}
        </div>

        {/* Configuración de sesión */}
        <div>
          <label className={`block ${t.label} text-xs font-semibold tracking-wide uppercase mb-1.5`}>
            Configuración de sesión
          </label>
          <div className="flex gap-3">
            <Field label="Fotos por sesión" hint="1–10">
              <Input type="number" value={photoCount} onChange={setPhotoCount} min={1} max={10} />
            </Field>
            <Field label="Temporizador" hint="seg (1–30)">
              <Input type="number" value={timerSecs}  onChange={setTimerSecs}  min={1} max={30} />
            </Field>
          </div>
        </div>

        <Field label="Carrusel ECA360" hint="opcional · URL de ingest">
          <Input
            value={ingestUrl}
            onChange={setIngestUrl}
            placeholder="https://eca360.com.mx/ingest/boda-ana"
          />
          <p className={`text-xs mt-1.5 ${t.textFaint}`}>
            Cada foto y la tira se suben en segundo plano al guardar. Si falla internet, el booth sigue normal.
          </p>
        </Field>

        {/* Feedback guardar */}
        <AnimatePresence>
          {error   && <motion.p className="text-red-400 text-sm" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>⚠️ {error}</motion.p>}
          {success && <motion.p className="text-emerald-400 text-sm" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>{success}</motion.p>}
        </AnimatePresence>

        {/* Botón guardar config */}
        <div className="flex gap-3">
          <Btn variant="primary" onClick={handleSave} loading={saving}>
            Guardar configuración
          </Btn>
        </div>

        {/* Separador */}
        <div className={`border-t ${t.divider} pt-2`} />

        {/* Plantilla interactiva */}
        <div>
          <label className={`block ${t.label} text-xs font-semibold tracking-wide uppercase mb-1.5`}>
            Plantilla interactiva
          </label>
          {templates.length === 0 ? (
            <p className={`${t.hint} text-xs`}>
              Aún no hay plantillas. Créalas en el tab <strong>📐 Plantillas</strong> y vuelve aquí a asignarlas.
            </p>
          ) : (
            <>
              <select
                value={templateId ?? ''}
                onChange={e => setTemplateId(e.target.value || null)}
                className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none ${t.input}`}
              >
                <option value="">— Sin plantilla —</option>
                {templates.map(tpl => {
                  const maxPi = tpl.slots?.length ? Math.max(...tpl.slots.map(s => s.photoIndex)) : 0
                  return (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}  ({tpl.width}×{tpl.height} · {tpl.slots?.length ?? 0} huecos{maxPi ? ` · 📷${maxPi}` : ''})
                    </option>
                  )
                })}
              </select>
              {templateId && (() => {
                const tpl = templates.find(x => x.id === templateId)
                if (!tpl) return null
                const maxPi = tpl.slots?.length ? Math.max(...tpl.slots.map(s => s.photoIndex)) : 0
                return (
                  <p className={`${t.hint} text-xs mt-2`}>
                    ✓ Se tomarán <strong>{maxPi}</strong> foto{maxPi !== 1 ? 's' : ''} por sesión (definido por los huecos de la plantilla)
                  </p>
                )
              })()}
            </>
          )}
        </div>

        {/* Separador */}
        <div className={`border-t ${t.divider} pt-2`} />

        {/* Zona peligrosa */}
        <div className={`p-4 rounded-xl border ${t.dangerZone}`}>
          <p className={`${t.textMuted} text-xs mb-3 font-semibold tracking-wide uppercase`}>
            Zona peligrosa
          </p>
          <Btn variant="danger" onClick={handleDelete} loading={deleting}>
            🗑 Eliminar evento y todas sus fotos
          </Btn>
        </div>

      </div>
    </div>
  )
}
