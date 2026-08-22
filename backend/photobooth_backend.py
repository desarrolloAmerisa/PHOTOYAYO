"""
PHOTOBOOTH BACKEND  —  WebSocket Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ws://localhost:8765

Mensajes  →  cliente:
  init       estado inicial al conectar
  frame      JPEG base64 + gesto + palmProgress
  state      cambio de estado
  countdown  valor del contador (cuando cambia)
  flash      disparo de foto
  strip      tira completa base64

Mensajes  ←  cliente:
  toggle_debug
  quit
"""

import asyncio
import websockets
import json
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import numpy as np
import base64
import time
import os
import sys
import re
import urllib.request
import concurrent.futures

# Imports locales (mismo directorio ejecutado directamente)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from events_manager import EventsManager
from templates_manager import TemplatesManager
from admin_api import start_admin_server

# ── Configuración ─────────────────────────────────────────────────────────────
PHOTOS_DIR     = os.path.join(os.path.dirname(__file__), "..", "photos")
EVENTS_DIR     = os.path.join(os.path.dirname(__file__), "..", "events")
SETTINGS_FILE  = os.path.join(os.path.dirname(__file__), "..", "settings.json")
MODEL_PATH     = os.path.join(os.path.dirname(__file__), "..", "scripts", "hand_landmarker.task")
MODEL_URL      = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)
WS_HOST        = "localhost"
WS_PORT        = 8765

BURST_COUNT    = 3
PHOTO_INTERVAL = 5.0
COUNTDOWN_SECS = 3
PREVIEW_SECS   = 8
PALM_HOLD_SECS = 0.6
FLASH_SECS     = 0.25
STREAM_W       = 960
JPEG_Q         = 75
STRIP_W        = 800
STRIP_BORDER   = 20

os.makedirs(EVENTS_DIR,    exist_ok=True)


# ── Persistencia de configuración hardware ───────────────────────────────────
_PRINT_CONFIG_DEFAULTS = {
    "paper_preset":     "4x6",
    "paper_w_in":       4.0,
    "paper_h_in":       6.0,
    "orientation":      "portrait",
    "margin_top_mm":    5,
    "margin_bottom_mm": 5,
    "margin_left_mm":   5,
    "margin_right_mm":  5,
    "copies":           1,
}

_SETTINGS_DEFAULTS = {
    "camera_index":  0,
    "printer_name":  None,
    "flip_horizontal": False,
    "flip_vertical": False,
    # Enfoque: AF ON por defecto (focus=0 rompe muchas webcams)
    "autofocus": True,
    "focus": 0,          # 0 = no forzar; >0 solo si AF off y el usuario lo elige
    "print_config":  _PRINT_CONFIG_DEFAULTS,
}

def load_settings() -> dict:
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        result = {**_SETTINGS_DEFAULTS, **data}
        # Sub-merge print_config para no perder claves nuevas
        result["print_config"] = {
            **_PRINT_CONFIG_DEFAULTS,
            **(data.get("print_config") or {}),
        }
        return result
    except Exception:
        import copy
        return copy.deepcopy(_SETTINGS_DEFAULTS)

def save_settings(settings: dict):
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[SETTINGS] No se pudo guardar settings.json: {e}")


def configure_capture(cap, settings: dict) -> None:
    """Resolución, FPS y enfoque sobre un VideoCapture ya abierto (DirectShow)."""
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS,          30)

    # Warm-up: algunos drivers DirectShow no aplican props hasta el primer grab
    cap.read()

    autofocus = bool(settings.get("autofocus", True))
    if autofocus:
        ok_af = cap.set(cv2.CAP_PROP_AUTOFOCUS, 1.0)
        print(f"[CAM] Autofocus ON  (driver aceptó={ok_af})")
        return

    # Manual: apagar AF. NO forzar focus=0 (en muchas cams deja imagen negra o cuelga el driver).
    ok_af = cap.set(cv2.CAP_PROP_AUTOFOCUS, 0.0)
    focus = int(settings.get("focus", -1) if settings.get("focus") is not None else -1)
    # Solo aplicar foco manual si el usuario eligió un valor > 0
    if focus > 0:
        focus = max(1, min(255, focus))
        ok_f = cap.set(cv2.CAP_PROP_FOCUS, float(focus))
        cap.set(cv2.CAP_PROP_AUTOFOCUS, 0.0)
        print(f"[CAM] Autofocus OFF (aceptó={ok_af}), focus={focus} (aceptó={ok_f})")
    else:
        # Mantener el foco actual del driver; solo bloquear AF
        cur = cap.get(cv2.CAP_PROP_FOCUS)
        print(f"[CAM] Autofocus OFF (aceptó={ok_af}), focus driver={cur:.0f} (sin forzar 0)")



