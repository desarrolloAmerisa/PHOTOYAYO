"""
Admin API HTTP — aiohttp en puerto 8766.
//caca
Endpoints:
  GET    /api/events
  POST   /api/events
  PUT    /api/events/{id}
  DELETE /api/events/{id}
  POST   /api/events/{id}/activate
  DELETE /api/events/{id}/activate
  GET    /api/events/{id}/template
  POST   /api/events/{id}/template
  DELETE /api/events/{id}/template
  GET    /api/active
  GET    /api/cameras
  POST   /api/cameras/select
  GET    /api/focus-config
  POST   /api/focus-config
  POST   /api/cameras/settings-dialog
  GET    /api/printers
  POST   /api/printers/select
  POST   /api/print
  POST   /api/print/cancel
  GET    /api/print/queue
  POST   /api/print-preview
  GET    /api/print-config
  POST   /api/print-config
  GET    /api/events/{id}/strips
  GET    /api/events/{id}/strips/{n}
  GET    /api/templates
  POST   /api/templates
  PUT    /api/templates/{id}
  DELETE /api/templates/{id}
  GET    /api/templates/{id}/background
  POST   /api/templates/{id}/background
  DELETE /api/templates/{id}/background
"""

import io
import json
import os
import sys
import uuid
import base64
import tempfile
import subprocess
import asyncio
import threading
from aiohttp import web

ADMIN_PORT = 8766

# Tamaños de papel predefinidos: preset -> (ancho_in, alto_in)
PAPER_PRESETS: dict[str, tuple[float, float]] = {
    "4x6":    (4.0,   6.0),
    "5x7":    (5.0,   7.0),
    "letter": (8.5,  11.0),
    "a4":     (8.268, 11.693),
    "a5":     (5.827,  8.268),
}


# ── Detección de cámaras ──────────────────────────────────────────────────────
def _detect_cameras(max_index: int = 8) -> list[dict]:
    """
    Enumera cámaras disponibles SIN abrir ningún dispositivo de hardware,
    para no interferir con el stream que ya tiene el backend.

    En Windows usa PowerShell/WMI (Get-PnpDevice).  El índice devuelto
    corresponde al orden en que Windows los expone (0-based), que coincide
    con el índice de cv2.VideoCapture.
    En Linux/macOS escanea /dev/video*.
    """
    cameras = []

    if sys.platform == "win32":
        # ── WindowsCamera: enumerar con PnpDevice (sin abrir HW) ──────────
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-PnpDevice -Class Camera -Status OK "
                 "| Sort-Object InstanceId "
                 "| Select-Object FriendlyName "
                 "| ConvertTo-Json -Compress"],
                capture_output=True, text=True, timeout=8
            )
            if result.returncode == 0 and result.stdout.strip():
                raw = json.loads(result.stdout)
                if isinstance(raw, dict):
                    raw = [raw]
                for idx, p in enumerate(raw):
                    name = p.get("FriendlyName") or f"Cámara {idx}"
                    cameras.append({"index": idx, "label": name, "resolution": ""})
                if cameras:
                    return cameras
        except Exception:
            pass
        # Fallback Windows: WMI vía consulta directa
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-WmiObject Win32_PnPEntity "
                 "| Where-Object { $_.PNPClass -eq 'Camera' } "
                 "| Sort-Object Name "
                 "| Select-Object Name "
                 "| ConvertTo-Json -Compress"],
                capture_output=True, text=True, timeout=8
            )
            if result.returncode == 0 and result.stdout.strip():
                raw = json.loads(result.stdout)
                if isinstance(raw, dict):
                    raw = [raw]
                for idx, p in enumerate(raw):
                    name = p.get("Name") or f"Cámara {idx}"
                    cameras.append({"index": idx, "label": name, "resolution": ""})
                if cameras:
                    return cameras
        except Exception:
            pass
        # Último fallback Windows: numeración genérica (sin abrir HW)
        cameras = [{"index": 0, "label": "Cámara predeterminada", "resolution": ""}]
    else:
        # Linux: /dev/video*
        import glob
        for path in sorted(glob.glob("/dev/video*")):
            try:
                idx = int(path.replace("/dev/video", ""))
                cameras.append({"index": idx, "label": f"Video {idx} ({path})", "resolution": ""})
            except ValueError:
                pass
        if not cameras:
            cameras = [{"index": 0, "label": "Cámara predeterminada", "resolution": ""}]

    return cameras


