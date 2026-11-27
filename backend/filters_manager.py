"""
FiltersManager — Filtros LUT .cube para el photobooth.

Estructura:
  filters.json
  filters/
    {id}/
      lut.cube

Se aplican solo al disparar la foto (no en el preview en vivo).
"""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

FILTERS_ROOT = Path(__file__).parent.parent / "filters"
FILTERS_FILE = Path(__file__).parent.parent / "filters.json"

MAX_CUBE_BYTES = 8 * 1024 * 1024  # 8 MB


def parse_cube(text: str) -> np.ndarray:
    """Parsea un .cube IRIDAS/Adobe → array float32 (N,N,N,3) indexado [b,g,r] → RGB."""
    size = None
    values: list[list[float]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        upper = line.upper()
        if upper.startswith("TITLE") or upper.startswith("DOMAIN_"):
            continue
        if upper.startswith("LUT_1D_SIZE"):
            raise ValueError("Solo se soportan LUT 3D (.cube 3D)")
        if upper.startswith("LUT_3D_SIZE"):
            parts = line.split()
            size = int(parts[-1])
            continue
        parts = line.split()
        if len(parts) >= 3:
            try:
                values.append([float(parts[0]), float(parts[1]), float(parts[2])])
            except ValueError:
                continue

    if not size or size < 2 or size > 128:
        raise ValueError("LUT_3D_SIZE inválido (2–128)")
    expected = size ** 3
    if len(values) < expected:
        raise ValueError(f"El .cube tiene {len(values)} entradas; se esperaban {expected}")
    arr = np.asarray(values[:expected], dtype=np.float32)
    # Orden .cube: R más rápido → G → B  ⇒ reshape (B, G, R, 3)
    return arr.reshape((size, size, size, 3))


def apply_lut_bgr(img_bgr: np.ndarray, lut: np.ndarray) -> np.ndarray:
    """Aplica LUT 3D a imagen BGR uint8. Devuelve BGR uint8."""
    if img_bgr is None or lut is None:
        return img_bgr
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    h, w = rgb.shape[:2]
    flat = rgb.reshape(-1, 3)
    n = lut.shape[0]
    # Coordenadas en [0, n-1]
    r = np.clip(flat[:, 0] * (n - 1), 0, n - 1)
    g = np.clip(flat[:, 1] * (n - 1), 0, n - 1)
    b = np.clip(flat[:, 2] * (n - 1), 0, n - 1)

    r0 = np.floor(r).astype(np.int32)
    g0 = np.floor(g).astype(np.int32)
    b0 = np.floor(b).astype(np.int32)
    r1 = np.minimum(r0 + 1, n - 1)
    g1 = np.minimum(g0 + 1, n - 1)
    b1 = np.minimum(b0 + 1, n - 1)
    rd = (r - r0).astype(np.float32)[:, None]
    gd = (g - g0).astype(np.float32)[:, None]
    bd = (b - b0).astype(np.float32)[:, None]

    # lut[b,g,r]
    c000 = lut[b0, g0, r0]
    c001 = lut[b0, g0, r1]
    c010 = lut[b0, g1, r0]
    c011 = lut[b0, g1, r1]
    c100 = lut[b1, g0, r0]
    c101 = lut[b1, g0, r1]
    c110 = lut[b1, g1, r0]
    c111 = lut[b1, g1, r1]

    c00 = c000 * (1 - rd) + c001 * rd
    c01 = c010 * (1 - rd) + c011 * rd
    c10 = c100 * (1 - rd) + c101 * rd
    c11 = c110 * (1 - rd) + c111 * rd
    c0 = c00 * (1 - gd) + c01 * gd
    c1 = c10 * (1 - gd) + c11 * gd
    out = c0 * (1 - bd) + c1 * bd

    out = np.clip(out.reshape(h, w, 3) * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)


class FiltersManager:
    def __init__(self):
        self.filters: dict = {}
        self._lut_cache: dict[str, np.ndarray] = {}
        FILTERS_ROOT.mkdir(exist_ok=True)
        self._load()

    def _load(self):
        if FILTERS_FILE.exists():
            try:
                data = json.loads(FILTERS_FILE.read_text(encoding="utf-8"))
                self.filters = {f["id"]: f for f in data.get("filters", [])}
            except Exception:
                self.filters = {}

    def _save(self):
        FILTERS_FILE.write_text(
            json.dumps({"filters": list(self.filters.values())}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def _dir(self, fid: str) -> Path:
        return FILTERS_ROOT / fid

    def cube_path(self, fid: str) -> Path | None:
        p = self._dir(fid) / "lut.cube"
        return p if p.is_file() else None

    def list_filters(self) -> list:
        return list(self.filters.values())

    def get_filter(self, fid: str) -> dict | None:
        return self.filters.get(fid)

    def create_filter(self, name: str, cube_bytes: bytes) -> tuple[dict | None, str | None]:
        name = (name or "").strip()
        if not name:
            return None, "El nombre es obligatorio"
        if not cube_bytes:
            return None, "Archivo .cube vacío"
        if len(cube_bytes) > MAX_CUBE_BYTES:
            return None, "El .cube supera 8 MB"
        try:
            text = cube_bytes.decode("utf-8", errors="replace")
            lut = parse_cube(text)
        except Exception as exc:
            return None, f"CUBO inválido: {exc}"

        fid = uuid.uuid4().hex[:8]
        d = self._dir(fid)
        d.mkdir(parents=True, exist_ok=True)
        (d / "lut.cube").write_bytes(cube_bytes)
        meta = {
            "id": fid,
            "name": name,
            "size": int(lut.shape[0]),
            "hasCube": True,
            "createdAt": datetime.now().isoformat(),
        }
        self.filters[fid] = meta
        self._lut_cache[fid] = lut
        self._save()
        return meta, None

    def update_filter(self, fid: str, name: str | None = None,
                      cube_bytes: bytes | None = None) -> tuple[dict | None, str | None]:
        f = self.filters.get(fid)
        if not f:
            return None, "Filtro no encontrado"
        if name is not None:
            name = str(name).strip()
            if not name:
                return None, "El nombre no puede quedar vacío"
            f["name"] = name
        if cube_bytes is not None:
            if len(cube_bytes) > MAX_CUBE_BYTES:
                return None, "El .cube supera 8 MB"
            try:
                text = cube_bytes.decode("utf-8", errors="replace")
                lut = parse_cube(text)
            except Exception as exc:
                return None, f"CUBO inválido: {exc}"
            self._dir(fid).mkdir(parents=True, exist_ok=True)
            (self._dir(fid) / "lut.cube").write_bytes(cube_bytes)
            f["size"] = int(lut.shape[0])
            f["hasCube"] = True
            self._lut_cache[fid] = lut
        self._save()
        return f, None

    def delete_filter(self, fid: str) -> bool:
        if fid not in self.filters:
            return False
        shutil.rmtree(self._dir(fid), ignore_errors=True)
        del self.filters[fid]
        self._lut_cache.pop(fid, None)
        self._save()
        return True

    def get_lut(self, fid: str) -> np.ndarray | None:
        if not fid:
            return None
        if fid in self._lut_cache:
            return self._lut_cache[fid]
        path = self.cube_path(fid)
        if not path:
            return None
        try:
            lut = parse_cube(path.read_text(encoding="utf-8", errors="replace"))
            self._lut_cache[fid] = lut
            return lut
        except Exception as exc:
            print(f"[FILTER] No se pudo cargar {fid}: {exc}")
            return None

    def apply_to_bgr(self, img_bgr: np.ndarray, fid: str | None) -> np.ndarray:
        if not fid or img_bgr is None:
            return img_bgr
        lut = self.get_lut(fid)
        if lut is None:
            return img_bgr
        return apply_lut_bgr(img_bgr, lut)
