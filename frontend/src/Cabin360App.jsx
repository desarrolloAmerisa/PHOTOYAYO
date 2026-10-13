import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ThemeProvider, useTheme } from './ThemeContext'

const API = 'http://localhost:8767'

const PHASE_LABEL = {
  queued:          'En cola',
  saving:          'Guardando',
  compressing:     'Comprimiendo',
  framing:         'Aplicando marco',
  thumbnail:       'Miniatura',
  uploading:       'Subiendo video',
  uploading_thumb: 'Subiendo miniatura',
  done:            'Listo',
  error:           'Error',
}

function phaseColor(phase) {
  if (phase === 'done') return 'text-emerald-400'
  if (phase === 'error') return 'text-red-400'
  if (phase === 'queued' || phase === 'saving') return 'text-white/50'
  return 'text-sky-300'
}

function isConfigured(evt) {
  return !!(evt?.name?.trim() && evt?.ingestUrl?.trim())
}

function Cabin360Inner() {
  const { t, isDark, toggle } = useTheme()
  const [events, setEvents]         = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [jobs, setJobs]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [ffmpegOk, setFfmpegOk]     = useState(true)
  const [creating, setCreating]     = useState(false)
  const [editing, setEditing]       = useState(false)
  const [newName, setNewName]       = useState('')
  const [newIngest, setNewIngest]   = useState('')
  const [draftName, setDraftName]   = useState('')
  const [draftIngest, setDraftIngest] = useState('')
  const [formError, setFormError]   = useState('')
  const [savingEvt, setSavingEvt]   = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [frameBusy, setFrameBusy]   = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const [showSetup, setShowSetup]   = useState(false)
  const [setup, setSetup]           = useState(null)
  const [setupBusy, setSetupBusy]   = useState(false)
  const [setupMsg, setSetupMsg]     = useState('')
  const [showLogs, setShowLogs]     = useState(false)
  const [logs, setLogs]             = useState([])
  const [logFilterJob, setLogFilterJob] = useState(null)
  const [expandedJob, setExpandedJob] = useState(null)
  const fileRef  = useRef(null)
  const frameRef = useRef(null)
  const SETUP_KEY = 'cabin360_setup_seen_v1'

  const selected = useMemo(
    () => events.find(e => e.id === selectedId) || null,
    [events, selectedId],
  )
  const ready = isConfigured(selected)

  const fetchSetup = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/360/setup`)
      const j = await r.json()
      setSetup(j)
      setFfmpegOk(!!j.ffmpeg && !!j.ffprobe)
      return j
    } catch {
      return null
    }
  }, [])

  const fetchLogs = useCallback(async (jobId = null) => {
    try {
      const q = jobId ? `?jobId=${encodeURIComponent(jobId)}&limit=200` : '?limit=200'
      const r = await fetch(`${API}/api/360/logs${q}`)
      const j = await r.json()
      setLogs(j.logs || [])
    } catch {
      setLogs([])
    }
  }, [])

  const fetchEvents = useCallback(async () => {
    try {
      const [eR, sR] = await Promise.all([
        fetch(`${API}/api/360/events`),
        fetch(`${API}/api/360/status`),
      ])
      const eJ = await eR.json()
      const sJ = await sR.json()
      setEvents(eJ.events || [])
      setFfmpegOk(!!sJ.ok)
      setError(null)
      if (!selectedId && (eJ.events || []).length) {
        setSelectedId(eJ.events[0].id)
      }
    } catch {
      setError('No se puede conectar con Cabina 360 (puerto 8767). ¿Está el backend?')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    ;(async () => {
      const s = await fetchSetup()
      const seen = localStorage.getItem(SETUP_KEY)
      if (!seen || (s && !s.ready)) setShowSetup(true)
    })()
  }, [fetchSetup])

  const fetchJobs = useCallback(async () => {
    if (!selectedId) { setJobs([]); return }
    try {
      const r = await fetch(`${API}/api/360/events/${encodeURIComponent(selectedId)}/jobs`)
      const j = await r.json()
      setJobs(j.jobs || [])
    } catch { /* ignore */ }
  }, [selectedId])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => { fetchJobs() }, [fetchJobs])

  useEffect(() => {
    if (!selected) {
      setDraftName('')
      setDraftIngest('')
      return
    }
    setDraftName(selected.name || '')
    setDraftIngest(selected.ingestUrl || '')
    setFormError('')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId || !ready) return
    const busy = jobs.some(j => j.phase !== 'done' && j.phase !== 'error')
    const id = setInterval(fetchJobs, busy ? 1200 : 5000)
    return () => clearInterval(id)
  }, [selectedId, jobs, fetchJobs, ready])

  const selectEvent = (id) => {
    setSelectedId(id)
    setCreating(false)
    setEditing(false)
    setFormError('')
  }

  const createEvent = async () => {
    const name = newName.trim()
    const url = newIngest.trim()
    if (!name || !url) {
      setFormError('Nombre y URL de ingest son obligatorios')
      return
    }
    setSavingEvt(true)
    setFormError('')
    try {
      const r = await fetch(`${API}/api/360/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ingestUrl: url }),
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setEvents(prev => [j, ...prev])
      setSelectedId(j.id)
      setCreating(false)
      setNewName('')
      setNewIngest('')
    } catch (e) {
      setFormError(e.message || 'No se pudo crear el evento')
    } finally {
      setSavingEvt(false)
    }
  }

  const saveEvent = async () => {
    if (!selected) return
    const name = draftName.trim()
    const url = draftIngest.trim()
    if (!name || !url) {
      setFormError('Nombre y URL de ingest son obligatorios')
      return
    }
    setSavingEvt(true)
    setFormError('')
    try {
      const r = await fetch(`${API}/api/360/events/${encodeURIComponent(selected.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ingestUrl: url }),
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setEvents(prev => prev.map(e => (e.id === selected.id || e.id === j.id ? j : e)))
      setSelectedId(j.id)
      setEditing(false)
    } catch (e) {
      setFormError(e.message || 'No se pudo guardar')
    } finally {
      setSavingEvt(false)
    }
  }

  const deleteEvent = async () => {
    if (!selected) return
    if (!window.confirm(`¿Eliminar "${selected.name}" y sus videos locales?`)) return
    await fetch(`${API}/api/360/events/${encodeURIComponent(selected.id)}`, { method: 'DELETE' })
    setEvents(prev => prev.filter(e => e.id !== selected.id))
    setSelectedId(null)
    setJobs([])
  }

  const uploadFrame = async (file) => {
    if (!selected || !file || !ready) return
    setFrameBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`${API}/api/360/events/${encodeURIComponent(selected.id)}/marco`, {
        method: 'POST', body: fd,
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setEvents(prev => prev.map(e => e.id === selected.id ? j : e))
    } catch (e) {
      setError(e.message || 'Error al subir marco')
    } finally {
      setFrameBusy(false)
    }
  }

  const removeFrame = async () => {
    if (!selected) return
    setFrameBusy(true)
    try {
      await fetch(`${API}/api/360/events/${encodeURIComponent(selected.id)}/marco`, { method: 'DELETE' })
      setEvents(prev => prev.map(e => e.id === selected.id ? { ...e, hasFrame: false } : e))
    } finally {
      setFrameBusy(false)
    }
  }

  const uploadVideos = async (fileList) => {
    if (!selected || !fileList?.length || !ready) return
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      Array.from(fileList).forEach(f => fd.append('videos', f))
      const r = await fetch(`${API}/api/360/events/${encodeURIComponent(selected.id)}/videos`, {
        method: 'POST', body: fd,
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setJobs(prev => [...(j.jobs || []), ...prev])
    } catch (e) {
      setError(e.message || 'Error al subir videos')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) uploadVideos(e.dataTransfer.files)
  }

  const openLogs = async (jobId = null) => {
    setLogFilterJob(jobId)
    setShowLogs(true)
    await fetchLogs(jobId)
  }

  const recheckSetup = async () => {
    setSetupBusy(true)
    setSetupMsg('Verificando…')
    try {
      await fetch(`${API}/api/360/setup/install-ffmpeg`, { method: 'POST' })
      const s = await fetchSetup()
      setSetupMsg(s?.ready
        ? 'Todo listo'
        : 'Falta algo. Revisa que exista ffmpeg-7.1.1-full_build/bin en el proyecto.')
    } catch (e) {
      setSetupMsg(e.message || 'No se pudo verificar')
    } finally {
      setSetupBusy(false)
    }
  }

  const finishSetup = async () => {
    const s = await fetchSetup()
    if (s?.ready) {
      localStorage.setItem(SETUP_KEY, '1')
      setShowSetup(false)
      setSetupMsg('')
    } else {
      setSetupMsg('Aún faltan requisitos. Coloca ffmpeg-7.1.1-full_build en la raíz del proyecto.')
    }
  }

  const retryJob = async (jid) => {
    try {
      const r = await fetch(`${API}/api/360/jobs/${encodeURIComponent(jid)}/retry`, { method: 'POST' })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setJobs(prev => prev.map(x => x.id === jid ? { ...x, ...j } : x))
    } catch (e) {
      setError(e.message || 'No se pudo reintentar')
    }
  }

  useEffect(() => {
    if (!showLogs) return
    const id = setInterval(() => fetchLogs(logFilterJob), 2000)
    return () => clearInterval(id)
  }, [showLogs, logFilterJob, fetchLogs])

  const canCreate = newName.trim() && newIngest.trim()
  const canSave   = draftName.trim() && draftIngest.trim()

  const SetupForm = ({
    title, subtitle, name, url, onName, onUrl, onSubmit, submitLabel, secondary,
  }) => (
    <div className="flex-1 flex items-start justify-center p-10 overflow-y-auto">
      <div className="w-full max-w-md space-y-4">
        <div>
          <h2 className={`text-2xl font-black ${t.text}`}>{title}</h2>
          <p className={`text-sm mt-1.5 leading-relaxed ${t.textMuted}`}>{subtitle}</p>
        </div>
        <div>
          <label className={`block text-xs font-semibold mb-1.5 ${t.label}`}>
            Nombre del evento <span className="text-pink-400">*</span>
          </label>
          <input
            autoFocus
            className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${t.input}`}
            value={name}
            onChange={e => onName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSubmit()}
            placeholder="Boda Ana"
          />
        </div>
        <div>
          <label className={`block text-xs font-semibold mb-1.5 ${t.label}`}>
            URL de ingest ECA360 <span className="text-pink-400">*</span>
          </label>
          <input
            className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${t.input}`}
            value={url}
            onChange={e => onUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSubmit()}
            placeholder="https://eca360.com.mx/ingest/…"
          />
        </div>
        {formError && (
          <p className="text-xs font-semibold text-red-400">{formError}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onSubmit}
            disabled={savingEvt || !name.trim() || !url.trim()}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white
                       bg-gradient-to-r from-pink-600 to-[#CC0000] disabled:opacity-40"
          >
            {savingEvt ? 'Guardando…' : submitLabel}
          </button>
          {secondary}
        </div>
        <p className={`text-[11px] leading-relaxed ${t.textUltra}`}>
          Primero configura el evento. Después podrás subir el marco y los videos.
        </p>
      </div>
    </div>
  )

  return (
    <div className={`relative w-screen h-screen flex flex-col overflow-hidden ${t.bgApp}`}>
      <div
        className={`flex items-center justify-between px-5 py-3 border-b ${t.border} ${t.bgBar} flex-shrink-0`}
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
          <span className={`font-black text-base tracking-wider ${t.text}`}>🎥 CABINA 360</span>
          <span className={`text-xs font-mono ${t.textFaint}`}>ECA MID</span>
          {!ffmpegOk && (
            <span className="text-[11px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
              ffmpeg no detectado
            </span>
          )}
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
          <button
            onClick={() => { setShowSetup(true); fetchSetup(); setSetupMsg('') }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${t.borderMed} ${t.bgCard} ${t.textMuted}`}
          >
            Instalar / verificar
          </button>
          <button
            onClick={() => openLogs(null)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${t.borderMed} ${t.bgCard} ${t.textMuted}`}
          >
            Logs
          </button>
          <button
            onClick={toggle}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${t.borderMed} ${t.bgCard} ${t.textMuted}`}
          >
            {isDark ? '☀️ Claro' : '🌙 Oscuro'}
          </button>
          <button onClick={() => window.electronBridge?.minimizeWindow()}
            className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400" />
          <button onClick={() => window.electronBridge?.maximizeWindow()}
            className="w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500" />
          <button onClick={() => window.electronBridge?.closeWindow()}
            className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500" />
        </div>
      </div>

      {/* Setup primera vez */}
      {showSetup && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/70 p-6">
          <div className={`w-full max-w-lg rounded-2xl border ${t.borderMed} ${t.bgBar} p-6 shadow-2xl space-y-4`}>
            <div>
              <h2 className={`text-xl font-black ${t.text}`}>Configuración de Cabina 360</h2>
              <p className={`text-sm mt-1 ${t.textMuted}`}>
                Solo verifica que exista la carpeta <span className="font-mono text-white/70">ffmpeg-7.1.1-full_build</span> en el proyecto y las demás dependencias.
              </p>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(setup?.checks || []).map(c => (
                <div key={c.id} className={`flex items-start gap-2 rounded-xl px-3 py-2 border ${t.borderFaint} ${t.bgCard}`}>
                  <span className={c.ok ? 'text-emerald-400' : 'text-amber-400'}>{c.ok ? '✓' : '✗'}</span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${t.text}`}>{c.label}</p>
                    <p className={`text-[11px] truncate ${t.textFaint}`}>{c.detail}</p>
                  </div>
                </div>
              ))}
              {!setup && (
                <p className={`text-sm ${t.textMuted}`}>Cargando verificación…</p>
              )}
            </div>
            {setupMsg && <p className={`text-xs ${setup?.ready ? 'text-emerald-400' : 'text-amber-300'}`}>{setupMsg}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={recheckSetup}
                disabled={setupBusy}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white
                           bg-gradient-to-r from-sky-600 to-indigo-700 disabled:opacity-40"
              >
                {setupBusy ? 'Verificando…' : 'Verificar de nuevo'}
              </button>
              <button
                onClick={finishSetup}
                disabled={setupBusy || !setup?.ready}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white
                           bg-gradient-to-r from-pink-600 to-[#CC0000] disabled:opacity-40"
              >
                Continuar
              </button>
              <button
                onClick={() => { localStorage.setItem(SETUP_KEY, '1'); setShowSetup(false) }}
                className={`px-3 py-2 rounded-xl text-xs ${t.textUltra}`}
              >
                Omitir por ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel logs */}
      {showLogs && (
        <div className="absolute inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border ${t.borderMed} ${t.bgBar} shadow-2xl`}>
            <div className={`px-4 py-3 border-b ${t.border} flex items-center justify-between`}>
              <div>
                <p className={`font-bold text-sm ${t.text}`}>Logs{logFilterJob ? ` · job ${logFilterJob}` : ''}</p>
                <p className={`text-[11px] ${t.textFaint}`}>Se actualizan solos</p>
              </div>
              <button onClick={() => setShowLogs(false)} className={`${t.textMuted} text-lg leading-none`}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1">
              {logs.length === 0 ? (
                <p className={t.textUltra}>Sin entradas aún</p>
              ) : logs.map((l, i) => (
                <div key={i} className={`${l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : t.textMuted}`}>
                  <span className={t.textUltra}>[{l.ts}]</span> {l.jobId ? `[${l.jobId}] ` : ''}{l.msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => { setError(null); setLoading(true); fetchEvents() }} className="underline text-xs">
            Reintentar
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className={`w-56 flex flex-col border-r ${t.border} ${t.bgSidebar}`}>
          <div className={`px-3 py-3 border-b ${t.border}`}>
            <button
              onClick={() => { setCreating(true); setFormError('') }}
              className="w-full py-2 rounded-xl text-sm font-bold text-white
                         bg-gradient-to-r from-pink-600 to-[#CC0000]"
            >
              + Nuevo evento
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-0.5">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-5 h-5 rounded-full border-2 border-pink-500/60 border-t-transparent animate-spin" />
              </div>
            ) : events.length === 0 ? (
              <p className={`text-xs text-center py-8 px-2 ${t.textUltra}`}>
                Crea un evento con nombre y URL para empezar
              </p>
            ) : (
              events.map(evt => (
                <button
                  key={evt.id}
                  onClick={() => selectEvent(evt.id)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors
                    ${selectedId === evt.id && !creating
                      ? 'bg-pink-500/15 text-white'
                      : `${t.textMuted} ${t.bgHover}`}`}
                >
                  <p className="text-sm font-semibold truncate">{evt.name || 'Sin nombre'}</p>
                  {!isConfigured(evt) && (
                    <p className="text-[10px] text-amber-400/80 mt-0.5">Configuración incompleta</p>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {creating ? (
            <SetupForm
              title="Nuevo evento"
              subtitle="Nombre y URL son obligatorios. Al guardar se desbloquean marco y videos."
              name={newName}
              url={newIngest}
              onName={setNewName}
              onUrl={setNewIngest}
              onSubmit={createEvent}
              submitLabel="Guardar y continuar"
              secondary={(
                <button
                  onClick={() => { setCreating(false); setFormError('') }}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${t.bgCard} ${t.textMuted}`}
                >
                  Cancelar
                </button>
              )}
            />
          ) : !selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <p className={`font-bold text-lg ${t.text}`}>Elige un evento</p>
              <p className={`text-sm ${t.textMuted}`}>o crea uno nuevo a la izquierda</p>
            </div>
          ) : !ready ? (
            <SetupForm
              title="Configura el evento"
              subtitle="Completa nombre y URL de ingest. Después podrás subir marco y videos."
              name={draftName}
              url={draftIngest}
              onName={setDraftName}
              onUrl={setDraftIngest}
              onSubmit={saveEvent}
              submitLabel="Guardar y continuar"
              secondary={(
                <button
                  onClick={deleteEvent}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-red-400/80"
                >
                  Eliminar
                </button>
              )}
            />
          ) : (
            <>
              <div className={`px-6 py-3 border-b ${t.border} flex-shrink-0 flex items-center gap-3`}>
                <div className="flex-1 min-w-0">
                  <p className={`text-lg font-black truncate ${t.text}`}>{selected.name}</p>
                  <p className={`text-[11px] truncate ${t.textFaint}`}>{selected.ingestUrl}</p>
                </div>
                <button
                  onClick={() => {
                    setDraftName(selected.name || '')
                    setDraftIngest(selected.ingestUrl || '')
                    setFormError('')
                    setEditing(true)
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${t.bgCard} ${t.textMuted} ${t.bgHover}`}
                >
                  Editar datos
                </button>
                <button
                  onClick={deleteEvent}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-400/80 hover:text-red-400"
                >
                  Eliminar
                </button>
              </div>

              {editing && (
                <div className={`px-6 py-4 border-b ${t.border} ${t.bgSidebar} flex-shrink-0`}>
                  <div className="max-w-xl grid grid-cols-2 gap-3">
                    <div>
                      <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${t.textFaint}`}>Nombre *</label>
                      <input
                        className={`w-full rounded-xl px-3 py-2 text-sm outline-none ${t.input}`}
                        value={draftName}
                        onChange={e => setDraftName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${t.textFaint}`}>URL ingest *</label>
                      <input
                        className={`w-full rounded-xl px-3 py-2 text-sm outline-none ${t.input}`}
                        value={draftIngest}
                        onChange={e => setDraftIngest(e.target.value)}
                      />
                    </div>
                  </div>
                  {formError && <p className="text-xs text-red-400 mt-2">{formError}</p>}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={saveEvent}
                      disabled={savingEvt || !canSave}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-white
                                 bg-gradient-to-r from-pink-600 to-[#CC0000] disabled:opacity-40"
                    >
                      {savingEvt ? '…' : 'Guardar'}
                    </button>
                    <button
                      onClick={() => {
                        setDraftName(selected.name || '')
                        setDraftIngest(selected.ingestUrl || '')
                        setFormError('')
                        setEditing(false)
                      }}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold ${t.bgCard} ${t.textMuted}`}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr] overflow-hidden">
                <div className={`border-r ${t.border} overflow-y-auto p-5 space-y-5`}>
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${t.textFaint}`}>
                      Marco <span className={t.textUltra}>(opcional)</span>
                    </p>
                    <div
                      className={`rounded-xl border ${t.borderMed} overflow-hidden bg-black/30
                                  aspect-[9/16] max-h-56 flex items-center justify-center`}
                    >
                      {selected.hasFrame ? (
                        <img
                          src={`${API}/api/360/events/${encodeURIComponent(selected.id)}/marco?t=${Date.now()}`}
                          alt="marco"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className={`text-xs ${t.textUltra}`}>Sin marco</span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button
                        disabled={frameBusy}
                        onClick={() => frameRef.current?.click()}
                        className="flex-1 py-2 rounded-lg text-xs font-bold text-sky-300
                                   bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/15"
                      >
                        {frameBusy ? '…' : selected.hasFrame ? 'Cambiar' : 'Subir PNG'}
                      </button>
                      {selected.hasFrame && (
                        <button
                          onClick={removeFrame}
                          disabled={frameBusy}
                          className="px-3 py-2 rounded-lg text-xs font-bold text-red-400/80
                                     border border-red-500/20"
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                    <input
                      ref={frameRef}
                      type="file"
                      accept="image/png,image/*"
                      className="hidden"
                      onChange={e => uploadFrame(e.target.files?.[0])}
                    />
                  </div>
                </div>

                <div className="flex flex-col min-h-0 overflow-hidden">
                  <div className="p-5 flex-shrink-0">
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      onClick={() => !uploading && ffmpegOk && fileRef.current?.click()}
                      className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer
                                  transition-colors
                                  ${dragOver
                                    ? 'border-pink-500 bg-pink-500/10'
                                    : `${t.borderMed} ${t.bgHover}`}
                                  ${(!ffmpegOk || uploading) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <p className={`text-base font-bold ${t.text}`}>
                        {uploading ? 'Recibiendo videos…' : 'Arrastra videos aquí'}
                      </p>
                      <p className={`text-xs mt-1 ${t.textFaint}`}>
                        o haz clic para elegir varios · comprime → marco → thumb → ingest
                      </p>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="video/*"
                      multiple
                      className="hidden"
                      onChange={e => uploadVideos(e.target.files)}
                    />
                  </div>

                  <div className="px-5 pb-2 flex items-center justify-between flex-shrink-0">
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textFaint}`}>
                      Videos del evento
                    </p>
                    <span className={`text-xs ${t.textUltra}`}>{jobs.length}</span>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
                    {jobs.length === 0 ? (
                      <p className={`text-sm text-center py-10 ${t.textUltra}`}>
                        Todavía no hay videos en esta carpeta
                      </p>
                    ) : (
                      jobs.map(job => (
                        <motion.div
                          key={job.id}
                          layout
                          className={`rounded-xl border ${t.borderMed} ${t.bgCard} p-3 space-y-2`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-14 h-14 rounded-lg overflow-hidden bg-black/40 flex-shrink-0 flex items-center justify-center">
                              {(job.phase === 'done' || job.progress >= 80) ? (
                                <img
                                  src={`${API}/api/360/events/${encodeURIComponent(selected.id)}/videos/${job.id}/thumb`}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  onError={e => { e.currentTarget.style.display = 'none' }}
                                />
                              ) : (
                                <span className="text-lg">🎬</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-sm font-semibold truncate ${t.text}`}>
                                  {job.name || job.originalName}
                                </p>
                                <span className={`text-[11px] font-bold flex-shrink-0 ${phaseColor(job.phase)}`}>
                                  {PHASE_LABEL[job.phase] || job.phase}
                                </span>
                              </div>
                              <p className={`text-[11px] mt-0.5 truncate ${t.textFaint}`}>{job.msg}</p>
                              <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    job.phase === 'error' ? 'bg-red-500' :
                                    job.phase === 'done' ? 'bg-emerald-500' :
                                    'bg-gradient-to-r from-pink-500 to-sky-500'
                                  }`}
                                  style={{ width: `${job.progress ?? 0}%` }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pl-[68px]">
                            <button
                              onClick={() => openLogs(job.id)}
                              className={`text-[11px] font-semibold ${t.textMuted} hover:text-white`}
                            >
                              Ver logs
                            </button>
                            {job.phase === 'error' && (
                              <button
                                onClick={() => retryJob(job.id)}
                                className="text-[11px] font-bold text-pink-400 hover:text-pink-300"
                              >
                                Reintentar
                              </button>
                            )}
                            {(job.logs?.length > 0) && (
                              <button
                                onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                                className={`text-[11px] ${t.textUltra}`}
                              >
                                {expandedJob === job.id ? 'Ocultar detalle' : 'Detalle'}
                              </button>
                            )}
                          </div>
                          {expandedJob === job.id && job.logs?.length > 0 && (
                            <pre className={`text-[10px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto
                                            rounded-lg p-2 ${t.bgInput} ${t.textFaint}`}>
                              {job.logs.map(l => `[${l.ts}] ${l.msg}`).join('\n')}
                            </pre>
                          )}
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default function Cabin360App() {
  return (
    <ThemeProvider>
      <Cabin360Inner />
    </ThemeProvider>
  )
}