# ── Detección de impresoras (Windows / cross-platform) ───────────────────────
def _detect_printers() -> list[dict]:
    """Devuelve lista de impresoras instaladas en el sistema."""
    printers = []
    # Windows: usar win32print si disponible, si no PowerShell
    if sys.platform == "win32":
        try:
            import win32print
            default = win32print.GetDefaultPrinter()
            for flags, desc, name, comment in win32print.EnumPrinters(
                win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
            ):
                printers.append({
                    "name":      name,
                    "isDefault": name == default,
                    "comment":   comment or "",
                })
            return printers
        except ImportError:
            pass
        # Fallback: PowerShell
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-Printer | Select-Object Name,Default | ConvertTo-Json"],
                capture_output=True, text=True, timeout=8
            )
            if result.returncode == 0 and result.stdout.strip():
                raw = json.loads(result.stdout)
                if isinstance(raw, dict):
                    raw = [raw]
                for p in raw:
                    printers.append({
                        "name":      p.get("Name", ""),
                        "isDefault": bool(p.get("Default", False)),
                        "comment":   "",
                    })
            return printers
        except Exception:
            pass
    # Linux/macOS: lpstat
    try:
        result = subprocess.run(
            ["lpstat", "-p"], capture_output=True, text=True, timeout=8
        )
        for line in result.stdout.splitlines():
            if line.startswith("printer "):
                parts = line.split()
                printers.append({"name": parts[1], "isDefault": False, "comment": ""})
        # marcar default
        def_result = subprocess.run(
            ["lpstat", "-d"], capture_output=True, text=True, timeout=4
        )
        if "system default destination:" in def_result.stdout:
            def_name = def_result.stdout.split(":")[-1].strip()
            for p in printers:
                if p["name"] == def_name:
                    p["isDefault"] = True
    except Exception:
        pass
    return printers


# ── Job de impresión actual (para cancelar) ───────────────────────────────────
_print_lock = threading.Lock()
_print_job: dict = {
    "id": None,
    "cancel": False,
    "printer": None,
    "doc_tag": None,
    "spooler_jobs": [],
    "session": None,
}


def _job_document(job: dict) -> str:
    return str(job.get("pDocument") or job.get("Document") or "")


def _find_spooler_job(printer: str, doc_name: str) -> int | None:
    if sys.platform != "win32" or not printer or not doc_name:
        return None
    try:
        import win32print
        handle = win32print.OpenPrinter(printer)
        try:
            for job in win32print.EnumJobs(handle, 0, 999, 1) or []:
                if _job_document(job) == doc_name:
                    return job.get("JobId")
        finally:
            win32print.ClosePrinter(handle)
    except Exception:
        pass
    return None


def _resolve_printer(printer: str | None) -> str | None:
    if printer:
        return printer
    if sys.platform != "win32":
        return None
    try:
        import win32print
        return win32print.GetDefaultPrinter()
    except Exception:
        return None


def _open_printer(printer: str, admin: bool = False):
    import win32print
    if admin:
        try:
            return win32print.OpenPrinter(
                printer, {"DesiredAccess": win32print.PRINTER_ALL_ACCESS}
            )
        except Exception:
            pass
    return win32print.OpenPrinter(printer)


def _list_spooler_jobs(printer: str | None) -> list[dict]:
    printer = _resolve_printer(printer)
    if sys.platform != "win32" or not printer:
        return []
    try:
        import win32print
        handle = _open_printer(printer)
        try:
            jobs = []
            for job in win32print.EnumJobs(handle, 0, 999, 1) or []:
                jobs.append({
                    "id":       job.get("JobId"),
                    "document": _job_document(job),
                    "status":   job.get("Status", 0),
                    "pages":    job.get("TotalPages") or job.get("PagesPrinted") or 0,
                })
            return jobs
        finally:
            win32print.ClosePrinter(handle)
    except Exception:
        return []


def _delete_spooler_jobs(printer: str, jobs: list[dict]) -> int:
    import win32print
    handle = _open_printer(printer, admin=True)
    cancelled = 0
    try:
        for job in jobs:
            jid = job.get("id") or job.get("JobId")
            if jid is None:
                continue
            for control in (
                getattr(win32print, "JOB_CONTROL_DELETE", 5),
                getattr(win32print, "JOB_CONTROL_CANCEL", 3),
            ):
                try:
                    win32print.SetJob(handle, jid, 0, None, control)
                    cancelled += 1
                    break
                except Exception:
                    continue
    finally:
        win32print.ClosePrinter(handle)
    return cancelled


def _cancel_spooler_jobs(
    printer: str | None,
    job_ids: list | None = None,
    doc_tag: str | None = None,
    purge_all: bool = False,
) -> int:
    """Borra trabajos del spooler. Si purge_all, vacía toda la cola."""
    printer = _resolve_printer(printer)
    if sys.platform != "win32" or not printer:
        return 0
    jobs = _list_spooler_jobs(printer)
    if not jobs:
        return 0
    if purge_all:
        return _purge_printer_queue(printer)
    ids = set(job_ids or [])
    selected = [
        j for j in jobs
        if j.get("id") in ids or (doc_tag and doc_tag in str(j.get("document") or ""))
    ]
    return _delete_spooler_jobs(printer, selected)