# ── Modelos ───────────────────────────────────────────────────────────────────
def _download_model(path, url, label):
    if os.path.exists(path):
        return
    print(f"Descargando modelo {label}...")
    try:
        def _prog(b, bs, t):
            pct = min(b * bs * 100 // t, 100) if t > 0 else 0
            print(f"\r  {pct}%", end="", flush=True)
        urllib.request.urlretrieve(url, path, reporthook=_prog)
        print(f"\nModelo {label} listo.")
    except Exception as e:
        print(f"\nError al descargar {label}: {e}")
        sys.exit(1)

def ensure_model():
    _download_model(MODEL_PATH, MODEL_URL, "manos (~8 MB)")


# ── Gestos ────────────────────────────────────────────────────────────────────
def is_open_palm(lm):
    tips, pips = [8, 12, 16, 20], [6, 10, 14, 18]
    return sum(1 for t, p in zip(tips, pips) if lm[t].y < lm[p].y) >= 4


def is_fist(lm):
    """Puño cerrado: todos los dedos recogidos."""
    tips = [8, 12, 16, 20]
    pips = [6, 10, 14, 18]
    return all(lm[t].y > lm[p].y for t, p in zip(tips, pips))


def is_peace(lm):
    """✌️ Amor y paz: índice y medio extendidos, anular y meñique recogidos."""
    return (lm[8].y  < lm[6].y  and   # índice extendido
            lm[12].y < lm[10].y and   # medio extendido
            lm[16].y > lm[14].y and   # anular recogido
            lm[20].y > lm[18].y)      # meñique recogido


# ── Tira ──────────────────────────────────────────────────────────────────────
def make_strip(photos):
    strips = []
    for p in photos:
        ph, pw = p.shape[:2]
        resized = cv2.resize(p, (STRIP_W, int(ph * STRIP_W / pw)))
        strips.append(resized)
    ph = strips[0].shape[0]
    total_h = STRIP_BORDER + (ph + STRIP_BORDER) * len(strips)
    canvas = np.full((total_h, STRIP_W + STRIP_BORDER * 2, 3), 255, dtype=np.uint8)
    for i, img in enumerate(strips):
        y = STRIP_BORDER + i * (ph + STRIP_BORDER)
        canvas[y:y + ph, STRIP_BORDER:STRIP_BORDER + STRIP_W] = img
    return canvas


def make_strip_with_template(photos: list, template: dict, bg_path) -> np.ndarray:
    """Compone fotos en los huecos y luego superpone la plantilla (marco) encima."""
    from PIL import Image as PILImage

    tw = template["width"]
    th = template["height"]
    # Capa base: fotos abajo
    canvas = PILImage.new("RGBA", (tw, th), (255, 255, 255, 255))

    for slot in template.get("slots", []):
        pi = int(slot.get("photoIndex", 1)) - 1   # 0-based
        if pi < 0 or pi >= len(photos):
            continue
        photo_bgr = photos[pi]
        photo_pil = PILImage.fromarray(cv2.cvtColor(photo_bgr, cv2.COLOR_BGR2RGB)).convert("RGBA")

        sw = max(1, int(slot["w"]))
        sh = max(1, int(slot["h"]))
        iw, ih = photo_pil.size

        # Recortar al aspecto del hueco (center-crop)
        ratio_slot  = sw / sh
        ratio_photo = iw / ih
        if ratio_photo > ratio_slot:
            new_w = int(ih * ratio_slot)
            x_off = (iw - new_w) // 2
            photo_pil = photo_pil.crop((x_off, 0, x_off + new_w, ih))
        elif ratio_photo < ratio_slot:
            new_h = int(iw / ratio_slot)
            y_off = (ih - new_h) // 2
            photo_pil = photo_pil.crop((0, y_off, iw, y_off + new_h))

        photo_pil = photo_pil.resize((sw, sh), PILImage.LANCZOS)
        canvas.paste(photo_pil, (int(slot["x"]), int(slot["y"])))

    # Capa superior: plantilla/marco (transparencias dejan ver las fotos)
    if bg_path is not None:
        try:
            overlay = PILImage.open(str(bg_path)).convert("RGBA")
            if overlay.size != (tw, th):
                overlay = overlay.resize((tw, th), PILImage.LANCZOS)
            canvas = PILImage.alpha_composite(canvas, overlay)
        except Exception:
            pass

    return cv2.cvtColor(np.array(canvas.convert("RGB")), cv2.COLOR_RGB2BGR)


def to_b64(frame, quality=JPEG_Q):
    h, w = frame.shape[:2]
    if w > STREAM_W:
        frame = cv2.resize(frame, (STREAM_W, int(h * STREAM_W / w)))
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode()


_RE_FOTO = re.compile(r"^foto(\d+)_\d+\.jpg$", re.IGNORECASE)
_RE_TIRA = re.compile(r"^tira(\d+)\.jpg$", re.IGNORECASE)


def next_session_number(base_dir: str) -> int:
    """Siguiente índice de sesión en una carpeta plana (fotoN_K / tiraN)."""
    n = 0
    try:
        names = os.listdir(base_dir)
    except FileNotFoundError:
        return 1
    for name in names:
        m = _RE_FOTO.match(name) or _RE_TIRA.match(name)
        if m:
            n = max(n, int(m.group(1)))
    return n + 1


async def upload_to_eca360(ingest_url: str, file_path: str, broadcast=None):
    """
    POST multipart field 'file' a la URL de ingest ECA360.
    Nunca lanza: fallos solo se loguean / se notifican por WS.
    """
    url = (ingest_url or "").strip()
    if not url or not file_path or not os.path.isfile(file_path):
        return
    fname = os.path.basename(file_path)
    try:
        if broadcast:
            await broadcast({"type": "ingest_status", "phase": "uploading", "file": fname})
        from aiohttp import FormData, ClientSession, ClientTimeout
        raw = open(file_path, "rb").read()
        data = FormData()
        data.add_field("file", raw, filename=fname, content_type="image/jpeg")
        timeout = ClientTimeout(total=45, connect=10)
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, data=data) as resp:
                body = await resp.text()
                if resp.status >= 400:
                    print(f"[ECA360] HTTP {resp.status} al subir {fname}: {body[:200]}")
                    if broadcast:
                        await broadcast({
                            "type": "ingest_status", "phase": "err",
                            "file": fname, "msg": f"HTTP {resp.status}",
                        })
                    return
                print(f"[ECA360] OK {fname} → {body[:120]}")
                if broadcast:
                    await broadcast({
                        "type": "ingest_status", "phase": "ok", "file": fname,
                    })
    except Exception as exc:
        print(f"[ECA360] Falló upload de {fname}: {exc}")
        try:
            if broadcast:
                await broadcast({
                    "type": "ingest_status", "phase": "err",
                    "file": fname, "msg": str(exc),
                })
        except Exception:
            pass


