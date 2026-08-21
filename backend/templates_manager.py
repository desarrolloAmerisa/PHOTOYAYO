"""
TemplatesManager — Gestión de plantillas interactivas del photobooth.

Estructura en disco:
  templates.json          ← índice de todas las plantillas
  templates/
    {id}/
        background.png    (opcional — marco/overlay encima de las fotos;
                           zonas transparentes dejan ver las fotos)

Cada plantilla define huecos (slots) donde se pegan las fotos de la sesión.
  slot: { id, photoIndex, x, y, w, h }
  photoIndex — número de foto (1-based) que irá en ese hueco.
  Varios slots pueden tener el mismo photoIndex (misma foto repetida).
"""

import io
import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from PIL import Image

TEMPLATES_ROOT = Path(__file__).parent.parent / "templates"
TEMPLATES_FILE = Path(__file__).parent.parent / "templates.json"


class TemplatesManager:
    def __init__(self):
        self.templates: dict = {}
        TEMPLATES_ROOT.mkdir(exist_ok=True)
        self._load()

    # ── Persistencia ──────────────────────────────────────────────────────────

    def _load(self):
        if TEMPLATES_FILE.exists():
            try:
                data = json.loads(TEMPLATES_FILE.read_text(encoding="utf-8"))
                self.templates = {t["id"]: t for t in data.get("templates", [])}
            except Exception:
                pass

    def _save(self):
        TEMPLATES_FILE.write_text(
            json.dumps(
                {"templates": list(self.templates.values())},
                indent=2, ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def list_templates(self) -> list:
        return list(self.templates.values())

    def get_template(self, tid: str) -> dict | None:
        return self.templates.get(tid)

    def create_template(self, name: str, width: int, height: int) -> dict:
        tid = uuid.uuid4().hex[:8]
        template = {
            "id":         tid,
            "name":       name.strip(),
            "width":      max(50, min(int(width),  8000)),
            "height":     max(50, min(int(height), 8000)),
            "slots":      [],
            "background": False,
            "createdAt":  datetime.now().isoformat(),
        }
        self.templates[tid] = template
        (TEMPLATES_ROOT / tid).mkdir(parents=True, exist_ok=True)
        self._save()
        return template

    def update_template(self, tid: str, name=None, slots=None) -> dict | None:
        t = self.templates.get(tid)
        if not t:
            return None
        if name is not None:
            t["name"] = str(name).strip()
        if slots is not None:
            cleaned = []
            for s in slots:
                if not isinstance(s, dict):
                    continue
                cleaned.append({
                    "id":         str(s.get("id", uuid.uuid4().hex[:6])),
                    "photoIndex": max(1, min(20, int(s.get("photoIndex", 1)))),
                    "x":          max(0, int(s.get("x", 0))),
                    "y":          max(0, int(s.get("y", 0))),
                    "w":          max(1, int(s.get("w", 100))),
                    "h":          max(1, int(s.get("h", 100))),
                })
            t["slots"] = cleaned
        self._save()
        return t

    def delete_template(self, tid: str) -> bool:
        if tid not in self.templates:
            return False
        shutil.rmtree(TEMPLATES_ROOT / tid, ignore_errors=True)
        del self.templates[tid]
        self._save()
        return True

    # ── Fondo ─────────────────────────────────────────────────────────────────

    def set_background(self, tid: str, img_bytes: bytes) -> tuple:
        """Acepta cualquier tamaño/formato y redimensiona al tamaño de la plantilla."""
        t = self.templates.get(tid)
        if not t:
            return None, "Plantilla no encontrada"
        try:
            img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        except Exception:
            return None, "No se pudo leer la imagen"
        tw, th = t["width"], t["height"]
        if img.size != (tw, th):
            img = img.resize((tw, th), Image.LANCZOS)
        bg_path = TEMPLATES_ROOT / tid / "background.png"
        img.save(str(bg_path), "PNG")
        t["background"] = True
        self._save()
        return t, None

    def remove_background(self, tid: str) -> bool:
        t = self.templates.get(tid)
        if not t:
            return False
        (TEMPLATES_ROOT / tid / "background.png").unlink(missing_ok=True)
        t["background"] = False
        self._save()
        return True

    def get_background_path(self, tid: str) -> Path | None:
        p = TEMPLATES_ROOT / tid / "background.png"
        return p if p.exists() else None

    # ── Composición ───────────────────────────────────────────────────────────

    def make_photo_count(self, tid: str) -> int:
        """Número de fotos distintas que necesita la plantilla (max photoIndex)."""
        t = self.templates.get(tid)
        if not t or not t.get("slots"):
            return 0
        return max(s["photoIndex"] for s in t["slots"])