def _purge_printer_queue(printer: str | None) -> int:
    """Vacía toda la cola de la impresora (Windows)."""
    printer = _resolve_printer(printer)
    if sys.platform != "win32" or not printer:
        return 0
    jobs = _list_spooler_jobs(printer)
    count = len(jobs)
    try:
        import win32print
        handle = _open_printer(printer, admin=True)
        try:
            win32print.SetPrinter(handle, 0, None, win32print.PRINTER_CONTROL_PURGE)
            leftover = _list_spooler_jobs(printer)
            if leftover:
                count = max(count, _delete_spooler_jobs(printer, leftover) + (count - len(leftover)))
            return count
        finally:
            win32print.ClosePrinter(handle)
    except Exception:
        if jobs:
            return _delete_spooler_jobs(printer, jobs)
        return 0


# ── Enviar imagen a impresora ─────────────────────────────────────────────────
def _print_image(
    image_path: str,
    printer_name: str | None,
    doc_name: str | None = None,
) -> tuple[bool, str, int | None]:
    """Imprime un archivo de imagen. Devuelve (ok, msg, spooler_job_id)."""
    title = doc_name or os.path.basename(image_path)
    if sys.platform == "win32":
        # Intentar con win32print + PIL
        try:
            import win32print
            import win32ui
            from PIL import Image

            printer = printer_name or win32print.GetDefaultPrinter()
            img     = Image.open(image_path)

            hdc   = win32ui.CreateDC()
            hdc.CreatePrinterDC(printer)
            hdc.StartDoc(title)
            hdc.StartPage()

            pw = hdc.GetDeviceCaps(110)   # HORZRES
            ph = hdc.GetDeviceCaps(111)   # VERTRES

            iw, ih = img.size
            ratio  = min(pw / iw, ph / ih)
            dw, dh = int(iw * ratio), int(ih * ratio)
            ox, oy = (pw - dw) // 2, (ph - dh) // 2

            from PIL import ImageWin
            dib = ImageWin.Dib(img)
            dib.draw(hdc.GetHandleOutput(), (ox, oy, ox + dw, oy + dh))
            hdc.EndPage()
            hdc.EndDoc()
            hdc.DeleteDC()
            return True, "OK", _find_spooler_job(printer, title)
        except ImportError:
            pass
        # Fallback: ShellExecute print verb
        try:
            import win32api
            win32api.ShellExecute(0, "print", image_path, f'"{printer_name}"' if printer_name else None, ".", 0)
            return True, "OK (ShellExecute)", None
        except ImportError:
            pass
        # Último fallback: mspaint silencioso
        try:
            cmd = ["mspaint", "/pt", image_path]
            if printer_name:
                cmd.append(printer_name)
            subprocess.Popen(cmd)
            return True, "OK (mspaint)", None
        except Exception as exc:
            return False, str(exc), None
    else:
        # Linux/macOS: lp
        try:
            cmd = ["lp"]
            if printer_name:
                cmd += ["-d", printer_name]
            if doc_name:
                cmd += ["-t", doc_name]
            cmd.append(image_path)
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if result.returncode == 0:
                return True, result.stdout.strip(), None
            return False, result.stderr.strip(), None
        except Exception as exc:
            return False, str(exc), None
MAX_UPLOAD  = 20 * 1024 * 1024  # 20 MB


