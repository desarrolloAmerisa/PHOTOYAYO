"""
EventsManager — Gestión de eventos del photobooth.

Estructura en disco:
  events.json           ← índice de todos los eventos
  events/
    {nombre-del-evento}/
      template.png      (opcional)
      sessions/         (fotos en plano: foto1_1.jpg, foto1_2.jpg, tira1.jpg, …)

El id del evento = nombre de la carpeta (sanitizado). Ya no se usan UUIDs.
"""

import io
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from PIL import Image

EVENTS_ROOT = Path(__file__).parent.parent / "events"
EVENTS_FILE = Path(__file__).parent.parent / "events.json"

_INVALID_WIN = re.compile(r'[<>:"/\\|?*]')
_HEX_ID = re.compile(r"^[0-9a-f]{8,}$", re.IGNORECASE)


def slugify_event_name(name: str) -> str:
    """Nombre usable como carpeta en Windows."""
    s = (name or "").strip()
    s = _INVALID_WIN.sub("", s)
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s or "evento"


class EventsManager:
    def __init__(self):
        self.events:    dict       = {}
        self.active_id: str | None = None
        EVENTS_ROOT.mkdir(exist_ok=True)
        self._load()
        self._migrate_hex_ids_to_names()

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

    def _unique_id(self, base: str, exclude: str | None = None) -> str:
        """Evita choques de nombre entre eventos / carpetas."""
        candidate = base
        n = 2
        while True:
            id_taken = candidate in self.events and candidate != exclude
            folder_taken = (EVENTS_ROOT / candidate).exists() and candidate != exclude
            if not id_taken and not folder_taken:
                return candidate
            candidate = f"{base} ({n})"
            n += 1
            if n > 500:
                return f"{base} ({uuid_fallback()})"

    def _event_dir(self, eid: str) -> Path:
        return EVENTS_ROOT / eid

    def _rename_event_id(self, old_id: str, new_id: str) -> dict | None:
        e = self.events.get(old_id)
        if not e or old_id == new_id:
            return e
        old_path = self._event_dir(old_id)
        new_path = self._event_dir(new_id)
        if new_path.exists() and new_path.resolve() != old_path.resolve():
            # no pisar otra carpeta
            new_id = self._unique_id(new_id, exclude=old_id)
            new_path = self._event_dir(new_id)
        if old_path.exists():
            old_path.rename(new_path)
        else:
            (new_path / "sessions").mkdir(parents=True, exist_ok=True)
        e["id"] = new_id
        del self.events[old_id]
        self.events[new_id] = e
        if self.active_id == old_id:
            self.active_id = new_id
        return e

    def _migrate_hex_ids_to_names(self):
        """Renombra carpetas UUID → nombre del evento (una sola vez al cargar)."""
        changed = False
        for eid in list(self.events.keys()):
            e = self.events.get(eid)
            if not e:
                continue
            if not _HEX_ID.match(eid):
                continue
            desired = self._unique_id(slugify_event_name(e.get("name", "")), exclude=eid)
            if desired == eid:
                continue
            print(f"[EVENTS] Migrando carpeta '{eid}' → '{desired}'")
            self._rename_event_id(eid, desired)
            changed = True
        if changed:
            self._save()

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def list_events(self) -> list:
        return list(self.events.values())

    def get_event(self, eid: str) -> dict | None:
        return self.events.get(eid)

    def create_event(self, name: str, width: int, height: int,
                      photo_count: int = 3, timer_secs: int = 3,
                      template_id: str | None = None,
                      ingest_url: str | None = None) -> dict:
        clean = slugify_event_name(name)
        eid = self._unique_id(clean)
        url = (ingest_url or "").strip() or None
        event = {
            "id":          eid,
            "name":        name.strip(),
            "width":       int(width),
            "height":      int(height),
            "photoCount":  max(1, min(int(photo_count), 10)),
            "timerSecs":   max(1, min(int(timer_secs),  30)),
            "templateId":  template_id,
            "ingestUrl":   url,
            "hasTemplate": False,
            "createdAt":   datetime.now().isoformat(),
        }
        self.events[eid] = event
        (self._event_dir(eid) / "sessions").mkdir(parents=True, exist_ok=True)
        self._save()
        return event

    def update_event(self, eid: str, **kwargs) -> dict | None:
        e = self.events.get(eid)
        if not e:
            return None
        rename_to = None
        for k, v in kwargs.items():
            if k == "ingestUrl":
                # Permitir limpiar con "" / None
                e["ingestUrl"] = (str(v).strip() if v else "") or None
                continue
            if v is None:
                continue
            if k == "name":
                e["name"] = str(v).strip()
                rename_to = slugify_event_name(e["name"])
            elif k in ("width", "height"):
                e[k] = int(v)
            elif k == "photoCount":
                e["photoCount"] = max(1, min(int(v), 10))
            elif k == "timerSecs":
                e["timerSecs"] = max(1, min(int(v), 30))
            elif k == "templateId":
                e["templateId"] = v if v else None

        if rename_to and rename_to != eid:
            new_id = self._unique_id(rename_to, exclude=eid)
            e = self._rename_event_id(eid, new_id) or e

        self._save()
        return e

    def delete_event(self, eid: str) -> bool:
        if eid not in self.events:
            return False
        shutil.rmtree(self._event_dir(eid), ignore_errors=True)
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
        tpl_path = self._event_dir(eid) / "template.png"
        tpl_path.parent.mkdir(parents=True, exist_ok=True)
        tpl_path.write_bytes(png_bytes)
        e["hasTemplate"] = True
        self._save()
        return e, None

    def remove_template(self, eid: str) -> bool:
        e = self.events.get(eid)
        if not e:
            return False
        (self._event_dir(eid) / "template.png").unlink(missing_ok=True)
        e["hasTemplate"] = False
        self._save()
        return True

    def get_template_path(self, eid: str) -> Path | None:
        p = self._event_dir(eid) / "template.png"
        return p if p.exists() else None

    # ── Directorio de sesiones ────────────────────────────────────────────────

    def get_sessions_dir(self, eid: str) -> Path:
        d = self._event_dir(eid) / "sessions"
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
        if tpl_path and tpl_path.exists():
            tpl = Image.open(tpl_path).convert("RGBA")
            base = Image.fromarray(cv2.cvtColor(photo, cv2.COLOR_BGR2RGB)).convert("RGBA")
            composed = Image.alpha_composite(base, tpl)
            photo = cv2.cvtColor(np.array(composed.convert("RGB")), cv2.COLOR_RGB2BGR)

        return photo


def uuid_fallback() -> str:
    import uuid
    return uuid.uuid4().hex[:6]