# ── Backend ───────────────────────────────────────────────────────────────────
class PhotoboothBackend:
    def __init__(self):
        self.clients   = set()
        self.cap            = None
        self.detector       = None
        self.running        = True
        self._executor      = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        self._processing    = False

        # Estado
        self.state           = "idle"
        self.debug_mode      = False

        # Sesión
        self.session_dir     = None   # carpeta plana (events/.../sessions o photos/)
        self.session_num     = 0      # N en fotoN_K.jpg / tiraN.jpg
        self.photo_count     = 0
        self.photos_taken    = []
        self.next_shot_at    = 0.0
        self.session_start   = 0.0
        self.preview_start   = 0.0
        self.flash_until     = 0.0

        # Configuración hardware (persistida en settings.json)
        self.settings = load_settings()

        # Eventos — siempre arrancamos sin evento activo (el operador debe elegir)
        self.events_mgr      = EventsManager()
        self.events_mgr.deactivate()   # fuerza sin evento al iniciar
        self.templates_mgr   = TemplatesManager()

        # Gestos
        self.peace_held_since = None
        self.palm_cooldown    = 0.0

        # Config de la sesión actual
        self.session_burst     = BURST_COUNT
        self.session_countdown = COUNTDOWN_SECS

        # Anti-spam de countdown
        self._last_cdown_val = -1

    # ── WebSocket ─────────────────────────────────────────────────────────────
    async def broadcast(self, msg):
        if not self.clients:
            return
        data = json.dumps(msg)
        dead = set()
        for ws in self.clients:
            try:
                await ws.send(data)
            except Exception:
                dead.add(ws)
        self.clients -= dead

    async def ws_handler(self, websocket):
        self.clients.add(websocket)
        print(f"[WS] Cliente conectado  ({len(self.clients)} total)")
        await websocket.send(json.dumps({
            "type":        "init",
            "state":       self.state,
            "debug":       self.debug_mode,
            "activeEvent": self.events_mgr.get_active(),
            "activeId":    self.events_mgr.active_id,
        }))
        try:
            async for raw in websocket:
                try:
                    await self.handle_cmd(json.loads(raw))
                except Exception:
                    pass
        except Exception:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"[WS] Cliente desconectado  ({len(self.clients)} total)")

    async def handle_cmd(self, msg):
        t = msg.get("type")
        if t == "toggle_debug":
            self.debug_mode = not self.debug_mode
        elif t == "dismiss_mirror":
            if self.state == "mirror":
                self.state = "idle"
                self.palm_cooldown = time.time() + 1.0
                await self.broadcast({"type": "state", "state": "idle"})
        elif t == "start_session":
            # Fallback: iniciar sesión por teclado (barra espaciadora)
            if self.state in ("idle", "mirror"):
                await self._start_session()
        elif t == "quit":
            self.running = False

    # ── Procesamiento de frame ────────────────────────────────────────────────
    async def process_frame(self, frame):
        now  = time.time()
        loop = asyncio.get_running_loop()

        rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        detection = await loop.run_in_executor(self._executor, self.detector.detect, mp_img)

        palm_open     = False
        fist          = False
        peace         = False
        hand_detected = bool(detection.hand_landmarks)

        if hand_detected:
            lm        = detection.hand_landmarks[0]
            palm_open = is_open_palm(lm)
            fist      = is_fist(lm)
            peace     = is_peace(lm)

        # Palm progress
        palm_progress = 0.0

        # Estado idle
        if self.state == "idle":
            active_ev = self.events_mgr.get_active()
            if palm_open and now > self.palm_cooldown and active_ev:
                # Palma abierta → quitar overlay, mostrar espejo (solo si hay evento activo)
                self.state = "mirror"
                self.palm_cooldown    = now + 1.0
                self.peace_held_since = None
                await self.broadcast({"type": "state", "state": "mirror"})
            elif peace and now > self.palm_cooldown:
                if self.peace_held_since is None:
                    self.peace_held_since = now
                held          = now - self.peace_held_since
                palm_progress = min(held / PALM_HOLD_SECS, 1.0)
                if held >= PALM_HOLD_SECS:
                    await self._start_session()
            else:
                self.peace_held_since = None

        # Estado mirror: ✌️ con hold inicia sesión
        elif self.state == "mirror":
            if peace and now > self.palm_cooldown:
                if self.peace_held_since is None:
                    self.peace_held_since = now
                held          = now - self.peace_held_since
                palm_progress = min(held / PALM_HOLD_SECS, 1.0)
                if held >= PALM_HOLD_SECS:
                    await self._start_session()
            else:
                self.peace_held_since = None

        elif self.state == "countdown":
            elapsed   = now - self.session_start
            remaining = self.session_countdown - elapsed
            if remaining <= 0:
                self.state       = "taking"
                self.next_shot_at = now
                self._last_cdown_val = -1
                await self.broadcast({"type": "state", "state": "taking",
                                      "photoCount": 0, "totalPhotos": self.session_burst})
            else:
                val = int(remaining) + 1
                if val != self._last_cdown_val:
                    self._last_cdown_val = val
                    await self.broadcast({"type": "countdown", "value": val, "photoNum": 1})

        elif self.state == "taking":
            if now >= self.next_shot_at:
                await self._take_photo(frame)
            else:
                # Usar session_countdown (configurado del evento) para el intervalo entre fotos
                val = int(self.next_shot_at - now) + 1
                if val != self._last_cdown_val:
                    self._last_cdown_val = val
                    await self.broadcast({"type":     "countdown",
                                          "value":    val,
                                          "photoNum": self.photo_count + 1})

        elif self.state == "preview":
            if now - self.preview_start >= PREVIEW_SECS:
                self.state = "idle"
                await self.broadcast({"type": "state", "state": "idle"})

        # Render — overlay + encode en executor para no bloquear el loop
        active = self.events_mgr.get_active()
        _evmgr = self.events_mgr

        def _render():
            # Solo aplicar overlay legado si no usa plantilla interactiva
            if active and not active.get("templateId"):
                d = _evmgr.apply_to_photo(frame, active["id"])
            else:
                d = frame
            return to_b64(d)

        frame_b64 = await loop.run_in_executor(self._executor, _render)

        is_flash = now < self.flash_until
        await self.broadcast({
            "type":         "frame",
            "data":         frame_b64,
            "flash":        is_flash,
            "palmProgress": palm_progress,
            "gesture": {
                "handDetected": hand_detected,
                "palm":         palm_open,
                "fist":         fist,
                "peace":        peace,
            },
            "debugMode": self.debug_mode,
        })

    async def _start_session(self):
        self.state         = "countdown"
        self.session_start = time.time()
        self.photo_count   = 0
        self.photos_taken  = []
        active = self.events_mgr.get_active()
        # Si el evento usa una plantilla interactiva, el número de fotos viene
        # del max(photoIndex) de los slots; si no, usa el campo del evento.
        template_id = active.get("templateId") if active else None
        if active and template_id:
            tmpl = self.templates_mgr.get_template(template_id)
            if tmpl and tmpl.get("slots"):
                self.session_burst = max(s["photoIndex"] for s in tmpl["slots"])
            else:
                self.session_burst = active.get("photoCount", BURST_COUNT)
        elif active:
            self.session_burst = active.get("photoCount", BURST_COUNT)
        else:
            self.session_burst = BURST_COUNT
        self.session_countdown = active.get("timerSecs", COUNTDOWN_SECS) if active else COUNTDOWN_SECS
        if active:
            base_dir = str(self.events_mgr.get_sessions_dir(active["id"]))
        else:
            base_dir = PHOTOS_DIR
        os.makedirs(base_dir, exist_ok=True)
        self.session_dir = base_dir
        self.session_num = next_session_number(base_dir)
        self.peace_held_since = None
        self._last_cdown_val  = -1
        await self.broadcast({"type": "state", "state": "countdown",
                               "totalPhotos": self.session_burst})
        print(f"\n📸  Sesión {self.session_num} ({self.session_burst} fotos, {self.session_countdown}s) → {self.session_dir}")

    async def _take_photo(self, frame):
        loop        = asyncio.get_running_loop()
        active      = self.events_mgr.get_active()
        session_dir = self.session_dir
        session_num = self.session_num
        photo_num   = self.photo_count + 1
        evmgr       = self.events_mgr
        # Si el evento usa plantilla interactiva, omitir apply_to_photo (legacy overlay)
        has_interactive_tpl = bool(active and active.get("templateId"))

        def _process_and_save():
            photo = frame.copy()
            if active and not has_interactive_tpl:
                photo = evmgr.apply_to_photo(photo, active["id"])
            path = os.path.join(session_dir, f"foto{session_num}_{photo_num}.jpg")
            cv2.imwrite(path, photo)
            th = 240
            tw = int(photo.shape[1] * th / photo.shape[0])
            _, tbuf = cv2.imencode(".jpg", cv2.resize(photo, (tw, th)),
                                   [cv2.IMWRITE_JPEG_QUALITY, 82])
            return photo, base64.b64encode(tbuf).decode(), path

        photo, photo_b64, photo_path = await loop.run_in_executor(self._executor, _process_and_save)
        self.photo_count += 1
        self.photos_taken.append(photo)
        self.flash_until = time.time() + FLASH_SECS
        print(f"  \U0001f4f7  foto{session_num}_{self.photo_count}.jpg")
        await self.broadcast({"type": "flash", "photoNum": self.photo_count, "photo": photo_b64})

        # ECA360: subir foto en background (no bloquea el booth)
        ingest_url = (active or {}).get("ingestUrl") or ""
        if ingest_url:
            asyncio.create_task(upload_to_eca360(ingest_url, photo_path, self.broadcast))

        if self.photo_count >= self.session_burst:
            photos_snap      = list(self.photos_taken)
            _sdir            = self.session_dir
            _snum            = self.session_num
            _active_snap     = self.events_mgr.get_active()
            _templates_mgr   = self.templates_mgr
            _ingest          = (_active_snap or {}).get("ingestUrl") or ""

            def _build_strip():
                tid = _active_snap.get("templateId") if _active_snap else None
                if tid:
                    tmpl = _templates_mgr.get_template(tid)
                    if tmpl and tmpl.get("slots"):
                        bg = _templates_mgr.get_background_path(tid)
                        strip = make_strip_with_template(photos_snap, tmpl, bg)
                    else:
                        strip = make_strip(photos_snap)
                else:
                    strip = make_strip(photos_snap)
                strip_path = os.path.join(_sdir, f"tira{_snum}.jpg")
                cv2.imwrite(strip_path, strip)
                _, buf = cv2.imencode(".jpg", strip, [cv2.IMWRITE_JPEG_QUALITY, 88])
                return base64.b64encode(buf).decode(), strip_path

            strip_b64, strip_path = await loop.run_in_executor(self._executor, _build_strip)
            print(f"  \U0001f39e\ufe0f  tira{_snum}.jpg")
            if _ingest:
                asyncio.create_task(upload_to_eca360(_ingest, strip_path, self.broadcast))
            self.state         = "preview"
            self.preview_start = time.time()
            self.palm_cooldown = time.time() + 2.0
            await self.broadcast({"type": "strip", "data": strip_b64})
            await self.broadcast({"type": "state", "state": "preview"})
        else:
            # Usar session_countdown (configurado del evento) para el intervalo entre fotos
            self.next_shot_at    = time.time() + self.session_countdown
            self._last_cdown_val = -1
            await self.broadcast({"type":        "state",
                                  "state":       "taking",
                                  "photoCount":  self.photo_count,
                                  "totalPhotos": self.session_burst})

    def _open_capture(self, index: int):
        """Abre la cámara; devuelve VideoCapture o None."""
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if not cap.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            cap = cv2.VideoCapture(index, cv2.CAP_MSMF)
        if not cap.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            print(f"[CAM] ERROR: no se pudo abrir cámara índice {index}")
            return None
        configure_capture(cap, self.settings)
        # Verificar que entrega frames
        ok, _ = cap.read()
        if not ok:
            print(f"[CAM] ERROR: cámara {index} abierta pero no entrega frames")
            try:
                cap.release()
            except Exception:
                pass
            return None
        print(f"[CAM] Cámara {index} OK")
        return cap

    # ── Reinicio de cámara ───────────────────────────────────────────────────
    async def _reinit_camera(self, index: int):
        """Cambia la cámara en caliente sin detener el backend."""
        loop = asyncio.get_running_loop()
        def _swap():
            if self.cap is not None:
                try:
                    self.cap.release()
                except Exception:
                    pass
            return self._open_capture(index)
        self.cap = await loop.run_in_executor(self._executor, _swap)
        print(f"[CAM] Cámara cambiada → índice {index} (ok={self.cap is not None})")
        await self.broadcast({"type": "camera_changed", "index": index, "ok": self.cap is not None})

    async def _apply_focus_settings(self):
        """Reaplica autofocus/focus sobre la cámara abierta."""
        if self.cap is None:
            return
        loop = asyncio.get_running_loop()
        settings = self.settings
        def _apply():
            configure_capture(self.cap, settings)
        await loop.run_in_executor(self._executor, _apply)

    async def _open_camera_settings_dialog(self):
        """Abre el panel nativo DirectShow de la cámara (bloqueo hasta cerrar)."""
        if self.cap is None:
            return False
        loop = asyncio.get_running_loop()
        def _open():
            # CAP_PROP_SETTINGS = 37 — abre el diálogo del driver
            return bool(self.cap.set(cv2.CAP_PROP_SETTINGS, 1))
        return await loop.run_in_executor(self._executor, _open)

    # ── Loop principal ────────────────────────────────────────────────────────
    async def _safe_process(self, frame):
        """Wrapper que garantiza que _processing se libera aunque haya excepción."""
        try:
            await self.process_frame(frame)
        except Exception as e:
            print(f"[process_frame] error: {e}")
        finally:
            self._processing = False

    async def capture_loop(self):
        loop           = asyncio.get_running_loop()
        frame_interval = 1.0 / 30
        fail_streak    = 0
        last_reopen_at = 0.0
        while self.running:
            t0 = time.monotonic()

            if self.cap is None:
                now = time.time()
                if now - last_reopen_at > 3.0:
                    last_reopen_at = now
                    idx = self.settings.get("camera_index", 0)
                    print(f"[CAM] Reintentando abrir cámara {idx}…")
                    self.cap = await loop.run_in_executor(
                        self._executor, lambda: self._open_capture(idx)
                    )
                    if self.cap is None and self.clients:
                        await self.broadcast({
                            "type": "camera_error",
                            "msg": "No se pudo abrir la cámara. Cierra otras apps que la usen (Chrome, Zoom, Cámara de Windows) o reinicia el dispositivo.",
                        })
                await asyncio.sleep(0.5)
                continue

            ret, raw = await loop.run_in_executor(self._executor, self.cap.read)
            if not ret:
                fail_streak += 1
                if fail_streak >= 30:
                    print("[CAM] Demasiados fallos de lectura — liberando y reabriendo")
                    try:
                        self.cap.release()
                    except Exception:
                        pass
                    self.cap = None
                    fail_streak = 0
                await asyncio.sleep(0.033)
                continue
            fail_streak = 0
            frame = raw
            # Aplicar flip según configuración
            if self.settings.get("flip_horizontal"):
                frame = cv2.flip(frame, 1)
            if self.settings.get("flip_vertical"):
                frame = cv2.flip(frame, 0)
            if self.clients:
                if not self._processing:
                    # Lanzar como tarea independiente: el loop de captura
                    # no espera — sigue leyendo frames a 30fps.
                    # Si el frame anterior sigue procesándose, se descarta éste.
                    self._processing = True
                    asyncio.create_task(self._safe_process(frame))
            elapsed    = time.monotonic() - t0
            sleep_time = max(0.0, frame_interval - elapsed)
            await asyncio.sleep(sleep_time)

    async def run(self):
        ensure_model()

        cam_idx  = self.settings.get("camera_index", 0)
        self.cap = self._open_capture(cam_idx)
        if self.cap is None:
            print("[CAM] Arranque sin cámara — se reintentará en el loop")

        base_opts   = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
        opts        = mp_vision.HandLandmarkerOptions(
            base_options=base_opts,
            running_mode=mp_vision.RunningMode.IMAGE,
            num_hands=1,
            min_hand_detection_confidence=0.72,
            min_hand_presence_confidence=0.65,
            min_tracking_confidence=0.65,
        )
        self.detector = mp_vision.HandLandmarker.create_from_options(opts)

        print("═" * 48)
        print(f"  PHOTOBOOTH BACKEND")
        print(f"  WebSocket → ws://{WS_HOST}:{WS_PORT}")
        print("═" * 48)

        async with websockets.serve(self.ws_handler, WS_HOST, WS_PORT):
            admin_runner = await start_admin_server(
                self.events_mgr,
                self.templates_mgr,
                self.broadcast,
                self.settings,
                self._reinit_camera,
                lambda: save_settings(self.settings),
                self._apply_focus_settings,
                self._open_camera_settings_dialog,
            )
            try:
                await self.capture_loop()
            finally:
                await admin_runner.cleanup()

        if self.cap is not None:
            self.cap.release()
        self.detector.close()
        self._executor.shutdown(wait=False)
        print("Backend cerrado.")


if __name__ == "__main__":
    backend = PhotoboothBackend()
    try:
        asyncio.run(backend.run())
    except KeyboardInterrupt:
        print("\nBackend detenido.")