def _cors() -> dict:
    return {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


def _ok(data, status: int = 200) -> web.Response:
    return web.Response(
        text=json.dumps(data, ensure_ascii=False),
        content_type="application/json",
        status=status,
        headers=_cors(),
    )


def _err(msg: str, status: int = 400) -> web.Response:
    return _ok({"error": msg}, status)


def make_admin_app(
    em,
    tm=None,
    broadcast_fn=None,
    settings_ref: dict | None = None,
    on_camera_change=None,
    on_settings_save=None,
    on_focus_apply=None,
    on_camera_settings_dialog=None,
) -> web.Application:
    """Construye la aplicación aiohttp para el panel de administración.

    em               — EventsManager.
    tm               — TemplatesManager.
    settings_ref     — dict mutable compartido para persistir cámara/impresora.
    on_camera_change — coroutine(index) para reiniciar VideoCapture en caliente.
    on_settings_save — callable() que persiste settings_ref a disco.
    on_focus_apply   — coroutine() reaplica autofocus/focus en la cámara abierta.
    on_camera_settings_dialog — coroutine() abre el panel nativo DirectShow.
    """
    if settings_ref is None:
        settings_ref = {}

    async def _notify_event_change():
        if broadcast_fn is None:
            return
        active = em.get_active()
        try:
            await broadcast_fn({
                "type":        "active_event",
                "activeEvent": active,
                "activeId":    em.active_id,
            })
        except Exception:
            pass

    # ── Preflight CORS ────────────────────────────────────────────────────────
    async def handle_options(request):
        return web.Response(status=204, headers=_cors())

    # ── Listar / crear eventos ─────────────────────────────────────────────────
    async def get_events(request):
        return _ok({"events": em.list_events(), "activeId": em.active_id})

    async def create_event(request):
        try:
            body        = await request.json()
            name        = str(body.get("name", "")).strip()
            width       = int(body.get("width",       600))
            height      = int(body.get("height",      600))
            photo_count = int(body.get("photoCount",    3))
            timer_secs  = int(body.get("timerSecs",     3))
        except Exception:
            return _err("JSON inválido")
        if not name:
            return _err("El nombre del evento es requerido")
        if not (50 <= width <= 8000) or not (50 <= height <= 8000):
            return _err("Dimensiones inválidas (50 – 8 000 px)")
        template_id = body.get("templateId") or None
        ingest_url  = body.get("ingestUrl") or None
        return _ok(em.create_event(name, width, height, photo_count, timer_secs, template_id, ingest_url), 201)

    # ── Actualizar / eliminar evento ──────────────────────────────────────────
    async def update_event(request):
        eid = request.match_info["id"]
        try:
            body = await request.json()
        except Exception:
            return _err("JSON inválido")
        kwargs = dict(
            name=body.get("name"),
            width=body.get("width"),
            height=body.get("height"),
            photoCount=body.get("photoCount"),
            timerSecs=body.get("timerSecs"),
            templateId=body.get("templateId"),  # puede ser None para limpiar
        )
        if "ingestUrl" in body:
            kwargs["ingestUrl"] = body.get("ingestUrl") or ""
        result = em.update_event(eid, **kwargs)
        return _ok(result) if result else _err("Evento no encontrado", 404)

    async def delete_event(request):
        eid = request.match_info["id"]
        return _ok({"ok": True}) if em.delete_event(eid) else _err("Evento no encontrado", 404)

    # ── Activar / desactivar ──────────────────────────────────────────────────
    async def activate_event(request):
        eid = request.match_info["id"]
        if not em.activate(eid):
            return _err("Evento no encontrado", 404)
        await _notify_event_change()
        return _ok({"ok": True, "activeId": eid})

    async def deactivate_event(request):
        em.deactivate()
        await _notify_event_change()
        return _ok({"ok": True, "activeId": None})

    async def get_active(request):
        return _ok({"event": em.get_active(), "activeId": em.active_id})

    # ── Cámaras ───────────────────────────────────────────────────────────────
    async def get_cameras(request):
        loop    = asyncio.get_event_loop()
        cameras = await loop.run_in_executor(None, _detect_cameras)
        current = settings_ref.get("camera_index", 0)
        return _ok({"cameras": cameras, "current": current})

    async def select_camera(request):
        try:
            body  = await request.json()
            index = int(body.get("index", 0))
        except Exception:
            return _err("JSON inválido")
        settings_ref["camera_index"] = index
        # Llamar directamente al callback del backend para reiniciar la cap
        if on_camera_change:
            try:
                await on_camera_change(index)
            except Exception as exc:
                print(f"[CAM] Error al cambiar cámara: {exc}")
        if on_settings_save:
            on_settings_save()
        return _ok({"ok": True, "camera_index": index})

    # ── Configuración de Flip ─────────────────────────────────────────────────
    async def get_flip_config(request):
        flip_h = settings_ref.get("flip_horizontal", False)
        flip_v = settings_ref.get("flip_vertical", False)
        return _ok({"flip_horizontal": flip_h, "flip_vertical": flip_v})

    async def set_flip_config(request):
        try:
            body = await request.json()
            flip_h = bool(body.get("flip_horizontal", False))
            flip_v = bool(body.get("flip_vertical", False))
        except Exception:
            return _err("JSON inválido")
        settings_ref["flip_horizontal"] = flip_h
        settings_ref["flip_vertical"] = flip_v
        if on_settings_save:
            on_settings_save()
        return _ok({"ok": True, "flip_horizontal": flip_h, "flip_vertical": flip_v})

    # ── Enfoque de cámara ─────────────────────────────────────────────────────
    async def get_focus_config(request):
        return _ok({
            "autofocus": bool(settings_ref.get("autofocus", False)),
            "focus":     int(settings_ref.get("focus", 0) or 0),
        })

    async def set_focus_config(request):
        try:
            body = await request.json()
            autofocus = bool(body.get("autofocus", False))
            focus = int(body.get("focus", 0) or 0)
        except Exception:
            return _err("JSON inválido")
        focus = max(0, min(255, focus))
        settings_ref["autofocus"] = autofocus
        settings_ref["focus"] = focus
        if on_settings_save:
            on_settings_save()
        if on_focus_apply:
            try:
                await on_focus_apply()
            except Exception as exc:
                print(f"[CAM] Error al aplicar enfoque: {exc}")
                return _err(f"Guardado, pero no se pudo aplicar: {exc}")
        return _ok({"ok": True, "autofocus": autofocus, "focus": focus})

    async def open_camera_settings_dialog(request):
        if not on_camera_settings_dialog:
            return _err("No disponible")
        try:
            ok = await on_camera_settings_dialog()
        except Exception as exc:
            print(f"[CAM] Error al abrir panel de cámara: {exc}")
            return _err(str(exc))
        return _ok({"ok": bool(ok)})

    # ── Impresoras ────────────────────────────────────────────────────────────
    async def get_printers(request):
        loop     = asyncio.get_event_loop()
        printers = await loop.run_in_executor(None, _detect_printers)
        current  = settings_ref.get("printer_name", None)
        return _ok({"printers": printers, "current": current})

    async def select_printer(request):
        try:
            body = await request.json()
            name = body.get("name", None)
        except Exception:
            return _err("JSON inválido")
        settings_ref["printer_name"] = name if name else None
        if on_settings_save:
            on_settings_save()
        return _ok({"ok": True, "printer_name": settings_ref["printer_name"]})

    # ── Configuración de impresión ────────────────────────────────────────────
    async def get_print_config(request):
        from copy import deepcopy
        cfg = settings_ref.get("print_config") or {}
        # Completar con defaults si faltan claves
        defaults = {
            "paper_preset": "4x6", "paper_w_in": 4.0, "paper_h_in": 6.0,
            "orientation": "portrait",
            "margin_top_mm": 5, "margin_bottom_mm": 5,
            "margin_left_mm": 5, "margin_right_mm": 5,
            "copies": 1,
        }
        return _ok({**defaults, **cfg})

    async def set_print_config(request):
        try:
            body = await request.json()
        except Exception:
            return _err("JSON inválido")

        preset = str(body.get("paper_preset", "custom")).strip()
        if preset in PAPER_PRESETS:
            w_in, h_in = PAPER_PRESETS[preset]
        else:
            preset = "custom"
            try:
                w_in = max(1.0, min(24.0, float(body.get("paper_w_in", 4.0))))
                h_in = max(1.0, min(24.0, float(body.get("paper_h_in", 6.0))))
            except (TypeError, ValueError):
                return _err("Dimensiones de papel inválidas")

        orientation = body.get("orientation", "portrait")
        if orientation not in ("portrait", "landscape"):
            orientation = "portrait"

        def _clamp_margin(v):
            try:
                return max(0, min(50, int(v)))
            except (TypeError, ValueError):
                return 5

        cfg = {
            "paper_preset":     preset,
            "paper_w_in":       round(w_in, 3),
            "paper_h_in":       round(h_in, 3),
            "orientation":      orientation,
            "margin_top_mm":    _clamp_margin(body.get("margin_top_mm",    5)),
            "margin_bottom_mm": _clamp_margin(body.get("margin_bottom_mm", 5)),
            "margin_left_mm":   _clamp_margin(body.get("margin_left_mm",   5)),
            "margin_right_mm":  _clamp_margin(body.get("margin_right_mm",  5)),
            "copies":           max(1, min(10, int(body.get("copies", 1)))),
        }
        settings_ref["print_config"] = cfg
        if on_settings_save:
            on_settings_save()
        return _ok({"ok": True, "print_config": cfg})

    # ── Imprimir ──────────────────────────────────────────────────────────────
    async def print_strip(request):
        """Recibe { image_b64, path, eventId, session } y manda a imprimir."""
        try:
            body = await request.json()
        except Exception:
            return _err("JSON inválido")

        image_b64  = body.get("image_b64")
        image_path = body.get("path")
        session_n  = body.get("session")
        event_id   = body.get("eventId") or em.active_id

        tmp_file = None
        try:
            if session_n is not None and not image_b64 and not image_path:
                strip_path = em.get_strip_path(event_id, session_n)
                if not strip_path:
                    return _err("Tira no encontrada")
                image_path = str(strip_path)
                try:
                    session_n = int(session_n)
                except (TypeError, ValueError):
                    session_n = None

            if image_b64:
                suffix = ".jpg"
                tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix)
                os.close(tmp_fd)
                with open(tmp_path, "wb") as f:
                    f.write(base64.b64decode(image_b64))
                image_path = tmp_path
                tmp_file   = tmp_path

            if not image_path or not os.path.exists(image_path):
                return _err("No se especificó imagen válida")

            printer     = settings_ref.get("printer_name", None)
            pc          = settings_ref.get("print_config") or {}
            copies      = max(1, min(10, int(pc.get("copies", 1))))
            loop        = asyncio.get_event_loop()
            job_id      = uuid.uuid4().hex[:8]
            doc_tag     = f"PHOTOBOOTH|{job_id}"
            printer_lbl = printer or "impresora predeterminada"

            with _print_lock:
                _print_job.update({
                    "id": job_id,
                    "cancel": False,
                    "printer": printer,
                    "doc_tag": doc_tag,
                    "spooler_jobs": [],
                    "session": session_n,
                })

            if broadcast_fn:
                try:
                    await broadcast_fn({
                        "type":    "print_start",
                        "jobId":   job_id,
                        "printer": printer_lbl,
                        "copies":  copies,
                        "session": session_n,
                    })
                except Exception:
                    pass

            last_ok, last_msg = False, "Sin copias"
            cancelled = False
            for i in range(copies):
                with _print_lock:
                    if _print_job.get("id") == job_id and _print_job.get("cancel"):
                        cancelled = True
                        last_ok, last_msg = False, "Cancelado"
                        break
                doc_name = f"{doc_tag}|{i + 1}"
                last_ok, last_msg, spooler_id = await loop.run_in_executor(
                    None, _print_image, image_path, printer, doc_name
                )
                if spooler_id:
                    with _print_lock:
                        if _print_job.get("id") == job_id:
                            _print_job["spooler_jobs"].append(spooler_id)
                with _print_lock:
                    if _print_job.get("id") == job_id and _print_job.get("cancel"):
                        cancelled = True
                        _purge_printer_queue(printer)
                        last_ok, last_msg = False, "Cancelado"
                        break

            with _print_lock:
                cancelled = cancelled or bool(
                    _print_job.get("id") == job_id and _print_job.get("cancel")
                )
                if _print_job.get("id") == job_id:
                    _print_job.update({
                        "id": None,
                        "cancel": False,
                        "doc_tag": None,
                        "spooler_jobs": [],
                        "session": None,
                    })

            if broadcast_fn:
                try:
                    await broadcast_fn({
                        "type":      "print_done",
                        "ok":        last_ok and not cancelled,
                        "cancelled": cancelled,
                        "msg":       "Cancelado" if cancelled else last_msg,
                        "copies":    copies,
                        "printer":   printer_lbl,
                        "session":   session_n,
                    })
                except Exception:
                    pass

            return _ok({
                "ok": last_ok and not cancelled,
                "cancelled": cancelled,
                "msg": "Cancelado" if cancelled else last_msg,
                "copies": copies,
            })
        except Exception as exc:
            return _err(str(exc))
        finally:
            if tmp_file and os.path.exists(tmp_file):
                try:
                    os.remove(tmp_file)
                except Exception:
                    pass

    async def cancel_print(request):
        """Cancela el job actual y vacía toda la cola de la impresora."""
        with _print_lock:
            printer = _print_job.get("printer") or settings_ref.get("printer_name")
            had_job = bool(_print_job.get("id"))
            _print_job["cancel"] = True
            session_n = _print_job.get("session")
        printer = _resolve_printer(printer)
        loop = asyncio.get_event_loop()
        n = await loop.run_in_executor(None, _purge_printer_queue, printer)
        if had_job and broadcast_fn:
            try:
                await broadcast_fn({
                    "type":      "print_done",
                    "ok":        False,
                    "cancelled": True,
                    "msg":       f"Cola vaciada ({n})" if n else "Cancelado",
                    "copies":    0,
                    "printer":   printer or "impresora predeterminada",
                    "session":   session_n,
                })
            except Exception:
                pass
        return _ok({
            "ok": True,
            "cancelledJobs": n,
            "msg": f"Cola vaciada ({n})" if n else "Cola vacía",
        })

    async def get_print_queue(request):
        printer = _resolve_printer(settings_ref.get("printer_name"))
        loop = asyncio.get_event_loop()
        jobs = await loop.run_in_executor(None, _list_spooler_jobs, printer)
        return _ok({
            "printer": printer,
            "count":   len(jobs),
            "jobs":    jobs,
        })

    async def list_event_strips(request):
        eid = request.match_info["id"]
        if eid not in em.events:
            return _err("Evento no encontrado", 404)
        return _ok({"strips": em.list_strips(eid)})

    async def get_event_strip(request):
        eid = request.match_info["id"]
        try:
            n = int(request.match_info["n"])
        except (TypeError, ValueError):
            return _err("Número de tira inválido")
        path = em.get_strip_path(eid, n)
        if not path:
            return _err("Tira no encontrada", 404)
        thumb = str(request.query.get("thumb", "")).lower() in ("1", "true", "yes")
        if thumb:
            from PIL import Image
            img = Image.open(path)
            img.thumbnail((280, 900))
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=72)
            return web.Response(
                body=buf.getvalue(),
                content_type="image/jpeg",
                headers={**_cors(), "Cache-Control": "private, max-age=3600"},
            )
        return web.FileResponse(
            path,
            headers={**_cors(), "Cache-Control": "private, max-age=60"},
        )

    async def print_preview(request):
        """
        Recibe { image_b64: "..." } y devuelve un JPEG simulando la tira
        sobre el papel según la configuración de impresión guardada.
        """
        try:
            body = await request.json()
        except Exception:
            return _err("JSON inválido")

        image_b64 = body.get("image_b64")
        if not image_b64:
            return _err("image_b64 requerido")

        def _build_preview():
            from PIL import Image as PILImage, ImageDraw
            import io as _io

            dpi = 150
            pc  = settings_ref.get("print_config") or {}

            # Tamaño de papel desde la configuración guardada
            paper_w_in = float(pc.get("paper_w_in", 4.0))
            paper_h_in = float(pc.get("paper_h_in", 6.0))
            orientation = pc.get("orientation", "portrait")

            # Si es landscape, intercambiar ejes del papel
            if orientation == "landscape":
                paper_w_in, paper_h_in = paper_h_in, paper_w_in

            # Márgenes (mm → px)
            def mm_to_px(mm): return max(0, int(mm / 25.4 * dpi))
            mt = mm_to_px(pc.get("margin_top_mm",    5))
            mb = mm_to_px(pc.get("margin_bottom_mm", 5))
            ml = mm_to_px(pc.get("margin_left_mm",   5))
            mr = mm_to_px(pc.get("margin_right_mm",  5))

            pw_px = int(paper_w_in * dpi)
            ph_px = int(paper_h_in * dpi)

            img_bytes = base64.b64decode(image_b64)
            strip = PILImage.open(_io.BytesIO(img_bytes)).convert("RGB")

            # Rotar tira si es landscape para aprovechar el ancho
            if orientation == "landscape":
                strip = strip.rotate(-90, expand=True)
            iw, ih = strip.size

            avail_w = max(1, pw_px - ml - mr)
            avail_h = max(1, ph_px - mt - mb)
            ratio   = min(avail_w / iw, avail_h / ih)
            new_w   = int(iw * ratio)
            new_h   = int(ih * ratio)
            strip_r = strip.resize((new_w, new_h), PILImage.LANCZOS)

            page = PILImage.new("RGB", (pw_px, ph_px), (248, 248, 248))
            draw = ImageDraw.Draw(page)
            draw.rectangle([0, 0, pw_px - 1, ph_px - 1],
                           outline=(185, 185, 185), width=2)

            # Centrar la tira dentro del área imprimible
            ox = ml + (avail_w - new_w) // 2
            oy = mt + (avail_h - new_h) // 2
            page.paste(strip_r, (ox, oy))

            # Guías de margen punteadas (rosa/gris)
            draw2 = ImageDraw.Draw(page)
            for i in range(0, pw_px, 6):
                if mt > 0: draw2.point((i, mt),        fill=(210, 120, 180))
                if mb > 0: draw2.point((i, ph_px - mb), fill=(210, 120, 180))
            for i in range(0, ph_px, 6):
                if ml > 0: draw2.point((ml, i),        fill=(210, 120, 180))
                if mr > 0: draw2.point((pw_px - mr, i), fill=(210, 120, 180))

            # Escalar para transporte (máx 900px en el lado largo)
            long_side = max(pw_px, ph_px)
            if long_side > 900:
                scale = 900 / long_side
                page  = page.resize(
                    (int(pw_px * scale), int(ph_px * scale)), PILImage.LANCZOS
                )

            buf = _io.BytesIO()
            page.save(buf, format="JPEG", quality=88)
            return base64.b64encode(buf.getvalue()).decode(), paper_w_in, paper_h_in

        loop = asyncio.get_event_loop()
        try:
            b64, pw, ph = await loop.run_in_executor(None, _build_preview)
        except Exception as exc:
            return _err(f"Error generando preview: {exc}")

        return _ok({
            "preview_b64": b64,
            "paper_w_in":  round(pw, 2),
            "paper_h_in":  round(ph, 2),
        })

    # ── Plantilla ─────────────────────────────────────────────────────────────
    async def get_template(request):
        eid  = request.match_info["id"]
        path = em.get_template_path(eid)
        if not path:
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers=_cors())

    async def upload_template(request):
        eid = request.match_info["id"]
        try:
            reader = await request.multipart()
            field  = await reader.next()
            if field is None or field.name != "file":
                return _err("Campo 'file' requerido en multipart")
            data = b""
            while True:
                chunk = await field.read_chunk(8192)
                if not chunk:
                    break
                data += chunk
                if len(data) > MAX_UPLOAD:
                    return _err("El archivo supera el límite de 20 MB", 413)
        except Exception as exc:
            return _err(f"Error al leer el archivo: {exc}")

        event, err = em.set_template(eid, data)
        return _ok(event) if event else _err(err)

    async def delete_template(request):
        eid = request.match_info["id"]
        return (
            _ok({"ok": True})
            if em.remove_template(eid)
            else _err("Evento no encontrado", 404)
        )

    # ── Plantillas interactivas (TemplatesManager) ────────────────────────────
    async def list_templates(request):
        if tm is None:
            return _ok({"templates": []})
        return _ok({"templates": tm.list_templates()})

    async def create_template(request):
        if tm is None:
            return _err("TemplatesManager no disponible", 503)
        try:
            body   = await request.json()
            name   = str(body.get("name", "")).strip()
            width  = int(body.get("width",  800))
            height = int(body.get("height", 600))
        except Exception:
            return _err("JSON inválido")
        if not name:
            return _err("El nombre de la plantilla es requerido")
        if not (50 <= width <= 8000) or not (50 <= height <= 8000):
            return _err("Dimensiones inválidas (50 – 8 000 px)")
        return _ok(tm.create_template(name, width, height), 201)

    async def update_tpl(request):
        if tm is None:
            return _err("TemplatesManager no disponible", 503)
        tid = request.match_info["id"]
        try:
            body = await request.json()
        except Exception:
            return _err("JSON inválido")
        result = tm.update_template(
            tid,
            name=body.get("name"),
            slots=body.get("slots"),
        )
        return _ok(result) if result else _err("Plantilla no encontrada", 404)

    async def delete_tpl(request):
        if tm is None:
            return _err("TemplatesManager no disponible", 503)
        tid = request.match_info["id"]
        return _ok({"ok": True}) if tm.delete_template(tid) else _err("Plantilla no encontrada", 404)

    async def get_tpl_background(request):
        if tm is None:
            raise web.HTTPNotFound()
        tid  = request.match_info["id"]
        path = tm.get_background_path(tid)
        if not path:
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers=_cors())

    async def upload_tpl_background(request):
        if tm is None:
            return _err("TemplatesManager no disponible", 503)
        tid = request.match_info["id"]
        try:
            reader = await request.multipart()
            field  = await reader.next()
            if field is None or field.name != "file":
                return _err("Campo 'file' requerido en multipart")
            data = b""
            while True:
                chunk = await field.read_chunk(8192)
                if not chunk:
                    break
                data += chunk
                if len(data) > MAX_UPLOAD:
                    return _err("El archivo supera el límite de 20 MB", 413)
        except Exception as exc:
            return _err(f"Error al leer el archivo: {exc}")
        t, err = tm.set_background(tid, data)
        return _ok(t) if t else _err(err)

    async def delete_tpl_background(request):
        if tm is None:
            return _err("TemplatesManager no disponible", 503)
        tid = request.match_info["id"]
        return (
            _ok({"ok": True})
            if tm.remove_background(tid)
            else _err("Plantilla no encontrada", 404)
        )

    # ── Routing ───────────────────────────────────────────────────────────────
    app = web.Application()
    app.router.add_route("OPTIONS", "/{path_info:.*}",          handle_options)
    app.router.add_get(    "/api/events",                        get_events)
    app.router.add_post(   "/api/events",                        create_event)
    app.router.add_put(    "/api/events/{id}",                   update_event)
    app.router.add_delete( "/api/events/{id}",                   delete_event)
    app.router.add_post(   "/api/events/{id}/activate",          activate_event)
    app.router.add_delete( "/api/events/{id}/activate",          deactivate_event)
    app.router.add_get(    "/api/events/{id}/template",          get_template)
    app.router.add_post(   "/api/events/{id}/template",          upload_template)
    app.router.add_delete( "/api/events/{id}/template",          delete_template)
    app.router.add_get(    "/api/active",                        get_active)
    app.router.add_get(    "/api/cameras",                       get_cameras)
    app.router.add_post(   "/api/cameras/select",                select_camera)
    app.router.add_get(    "/api/focus-config",                  get_focus_config)
    app.router.add_post(   "/api/focus-config",                  set_focus_config)
    app.router.add_post(   "/api/cameras/settings-dialog",       open_camera_settings_dialog)
    app.router.add_get(    "/api/flip-config",                   get_flip_config)
    app.router.add_post(   "/api/flip-config",                   set_flip_config)
    app.router.add_get(    "/api/printers",                      get_printers)
    app.router.add_post(   "/api/printers/select",               select_printer)
    app.router.add_post(   "/api/print",                         print_strip)
    app.router.add_post(   "/api/print/cancel",                  cancel_print)
    app.router.add_get(    "/api/print/queue",                   get_print_queue)
    app.router.add_get(    "/api/events/{id}/strips",            list_event_strips)
    app.router.add_get(    "/api/events/{id}/strips/{n}",        get_event_strip)
    app.router.add_post(   "/api/print-preview",                 print_preview)
    app.router.add_get(    "/api/print-config",                  get_print_config)
    app.router.add_post(   "/api/print-config",                  set_print_config)
    # Plantillas interactivas
    app.router.add_get(    "/api/templates",                     list_templates)
    app.router.add_post(   "/api/templates",                     create_template)
    app.router.add_put(    "/api/templates/{id}",                update_tpl)
    app.router.add_delete( "/api/templates/{id}",                delete_tpl)
    app.router.add_get(    "/api/templates/{id}/background",     get_tpl_background)
    app.router.add_post(   "/api/templates/{id}/background",     upload_tpl_background)
    app.router.add_delete( "/api/templates/{id}/background",     delete_tpl_background)
    return app


async def start_admin_server(
    em,
    tm=None,
    broadcast_fn=None,
    settings_ref=None,
    on_camera_change=None,
    on_settings_save=None,
    on_focus_apply=None,
    on_camera_settings_dialog=None,
) -> web.AppRunner:
    runner = web.AppRunner(
        make_admin_app(
            em, tm, broadcast_fn, settings_ref,
            on_camera_change, on_settings_save,
            on_focus_apply, on_camera_settings_dialog,
        )
    )
    await runner.setup()
    await web.TCPSite(runner, "localhost", ADMIN_PORT).start()
    print(f"  Admin API  → http://localhost:{ADMIN_PORT}")
    return runner

