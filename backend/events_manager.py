"""
EventsManager — Gestión de eventos del photobooth.

Estructura en disco:
  events.json           ← índice de todos los eventos
  events/
    {id}/
      template.png      (opcional)
      sessions/         (fotos en plano: foto1_1.jpg, foto1_2.jpg, tira1.jpg, …)
"""

import io
import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from PIL import Image

EVENTS_ROOT = Path(__file__).parent.parent / "events"
EVENTS_FILE = Path(__file__).parent.parent / "events.json"


class EventsManager:
    def __init__(self):
        self.events:    dict       = {}
        self.active_id: str | None = None
        EVENTS_ROOT.mkdir(exist_ok=True)
        self._load()

    # ── Persistencia ──────────────────────────────────────────────────────────

    def _load(self):
        if EVENTS_FILE.exists():
            try:
                data           = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
                self.events    = {e["id"]: e for e in data.get("events", [])}
                self.active_id = data.get("activeId")
            except Exception:
                pass

    def _save(self):
        EVENTS_FILE.write_text(
            json.dumps(
                {"events": list(self.events.values()), "activeId": self.active_id},
                indent=2, ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def list_events(self) -> list:
        return list(self.events.values())

    def get_event(self, eid: str) -> dict | None:
        return self.events.get(eid)

    def create_event(self, name: str, width: int, height: int,
                      photo_count: int = 3, timer_secs: int = 3,
                      template_id: str | None = None) -> dict:
        eid = uuid.uuid4().hex[:8]
        event = {
            "id":          eid,
            "name":        name.strip(),
            "width":       int(width),
            "height":      int(height),
            "photoCount":  max(1, min(int(photo_count), 10)),
            "timerSecs":   max(1, min(int(timer_secs),  30)),
            "templateId":  template_id,
            "hasTemplate": False,
            "createdAt":   datetime.now().isoformat(),
        }
        self.events[eid] = event
        (EVENTS_ROOT / eid / "sessions").mkdir(parents=True, exist_ok=True)
        self._save()
        return event

    def update_event(self, eid: str, **kwargs) -> dict | None:
        e = self.events.get(eid)
        if not e:
            return None
        for k, v in kwargs.items():
            if v is None:
                continue
            if k == "name":
                e["name"] = str(v).strip()
            elif k in ("width", "height"):
                e[k] = int(v)
            elif k == "photoCount":
                e["photoCount"] = max(1, min(int(v), 10))
            elif k == "timerSecs":
                e["timerSecs"] = max(1, min(int(v), 30))
            elif k == "templateId":
                e["templateId"] = v if v else None
        self._save()
        return e

    def delete_event(self, eid: str) -> bool:
        if eid not in self.events:
            return False
        shutil.rmtree(EVENTS_ROOT / eid, ignore_errors=True)
        del self.events[eid]
        if self.active_id == eid:
            self.active_id = None
        self._save()
        return True

    # ── Evento activo ─────────────────────────────────────────────────────────

    def activate(self, eid: str) -> bool:
        if eid not in self.events:
            return False
        self.active_id = eid
        self._save()
        return True

    def deactivate(self) -> None:
        self.active_id = None
        self._save()

    def get_active(self) -> dict | None:
        if self.active_id and self.active_id in self.events:
            return self.events[self.active_id]
        return None

    # ── Plantilla ─────────────────────────────────────────────────────────────

    def set_template(self, eid: str, png_bytes: bytes) -> tuple:
        """Valida y guarda la plantilla. Devuelve (event, None) o (None, error_msg)."""
        e = self.events.get(eid)
        if not e:
            return None, "Evento no encontrado"
        try:
            img = Image.open(io.BytesIO(png_bytes))
        except Exception:
            return None, "No se pudo leer la imagen"
        if img.format != "PNG":
            return None, "El archivo debe ser PNG"
        w, h = img.size
        if w != e["width"] or h != e["height"]:
            return None, (
                f"La plantilla debe ser {e['width']}×{e['height']} px, "
                f"se recibió {w}×{h} px"
            )
        tpl_path = EVENTS_ROOT / eid / "template.png"
        tpl_path.write_bytes(png_bytes)
        e["hasTemplate"] = True
        self._save()
        return e, None

    def remove_template(self, eid: str) -> bool:
        e = self.events.get(eid)
        if not e:
            return False
        (EVENTS_ROOT / eid / "template.png").unlink(missing_ok=True)
        e["hasTemplate"] = False
        self._save()
        return True

    def get_template_path(self, eid: str) -> Path | None:
        p = EVENTS_ROOT / eid / "template.png"
        return p if p.exists() else None

    # ── Directorio de sesiones ────────────────────────────────────────────────

    def get_sessions_dir(self, eid: str) -> Path:
        d = EVENTS_ROOT / eid / "sessions"
        d.mkdir(parents=True, exist_ok=True)
        return d

    # ── Aplicar plantilla a una foto ──────────────────────────────────────────

    def apply_to_photo(self, frame_bgr, eid: str):
        """
        Redimensiona el frame a las dimensiones del evento y superpone
        la plantilla PNG (con alpha) si existe.
        Devuelve un array BGR de NumPy.
        """
        import cv2
        import numpy as np

        e = self.events.get(eid)
        if not e:
            return frame_bgr

        w, h  = e["width"], e["height"]

        # Center-crop el frame al aspect ratio del evento antes de escalar
        # Asi lo que se ve en pantalla == lo que se guarda
        fh, fw = frame_bgr.shape[:2]
        target_ratio = w / h
        frame_ratio  = fw / fh

        if frame_ratio > target_ratio:
            # Frame mas ancho → recortar laterales
            new_w   = int(fh * target_ratio)
            x_start = (fw - new_w) // 2
            frame_bgr = frame_bgr[:, x_start : x_start + new_w]
        elif frame_ratio < target_ratio:
            # Frame mas alto → recortar arriba/abajo
            new_h   = int(fw / target_ratio)
            y_start = (fh - new_h) // 2
            frame_bgr = frame_bgr[y_start : y_start + new_h, :]

        photo = cv2.resize(frame_bgr, (w, h))

        tpl_path = self.get_template_path(eid)
        if tpl_path is None:
            return photo

        tpl       = Image.open(tpl_path).convert("RGBA")
        photo_pil = Image.fromarray(cv2.cvtColor(photo, cv2.COLOR_BGR2RGB)).convert("RGBA")
        photo_pil.paste(tpl, (0, 0), mask=tpl)
        return cv2.cvtColor(np.array(photo_pil.convert("RGB")), cv2.COLOR_RGB2BGR)
