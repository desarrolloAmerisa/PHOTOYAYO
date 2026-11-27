import { useRef, useState } from 'react'
import { useTheme } from '../../ThemeContext'

const API = 'http://localhost:8766'

export default function FiltersPanel({ filters, loading, onChanged }) {
  const { t } = useTheme()
  const fileRef = useRef(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)
  const [pendingFile, setPendingFile] = useState(null)

  const resetForm = () => {
    setName('')
    setPendingFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleCreate = async () => {
    setError(null)
    setMsg(null)
    if (!name.trim()) { setError('Ponle un nombre al filtro'); return }
    if (!pendingFile) { setError('Selecciona un archivo .cube'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('file', pendingFile)
      const r = await fetch(`${API}/api/filters`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo crear')
      onChanged?.()
      resetForm()
      setMsg(`Filtro "${j.name}" listo (${j.size}³)`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleRename = async (f) => {
    const next = window.prompt('Nuevo nombre', f.name)
    if (next == null || !next.trim() || next.trim() === f.name) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`${API}/api/filters/${encodeURIComponent(f.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next.trim() }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo renombrar')
      onChanged?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleReplace = async (f, file) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`${API}/api/filters/${encodeURIComponent(f.id)}`, {
        method: 'PUT', body: fd,
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo actualizar el .cube')
      onChanged?.()
      setMsg(`LUT de "${f.name}" actualizada`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (f) => {
    if (!window.confirm(`¿Eliminar el filtro "${f.name}"?`)) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`${API}/api/filters/${encodeURIComponent(f.id)}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo eliminar')
      onChanged?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h2 className={`font-black text-2xl ${t.text}`}>Filtros LUT</h2>
        <p className={`text-sm mt-1 ${t.textFaint}`}>
          Sube archivos <span className="font-mono">.cube</span>. Se aplican solo al tomar la foto
          (no en el preview en vivo). Luego asígnalos al evento.
        </p>
      </div>

      <div className={`rounded-2xl border p-4 mb-6 ${t.borderMed} ${t.bgCard}`}>
        <p className={`text-[10px] uppercase tracking-widest font-bold mb-3 ${t.textFaint}`}>
          Nuevo filtro
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className={`block text-xs font-semibold mb-1.5 ${t.label}`}>Nombre</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej. Cine cálido, Blanco y negro…"
              className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none ${t.input}`}
            />
          </div>
          <div className="flex-1">
            <label className={`block text-xs font-semibold mb-1.5 ${t.label}`}>Archivo .cube</label>
            <input
              ref={fileRef}
              type="file"
              accept=".cube,text/plain"
              className={`w-full text-sm ${t.textMuted}`}
              onChange={e => setPendingFile(e.target.files?.[0] || null)}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleCreate}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white
                       bg-gradient-to-r from-pink-600 to-[#CC0000] disabled:opacity-50"
          >
            {busy ? 'Subiendo…' : 'Dar de alta'}
          </button>
        </div>
        {pendingFile && (
          <p className={`text-xs mt-2 ${t.textFaint}`}>{pendingFile.name}</p>
        )}
      </div>

      {error && <p className="text-red-400 text-sm mb-3">⚠️ {error}</p>}
      {msg && <p className="text-emerald-400 text-sm mb-3">{msg}</p>}

      <p className={`text-[10px] uppercase tracking-widest font-bold mb-3 ${t.textFaint}`}>
        Biblioteca ({filters.length})
      </p>

      {loading ? (
        <p className={`text-sm ${t.textFaint}`}>Cargando…</p>
      ) : filters.length === 0 ? (
        <div className={`rounded-2xl border border-dashed p-8 text-center ${t.borderMed}`}>
          <p className={`text-sm ${t.textMuted}`}>Aún no hay filtros. Sube tu primer .cube arriba.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filters.map(f => (
            <div
              key={f.id}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${t.borderMed} ${t.bgCard}`}
            >
              <div className="min-w-0 flex-1">
                <p className={`font-bold text-sm truncate ${t.text}`}>{f.name}</p>
                <p className={`text-[11px] font-mono ${t.textFaint}`}>
                  {f.id} · LUT {f.size}³
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRename(f)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${t.bgSection} ${t.textMuted} ${t.bgHover}`}
              >
                Renombrar
              </button>
              <label className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer
                                 ${t.bgSection} ${t.textMuted} ${t.bgHover}`}>
                Cambiar .cube
                <input
                  type="file"
                  accept=".cube,text/plain"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    handleReplace(f, file)
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDelete(f)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-400
                           bg-red-500/10 hover:bg-red-500/20"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
