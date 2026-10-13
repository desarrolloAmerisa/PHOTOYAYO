"""
Cabin360Manager — eventos locales + cola de procesamiento de videos 360.

Pipeline por video:
  queued → saving → compressing → framing → thumbnail → uploading → uploading_thumb → done | error
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
EVENTS_ROOT = ROOT / "events360"
EVENTS_FILE = ROOT / "events360.json"

_INVALID = re.compile(r'[<>:"/\\|?*]')
PHASES = (
    "queued", "saving", "compressing", "framing",
    "thumbnail", "uploading", "uploading_thumb", "done", "error",
)


def slugify(name: str) -> str:
    s = (name or "").strip()
    s = _INVALID.sub("", s)
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s or "evento-360"


# ffmpeg va empaquetado en el repo (no se instala con winget)
FFMPEG_BUNDLE = ROOT / "ffmpeg-7.1.1-full_build" / "bin"


def find_binary(name: str, env_key: str) -> str | None:
    env = (os.environ.get(env_key) or "").strip()
    if env and Path(env).is_file():
        return env
    # Prioridad: carpeta del proyecto
    bundled = FFMPEG_BUNDLE / f"{name}.exe"
    if bundled.is_file():
        return str(bundled)
    which = shutil.which(name)
    if which:
        return which
    candidates = [
        ROOT / "scripts" / "ffmpeg" / "bin" / f"{name}.exe",
        ROOT / "scripts" / "ffmpeg" / f"{name}.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "ffmpeg" / "bin" / f"{name}.exe",
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    return None


class Cabin360Manager:
    def __init__(self):
        self.events: dict = {}
        self.active_id: str | None = None
        self.jobs: dict[str, dict] = {}
        self._queue: asyncio.Queue | None = None
        self._worker_task: asyncio.Task | None = None
        self._logs: list[dict] = []
        self.ffmpeg = find_binary("ffmpeg", "FFMPEG_PATH")
        self.ffprobe = find_binary("ffprobe", "FFPROBE_PATH")
        EVENTS_ROOT.mkdir(exist_ok=True)
        self._load()
        self.log("info", f"Cabina 360 lista · ffmpeg={'OK' if self.ffmpeg else 'NO'} · ffprobe={'OK' if self.ffprobe else 'NO'}")

    def log(self, level: str, message: str, job_id: str | None = None):
        entry = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "level": level,
            "msg": str(message)[:2000],
            "jobId": job_id,
        }
        self._logs.append(entry)
        if len(self._logs) > 400:
            self._logs = self._logs[-400:]
        prefix = f"[360:{job_id}]" if job_id else "[360]"
        print(f"{prefix} {message}")

    def get_logs(self, limit: int = 200, job_id: str | None = None) -> list[dict]:
        items = self._logs
        if job_id:
            items = [x for x in items if x.get("jobId") == job_id]
        return items[-max(1, min(limit, 400)):]

    def refresh_binaries(self):
        self.ffmpeg = find_binary("ffmpeg", "FFMPEG_PATH")
        self.ffprobe = find_binary("ffprobe", "FFPROBE_PATH")
        return self.ffmpeg_status()

    def check_setup(self) -> dict:
        checks = []

        def add(cid, label, ok, detail=""):
            checks.append({"id": cid, "label": label, "ok": bool(ok), "detail": detail or ""})

        self.refresh_binaries()
        bundle_hint = str(FFMPEG_BUNDLE)
        add(
            "ffmpeg", "ffmpeg (carpeta del proyecto)", self.ffmpeg,
            self.ffmpeg or f"Falta {bundle_hint}\\ffmpeg.exe",
        )
        add(
            "ffprobe", "ffprobe (carpeta del proyecto)", self.ffprobe,
            self.ffprobe or f"Falta {bundle_hint}\\ffprobe.exe",
        )
        add(
            "ffmpeg_bundle", "Carpeta ffmpeg-7.1.1-full_build",
            FFMPEG_BUNDLE.is_dir(),
            bundle_hint if FFMPEG_BUNDLE.is_dir() else f"Coloca el build en {ROOT / 'ffmpeg-7.1.1-full_build'}",
        )

        # Dependencias Python del backend
        for mod, label in (
            ("aiohttp", "aiohttp"),
            ("PIL", "Pillow"),
            ("cv2", "OpenCV"),
            ("websockets", "websockets"),
            ("numpy", "numpy"),
        ):
            try:
                __import__(mod)
                add(f"py:{mod}", label, True, "Instalado")
            except ImportError:
                add(f"py:{mod}", label, False, "Falta en el venv — ejecuta setup.bat")

        # Frontend node_modules
        nm = ROOT / "frontend" / "node_modules"
        add("node_modules", "Frontend (node_modules)", nm.is_dir(), str(nm) if nm.is_dir() else "Ejecuta npm install en frontend/")

        events_ok = EVENTS_ROOT.is_dir()
        add("events360", "Carpeta events360", events_ok, str(EVENTS_ROOT))

        ready = all(c["ok"] for c in checks if c["id"] in ("ffmpeg", "ffprobe", "py:aiohttp", "node_modules"))
        return {"ready": ready, "checks": checks, **self.ffmpeg_status()}

    def try_install_ffmpeg(self) -> dict:
        """Ya no instala nada: solo verifica la carpeta ffmpeg del repo."""
        self.refresh_binaries()
        ok = bool(self.ffmpeg and self.ffprobe)
        if ok:
            msg = f"ffmpeg OK · {self.ffmpeg}"
        else:
            msg = (
                f"No se encontró ffmpeg en el proyecto. "
                f"Deja la carpeta aquí: {ROOT / 'ffmpeg-7.1.1-full_build'} "
                f"(con bin\\ffmpeg.exe y bin\\ffprobe.exe)."
            )
        self.log("info" if ok else "warn", msg)
        return {"ok": ok, "msg": msg, **self.ffmpeg_status()}

    # ── Persistencia de eventos ───────────────────────────────────────────────

    def _load(self):
        if EVENTS_FILE.exists():
            try:
                data = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
                self.events = {e["id"]: e for e in data.get("events", [])}
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

    def _event_dir(self, eid: str) -> Path:
        return EVENTS_ROOT / eid

    def _unique_id(self, base: str, exclude: str | None = None) -> str:
        candidate, n = base, 2
        while True:
            taken = candidate in self.events and candidate != exclude
            folder = (EVENTS_ROOT / candidate).exists() and candidate != exclude
            if not taken and not folder:
                return candidate
            candidate = f"{base} ({n})"
            n += 1
            if n > 500:
                return f"{base}-{uuid.uuid4().hex[:6]}"

    def list_events(self) -> list[dict]:
        return sorted(self.events.values(), key=lambda e: e.get("createdAt", ""), reverse=True)

    def get_event(self, eid: str) -> dict | None:
        return self.events.get(eid)

    def create_event(self, name: str, ingest_url: str | None = None) -> dict:
        name = (name or "").strip()
        url = (ingest_url or "").strip()
        if not name:
            raise ValueError("El nombre del evento es requerido")
        if not url:
            raise ValueError("La URL de ingest es requerida")
        eid = self._unique_id(slugify(name))
        d = self._event_dir(eid)
        (d / "videos").mkdir(parents=True, exist_ok=True)
        event = {
            "id": eid,
            "name": name,
            "ingestUrl": url,
            "hasFrame": False,
            "createdAt": datetime.now().isoformat(),
        }
        self.events[eid] = event
        self._save()
        return event

    def update_event(self, eid: str, **kwargs) -> dict | None:
        e = self.events.get(eid)
        if not e:
            return None
        if "name" in kwargs and kwargs["name"] is not None:
            new_name = str(kwargs["name"]).strip()
            if not new_name:
                raise ValueError("El nombre del evento es requerido")
            if new_name != e["name"]:
                desired = self._unique_id(slugify(new_name), exclude=eid)
                if desired != eid:
                    old = self._event_dir(eid)
                    new = self._event_dir(desired)
                    if old.exists():
                        old.rename(new)
                    e["id"] = desired
                    del self.events[eid]
                    self.events[desired] = e
                    if self.active_id == eid:
                        self.active_id = desired
                    eid = desired
                e["name"] = new_name
        if "ingestUrl" in kwargs:
            url = str(kwargs["ingestUrl"] or "").strip()
            if not url:
                raise ValueError("La URL de ingest es requerida")
            e["ingestUrl"] = url
        self._save()
        return e

    def delete_event(self, eid: str) -> bool:
        if eid not in self.events:
            return False
        shutil.rmtree(self._event_dir(eid), ignore_errors=True)
        del self.events[eid]
        if self.active_id == eid:
            self.active_id = None
        # limpia jobs del evento
        for jid in [j for j, job in self.jobs.items() if job.get("eventId") == eid]:
            self.jobs.pop(jid, None)
        self._save()
        return True

    def activate(self, eid: str) -> bool:
        if eid not in self.events:
            return False
        self.active_id = eid
        self._save()
        return True

    def deactivate(self) -> None:
        self.active_id = None
        self._save()

    # ── Marco ─────────────────────────────────────────────────────────────────

    def set_frame(self, eid: str, png_bytes: bytes) -> tuple[dict | None, str | None]:
        e = self.events.get(eid)
        if not e:
            return None, "Evento no encontrado"
        path = self._event_dir(eid) / "marco.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png_bytes)
        e["hasFrame"] = True
        self._save()
        return e, None

    def remove_frame(self, eid: str) -> bool:
        e = self.events.get(eid)
        if not e:
            return False
        (self._event_dir(eid) / "marco.png").unlink(missing_ok=True)
        e["hasFrame"] = False
        self._save()
        return True

    def get_frame_path(self, eid: str) -> Path | None:
        p = self._event_dir(eid) / "marco.png"
        return p if p.is_file() else None

    # ── Jobs / cola ───────────────────────────────────────────────────────────

    def ensure_worker(self, loop: asyncio.AbstractEventLoop):
        if self._queue is None:
            self._queue = asyncio.Queue()
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = loop.create_task(self._worker())

    def list_jobs(self, eid: str | None = None) -> list[dict]:
        jobs = list(self.jobs.values())
        if eid:
            jobs = [j for j in jobs if j.get("eventId") == eid]
        jobs.sort(key=lambda j: j.get("createdAt", ""), reverse=True)
        return jobs

    def get_job(self, jid: str) -> dict | None:
        return self.jobs.get(jid)

    def get_thumb_path(self, eid: str, jid: str) -> Path | None:
        p = self._event_dir(eid) / "videos" / jid / "thumb.jpg"
        return p if p.is_file() else None

    async def enqueue_upload(self, eid: str, filename: str, file_bytes: bytes) -> dict:
        e = self.events.get(eid)
        if not e:
            raise ValueError("Evento no encontrado")
        if not self.ffmpeg or not self.ffprobe:
            raise RuntimeError(
                "ffmpeg/ffprobe no encontrados. Instálalos o define FFMPEG_PATH / FFPROBE_PATH."
            )

        jid = uuid.uuid4().hex[:10]
        vdir = self._event_dir(eid) / "videos" / jid
        vdir.mkdir(parents=True, exist_ok=True)
        ext = Path(filename).suffix.lower() or ".mp4"
        original = vdir / f"original{ext}"

        job = {
            "id": jid,
            "eventId": eid,
            "name": Path(filename).stem,
            "originalName": filename,
            "phase": "saving",
            "progress": 0,
            "msg": "Guardando archivo…",
            "error": None,
            "logs": [],
            "createdAt": datetime.now().isoformat(),
            "hasFrame": bool(e.get("hasFrame")),
            "ingestUrl": e.get("ingestUrl"),
        }
        self.jobs[jid] = job
        self.log("info", f"Recibido {filename} ({len(file_bytes)} bytes)", jid)

        loop = asyncio.get_running_loop()
        self.ensure_worker(loop)
        await loop.run_in_executor(None, original.write_bytes, file_bytes)
        job["phase"] = "queued"
        job["msg"] = "En cola…"
        job["progress"] = 5
        await self._queue.put(jid)
        return dict(job)

    def _set(self, job: dict, phase: str, progress: int, msg: str = "", error: str | None = None):
        job["phase"] = phase
        job["progress"] = max(0, min(100, progress))
        if msg:
            job["msg"] = msg
            self.log("info", msg, job.get("id"))
        if error is not None:
            job["error"] = error
            self.log("error", error, job.get("id"))
        logs = job.setdefault("logs", [])
        if msg:
            logs.append({"ts": datetime.now().isoformat(timespec="seconds"), "msg": msg})
            if len(logs) > 80:
                job["logs"] = logs[-80:]

    def _run_ffmpeg(self, cmd: list[str], job: dict | None = None, timeout: int = 600,
                    *, expect_file: Path | None = None, min_bytes: int = 4096) -> str:
        self.log("info", " ".join(cmd[:8]) + (" …" if len(cmd) > 8 else ""), job.get("id") if job else None)
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        err = (r.stderr or r.stdout or "").strip()
        if job is not None and err:
            job.setdefault("logs", []).append({
                "ts": datetime.now().isoformat(timespec="seconds"),
                "msg": err[-1200:],
            })
        if r.returncode != 0:
            raise RuntimeError(err[-500:] or f"ffmpeg exit {r.returncode}")
        # scale2ref (y similares) a veces salen con code 0 y un MP4 vacío
        if expect_file is not None:
            size = expect_file.stat().st_size if expect_file.is_file() else 0
            if size < min_bytes:
                raise RuntimeError(
                    f"Salida inválida ({size} bytes): {expect_file.name}. "
                    f"{err[-300:] if err else ''}".strip()
                )
        return err

    async def _worker(self):
        assert self._queue is not None
        while True:
            jid = await self._queue.get()
            try:
                await self._process_job(jid)
            except Exception as exc:
                job = self.jobs.get(jid)
                if job:
                    self._set(job, "error", job.get("progress", 0), str(exc)[:240], str(exc)[:800])
                self.log("error", f"Job {jid} falló: {exc}", jid)
            finally:
                self._queue.task_done()

    async def retry_job(self, jid: str) -> dict:
        job = self.jobs.get(jid)
        if not job:
            raise ValueError("Job no encontrado")
        eid = job["eventId"]
        vdir = self._event_dir(eid) / "videos" / jid
        if not list(vdir.glob("original.*")):
            raise ValueError("No hay archivo original para reintentar")
        job["phase"] = "queued"
        job["progress"] = 5
        job["msg"] = "Reencolado…"
        job["error"] = None
        job.setdefault("logs", []).append({
            "ts": datetime.now().isoformat(timespec="seconds"),
            "msg": "Reintento manual",
        })
        loop = asyncio.get_running_loop()
        self.ensure_worker(loop)
        await self._queue.put(jid)
        self.log("info", "Job reencolado", jid)
        return dict(job)

    async def _process_job(self, jid: str):
        job = self.jobs.get(jid)
        if not job:
            return
        eid = job["eventId"]
        e = self.events.get(eid)
        if not e:
            self._set(job, "error", 0, "Evento eliminado", "Evento eliminado")
            return

        if not self.ffmpeg:
            self.refresh_binaries()
        if not self.ffmpeg:
            self._set(job, "error", 0, "ffmpeg no disponible", "ffmpeg no encontrado")
            return

        vdir = self._event_dir(eid) / "videos" / jid
        originals = list(vdir.glob("original.*"))
        if not originals:
            self._set(job, "error", 0, "Archivo original no encontrado", "missing original")
            return
        original = originals[0]
        compressed = vdir / "compressed.mp4"
        processed = vdir / "processed.mp4"
        thumb = vdir / "thumb.jpg"
        frame = self.get_frame_path(eid)
        loop = asyncio.get_running_loop()

        # ── Comprimir ─────────────────────────────────────────────────────────
        self._set(job, "compressing", 15, "Comprimiendo con ffmpeg…")

        def _compress():
            cmd = [
                self.ffmpeg, "-y", "-i", str(original),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
                "-vf", "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                str(compressed),
            ]
            self._run_ffmpeg(cmd, job, timeout=600, expect_file=compressed, min_bytes=8192)

        await loop.run_in_executor(None, _compress)
        self._set(job, "compressing", 45, "Compresión lista")

        # ── Marco ─────────────────────────────────────────────────────────────
        source_for_thumb = compressed
        if frame and frame.is_file():
            self._set(job, "framing", 50, "Aplicando marco…")

            def _frame():
                # ffmpeg 7: scale2ref está deprecado y a veces deja MP4 vacío con exit 0
                cmd = [
                    self.ffmpeg, "-y",
                    "-i", str(compressed),
                    "-i", str(frame),
                    "-filter_complex",
                    "[1:v][0:v]scale=rw:rh[ov];[0:v][ov]overlay=0:0",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-an",
                    "-movflags", "+faststart",
                    str(processed),
                ]
                try:
                    self._run_ffmpeg(cmd, job, timeout=600, expect_file=processed, min_bytes=8192)
                except RuntimeError:
                    if processed.exists():
                        processed.unlink(missing_ok=True)
                    cmd2 = [
                        self.ffmpeg, "-y",
                        "-i", str(compressed),
                        "-i", str(frame),
                        "-filter_complex",
                        "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[base];"
                        "[1:v][base]scale=rw:rh[ov];"
                        "[base][ov]overlay=0:0",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-an",
                        "-movflags", "+faststart",
                        str(processed),
                    ]
                    self._run_ffmpeg(cmd2, job, timeout=600, expect_file=processed, min_bytes=8192)

            await loop.run_in_executor(None, _frame)
            source_for_thumb = processed
            self._set(job, "framing", 65, "Marco aplicado")
        else:
            shutil.copy2(compressed, processed)
            source_for_thumb = processed
            self._set(job, "framing", 65, "Sin marco — omitido")

        # ── Thumbnail ─────────────────────────────────────────────────────────
        self._set(job, "thumbnail", 70, "Generando miniatura…")

        def _thumb():
            def build(src: Path, ss: str) -> list[str]:
                return [
                    self.ffmpeg, "-y",
                    "-ss", ss,
                    "-i", str(src),
                    "-an",
                    "-frames:v", "1",
                    "-update", "1",
                    "-q:v", "3",
                    "-vf", "scale=480:-2",
                    str(thumb),
                ]
            src = source_for_thumb
            if not src.is_file() or src.stat().st_size < 8192:
                src = compressed
            try:
                self._run_ffmpeg(build(src, "00:00:01"), job, timeout=120, expect_file=thumb, min_bytes=200)
            except RuntimeError:
                if thumb.exists():
                    thumb.unlink(missing_ok=True)
                self._run_ffmpeg(build(src, "00:00:00"), job, timeout=120, expect_file=thumb, min_bytes=200)

        await loop.run_in_executor(None, _thumb)
        self._set(job, "thumbnail", 80, "Miniatura lista")

        # ── Upload ────────────────────────────────────────────────────────────
        ingest = (e.get("ingestUrl") or "").strip()
        if not ingest:
            self._set(job, "done", 100, "Procesado (sin URL de ingest — solo local)")
            return

        self._set(job, "uploading", 85, "Subiendo video…")
        ok, msg = await self._upload_file(ingest, processed, "video/mp4")
        if not ok:
            self._set(job, "error", 85, f"Error al subir video: {msg}", msg)
            return

        self._set(job, "uploading_thumb", 93, "Subiendo miniatura…")
        ok, msg = await self._upload_file(ingest, thumb, "image/jpeg")
        if not ok:
            self._set(job, "error", 93, f"Video OK, thumb falló: {msg}", msg)
            return

        self._set(job, "done", 100, "Listo")

    async def _upload_file(self, url: str, path: Path, content_type: str) -> tuple[bool, str]:
        try:
            from aiohttp import FormData, ClientSession, ClientTimeout
            data = FormData()
            data.add_field(
                "file",
                path.read_bytes(),
                filename=path.name,
                content_type=content_type,
            )
            timeout = ClientTimeout(total=300, connect=20)
            async with ClientSession(timeout=timeout) as session:
                async with session.post(url, data=data) as resp:
                    body = await resp.text()
                    if resp.status >= 400:
                        return False, f"HTTP {resp.status}: {body[:180]}"
                    return True, body[:120] or "OK"
        except Exception as exc:
            return False, str(exc)

    def ffmpeg_status(self) -> dict:
        return {
            "ffmpeg": self.ffmpeg,
            "ffprobe": self.ffprobe,
            "ok": bool(self.ffmpeg and self.ffprobe),
        }
