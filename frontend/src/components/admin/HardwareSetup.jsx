/**
 * HardwareSetup.jsx
 * Vista de configuración de cámara e impresora en el panel de admin.
 */
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '../../ThemeContext'

const API = 'http://localhost:8766'

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }) {
  const { t } = useTheme()
  return (
    <div className={`rounded-2xl border ${t.borderMed} ${t.bgCard} p-5 space-y-4`}>
      <h3 className={`font-bold text-sm tracking-wide flex items-center gap-2 ${t.textBase}`}>
        <span>{icon}</span>{title}
      </h3>
      {children}
    </div>
  )
}

function SelectRow({ item, isSelected, isCurrent, onSelect }) {
  const { t } = useTheme()
  return (
    <motion.button
      layout
      onClick={onSelect}
      whileTap={{ scale: 0.98 }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all
        ${isSelected
          ? 'border-pink-500/60 bg-pink-500/10'
          : `border-transparent ${t.bgCard} ${t.bgHover}`
        }`}
    >
      <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center
        ${isSelected ? 'border-pink-500' : t.borderMed}`}>
        {isSelected && <span className="w-2 h-2 rounded-full bg-pink-500 block" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${t.textBase}`}>
          {item.label ?? item.name}
          {isCurrent && (
            <span className="ml-2 text-xs text-emerald-400 font-normal">(activa)</span>
          )}
        </p>
        {item.resolution && (
          <p className={`text-xs ${t.textMuted}`}>{item.resolution}</p>
        )}
        {item.comment && (
          <p className={`text-xs ${t.textMuted} truncate`}>{item.comment}</p>
        )}
        {item.isDefault && (
          <p className="text-xs text-amber-400">Impresora predeterminada del sistema</p>
        )}
      </div>
    </motion.button>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function HardwareSetup({ onSaved }) {
  const { t } = useTheme()

  // Cámaras
  const [cameras,        setCameras]        = useState([])
  const [currentCamera,  setCurrentCamera]  = useState(0)
  const [selectedCamera, setSelectedCamera] = useState(0)
  const [cameraLoading,  setCameraLoading]  = useState(false)
  const [cameraScanning, setCameraScanning] = useState(false)

  // Impresoras
  const [printers,         setPrinters]         = useState([])
  const [currentPrinter,   setCurrentPrinter]   = useState(null)
  const [selectedPrinter,  setSelectedPrinter]  = useState(null)
  const [printerLoading,   setPrinterLoading]   = useState(false)
  const [printerScanning,  setPrinterScanning]  = useState(false)

  // Flip de imagen
  const [flipHorizontal,   setFlipHorizontal]   = useState(false)
  const [flipVertical,     setFlipVertical]     = useState(false)
  const [flipLoading,      setFlipLoading]      = useState(false)

  // Enfoque
  const [autofocus,        setAutofocus]        = useState(false)
  const [focus,            setFocus]            = useState(0)
  const [focusLoading,     setFocusLoading]     = useState(false)
  const [dialogLoading,    setDialogLoading]    = useState(false)

  const [saveMsg, setSaveMsg] = useState(null)

  // ── Carga inicial ─────────────────────────────────────────────────────────
  const fetchCameras = useCallback(async () => {
    setCameraScanning(true)
    try {
      const r   = await fetch(`${API}/api/cameras`)
      const j   = await r.json()
      setCameras(j.cameras ?? [])
      setCurrentCamera(j.current ?? 0)
      setSelectedCamera(j.current ?? 0)
    } catch {
      setCameras([])
    } finally {
      setCameraScanning(false)
    }
  }, [])

  const fetchPrinters = useCallback(async () => {
    setPrinterScanning(true)
    try {
      const r   = await fetch(`${API}/api/printers`)
      const j   = await r.json()
      setPrinters(j.printers ?? [])
      setCurrentPrinter(j.current ?? null)
      setSelectedPrinter(j.current ?? null)
    } catch {
      setPrinters([])
    } finally {
      setPrinterScanning(false)
    }
  }, [])

  const fetchFlipConfig = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/flip-config`)
      const j = await r.json()
      setFlipHorizontal(j.flip_horizontal ?? false)
      setFlipVertical(j.flip_vertical ?? false)
    } catch {
      setFlipHorizontal(false)
      setFlipVertical(false)
    }
  }, [])

  const fetchFocusConfig = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/focus-config`)
      const j = await r.json()
      setAutofocus(j.autofocus ?? false)
      setFocus(j.focus ?? 0)
    } catch {
      setAutofocus(false)
      setFocus(0)
    }
  }, [])

  useEffect(() => {
    fetchCameras()
    fetchPrinters()
    fetchFlipConfig()
    fetchFocusConfig()
  }, [fetchCameras, fetchPrinters, fetchFlipConfig, fetchFocusConfig])

  // ── Guardado ──────────────────────────────────────────────────────────────
  const saveCamera = async () => {
    setCameraLoading(true)
    setSaveMsg(null)
    try {
      const r = await fetch(`${API}/api/cameras/select`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ index: selectedCamera }),
      })
      const j = await r.json()
      if (j.ok) {
        setCurrentCamera(selectedCamera)
        setSaveMsg({ type: 'ok', text: '✓ Cámara aplicada' })
        onSaved?.({ camera: selectedCamera })
      } else {
        setSaveMsg({ type: 'err', text: j.error ?? 'Error al cambiar cámara' })
      }
    } catch {
      setSaveMsg({ type: 'err', text: 'No se pudo conectar con el backend' })
    } finally {
      setCameraLoading(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  const savePrinter = async () => {
    setPrinterLoading(true)
    setSaveMsg(null)
    try {
      const r = await fetch(`${API}/api/printers/select`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: selectedPrinter }),
      })
      const j = await r.json()
      if (j.ok) {
        setCurrentPrinter(selectedPrinter)
        setSaveMsg({ type: 'ok', text: '✓ Impresora guardada' })
        onSaved?.({ printer: selectedPrinter })
      } else {
        setSaveMsg({ type: 'err', text: j.error ?? 'Error al guardar impresora' })
      }
    } catch {
      setSaveMsg({ type: 'err', text: 'No se pudo conectar con el backend' })
    } finally {
      setPrinterLoading(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  const saveFlipConfig = async () => {
    setFlipLoading(true)
    setSaveMsg(null)
    try {
      const r = await fetch(`${API}/api/flip-config`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ 
          flip_horizontal: flipHorizontal,
          flip_vertical: flipVertical
        }),
      })
      const j = await r.json()
      if (j.ok) {
        setSaveMsg({ type: 'ok', text: '✓ Configuración de flip guardada' })
        onSaved?.({ flip_horizontal: flipHorizontal, flip_vertical: flipVertical })
      } else {
        setSaveMsg({ type: 'err', text: j.error ?? 'Error al guardar flip' })
      }
    } catch {
      setSaveMsg({ type: 'err', text: 'No se pudo conectar con el backend' })
    } finally {
      setFlipLoading(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  const saveFocusConfig = async () => {
    setFocusLoading(true)
    setSaveMsg(null)
    try {
      const r = await fetch(`${API}/api/focus-config`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ autofocus, focus }),
      })
      const j = await r.json()
      if (j.ok) {
        setSaveMsg({ type: 'ok', text: '✓ Enfoque aplicado' })
        onSaved?.({ autofocus, focus })
      } else {
        setSaveMsg({ type: 'err', text: j.error ?? 'Error al aplicar enfoque' })
      }
    } catch {
      setSaveMsg({ type: 'err', text: 'No se pudo conectar con el backend' })
    } finally {
      setFocusLoading(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  const openCameraDialog = async () => {
    setDialogLoading(true)
    setSaveMsg(null)
    try {
      const r = await fetch(`${API}/api/cameras/settings-dialog`, { method: 'POST' })
      const j = await r.json()
      if (j.ok) {
        setSaveMsg({
          type: 'ok',
          text: '✓ Cerraste el panel de la cámara. Si cambiaste el foco ahí, desactiva el autofocus y guarda para fijarlo.',
        })
      } else {
        setSaveMsg({
          type: 'err',
          text: j.error ?? 'Esta cámara no abre panel de ajustes (prueba el control de abajo)',
        })
      }
    } catch {
      setSaveMsg({ type: 'err', text: 'No se pudo conectar con el backend' })
    } finally {
      setDialogLoading(false)
      setTimeout(() => setSaveMsg(null), 5000)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {saveMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`rounded-xl px-4 py-3 text-sm font-medium
              ${saveMsg.type === 'ok'
                ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-300'
                : 'bg-red-600/20 border border-red-500/30 text-red-300'}`}
          >
            {saveMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Cámaras ── */}
      <SectionCard title="Cámara" icon="📷">
        <div className="flex items-center justify-between">
          <p className={`text-xs ${t.textMuted}`}>
            {cameraScanning ? 'Detectando cámaras...' : `${cameras.length} dispositivo(s) encontrado(s)`}
          </p>
          <button
            onClick={fetchCameras}
            disabled={cameraScanning}
            className={`text-xs px-3 py-1.5 rounded-lg border ${t.borderMed} ${t.bgHover} ${t.textMuted}
                        disabled:opacity-40 transition-all`}
          >
            {cameraScanning
              ? <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : '↻ Re-escanear'}
          </button>
        </div>

        {cameras.length === 0 && !cameraScanning && (
          <p className={`text-xs ${t.textMuted} text-center py-4`}>
            No se detectaron cámaras. Conecta un dispositivo y re-escanea.
          </p>
        )}

        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {cameras.map(cam => (
            <SelectRow
              key={cam.index}
              item={cam}
              isSelected={selectedCamera === cam.index}
              isCurrent={currentCamera === cam.index}
              onSelect={() => setSelectedCamera(cam.index)}
            />
          ))}
        </div>

        {cameras.length > 0 && (
          <motion.button
            onClick={saveCamera}
            disabled={cameraLoading || selectedCamera === currentCamera}
            whileTap={{ scale: 0.97 }}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all
              ${selectedCamera !== currentCamera
                ? 'bg-gradient-to-r from-pink-600 to-[#CC0000] hover:from-pink-500 hover:to-[#990000] text-white'
                : `${t.bgCard} ${t.textMuted} opacity-50 cursor-not-allowed`}`}
          >
            {cameraLoading
              ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : selectedCamera === currentCamera
                ? 'Cámara seleccionada actualmente'
                : 'Aplicar cámara'}
          </motion.button>
        )}
      </SectionCard>

      {/* ── Enfoque ── */}
      <SectionCard title="Enfoque" icon="🎯">
        <p className={`text-xs ${t.textMuted}`}>
          Si la imagen se va y viene de foco, desactiva el autofocus y fija un valor manual
          (o abre el panel del driver de la cámara).
        </p>

        <motion.button
          onClick={() => setAutofocus(!autofocus)}
          whileTap={{ scale: 0.98 }}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all
            ${autofocus
              ? 'border-pink-500/60 bg-pink-500/10'
              : `border-transparent ${t.bgCard} ${t.bgHover}`
            }`}
        >
          <span className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center flex-shrink-0
            ${autofocus ? 'border-pink-500 bg-pink-500' : t.borderMed}`}>
            {autofocus && <span className="text-white text-xs">✓</span>}
          </span>
          <div className="text-left">
            <p className={`text-sm font-medium ${t.textBase}`}>Autofocus</p>
            <p className={`text-xs ${t.textMuted}`}>
              {autofocus ? 'La cámara enfoca sola (puede “buscar”)' : 'Enfoque fijo (recomendado en photobooth)'}
            </p>
          </div>
        </motion.button>

        {!autofocus && (
          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between">
              <label className={`text-xs font-medium ${t.textMuted}`}>Foco manual</label>
              <span className={`text-xs font-mono ${t.textBase}`}>{focus}</span>
            </div>
            <input
              type="range"
              min={0}
              max={255}
              value={focus}
              onChange={e => setFocus(Number(e.target.value))}
              className="w-full accent-pink-500"
            />
            <p className={`text-xs ${t.textMuted}`}>
              0 = no forzar (recomendado) · 1–255 = foco manual.
              Ojo: foco en 0 forzado deja negra / cuelga muchas cámaras.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <motion.button
            onClick={saveFocusConfig}
            disabled={focusLoading}
            whileTap={{ scale: 0.97 }}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all
              bg-gradient-to-r from-pink-600 to-[#CC0000] hover:from-pink-500 hover:to-[#990000] text-white"
          >
            {focusLoading
              ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : 'Aplicar enfoque'}
          </motion.button>
          <motion.button
            onClick={openCameraDialog}
            disabled={dialogLoading}
            whileTap={{ scale: 0.97 }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all
              ${t.borderMed} ${t.bgCard} ${t.textBase} ${t.bgHover}`}
          >
            {dialogLoading
              ? <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : '⚙ Panel de la cámara'}
          </motion.button>
        </div>
      </SectionCard>

      {/* ── Impresoras ── */}
      <SectionCard title="Impresora" icon="🖨️">
        <div className="flex items-center justify-between">
          <p className={`text-xs ${t.textMuted}`}>
            {printerScanning ? 'Detectando impresoras...' : `${printers.length} impresora(s) encontrada(s)`}
          </p>
          <button
            onClick={fetchPrinters}
            disabled={printerScanning}
            className={`text-xs px-3 py-1.5 rounded-lg border ${t.borderMed} ${t.bgHover} ${t.textMuted}
                        disabled:opacity-40 transition-all`}
          >
            {printerScanning
              ? <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : '↻ Re-escanear'}
          </button>
        </div>

        {printers.length === 0 && !printerScanning && (
          <p className={`text-xs ${t.textMuted} text-center py-4`}>
            No se encontraron impresoras instaladas.
          </p>
        )}

        {/* Opción "Sin impresora" */}
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          <SelectRow
            item={{ name: 'Sin impresora (deshabilitar impresión)' }}
            isSelected={selectedPrinter === null}
            isCurrent={currentPrinter === null}
            onSelect={() => setSelectedPrinter(null)}
          />
          {printers.map(p => (
            <SelectRow
              key={p.name}
              item={p}
              isSelected={selectedPrinter === p.name}
              isCurrent={currentPrinter === p.name}
              onSelect={() => setSelectedPrinter(p.name)}
            />
          ))}
        </div>

        <motion.button
          onClick={savePrinter}
          disabled={printerLoading || selectedPrinter === currentPrinter}
          whileTap={{ scale: 0.97 }}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all
            ${selectedPrinter !== currentPrinter
              ? 'bg-gradient-to-r from-pink-600 to-[#CC0000] hover:from-pink-500 hover:to-[#990000] text-white'
              : `${t.bgCard} ${t.textMuted} opacity-50 cursor-not-allowed`}`}
        >
          {printerLoading
            ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : selectedPrinter === currentPrinter
              ? 'Impresora seleccionada actualmente'
              : 'Guardar impresora'}
        </motion.button>
      </SectionCard>

      {/* ── Configuración de Flip ── */}
      <SectionCard title="Orientación de cámara" icon="🔄">
        <p className={`text-xs ${t.textMuted} mb-3`}>
          Ajusta los espejos horizontales y verticales si las fotos salen invertidas.
        </p>
        
        <div className="space-y-3">
          {/* Flip Horizontal */}
          <motion.button
            onClick={() => setFlipHorizontal(!flipHorizontal)}
            whileTap={{ scale: 0.98 }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all
              ${flipHorizontal
                ? 'border-pink-500/60 bg-pink-500/10'
                : `border-transparent ${t.bgCard} ${t.bgHover}`
              }`}
          >
            <span className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center flex-shrink-0
              ${flipHorizontal ? 'border-pink-500 bg-pink-500' : t.borderMed}`}>
              {flipHorizontal && <span className="text-white text-xs">✓</span>}
            </span>
            <span className={`text-sm font-medium ${t.textBase}`}>Espejo horizontal</span>
          </motion.button>

          {/* Flip Vertical */}
          <motion.button
            onClick={() => setFlipVertical(!flipVertical)}
            whileTap={{ scale: 0.98 }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all
              ${flipVertical
                ? 'border-pink-500/60 bg-pink-500/10'
                : `border-transparent ${t.bgCard} ${t.bgHover}`
              }`}
          >
            <span className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center flex-shrink-0
              ${flipVertical ? 'border-pink-500 bg-pink-500' : t.borderMed}`}>
              {flipVertical && <span className="text-white text-xs">✓</span>}
            </span>
            <span className={`text-sm font-medium ${t.textBase}`}>Espejo vertical</span>
          </motion.button>
        </div>

        <motion.button
          onClick={saveFlipConfig}
          disabled={flipLoading}
          whileTap={{ scale: 0.97 }}
          className={`w-full mt-4 py-2.5 rounded-xl text-sm font-semibold transition-all
            bg-gradient-to-r from-pink-600 to-[#CC0000] hover:from-pink-500 hover:to-[#990000] text-white`}
        >
          {flipLoading
            ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : 'Guardar configuración'}
        </motion.button>
      </SectionCard>
    </div>
  )
}
