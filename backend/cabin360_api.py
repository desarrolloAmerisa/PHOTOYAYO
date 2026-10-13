"""
Cabina 360 API — aiohttp en puerto 8767.

  GET    /api/360/status
  GET    /api/360/setup
  POST   /api/360/setup/install-ffmpeg
  GET    /api/360/logs
  POST   /api/360/jobs/{jobId}/retry
  GET    /api/360/events
  POST   /api/360/events
  PUT    /api/360/events/{id}
  DELETE /api/360/events/{id}
  POST   /api/360/events/{id}/activate
  DELETE /api/360/events/{id}/activate
  GET    /api/360/events/{id}/marco
  POST   /api/360/events/{id}/marco
  DELETE /api/360/events/{id}/marco
  POST   /api/360/events/{id}/videos
  GET    /api/360/events/{id}/jobs
  GET    /api/360/jobs/{jobId}
  GET    /api/360/events/{id}/videos/{jobId}/thumb
"""

from __future__ import annotations

import json
from aiohttp import web

from cabin360_manager import Cabin360Manager

CABIN360_PORT = 8767
MAX_VIDEO = 2 * 1024 * 1024 * 1024  # 2 GB
MAX_FRAME = 30 * 1024 * 1024


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


def make_cabin360_app(mgr: Cabin360Manager) -> web.Application:
    async def handle_options(request):
        return web.Response(status=204, headers=_cors())

    async def status(request):
        setup = mgr.check_setup()
        return _ok({
            "ok": setup.get("ready", False),
            **mgr.ffmpeg_status(),
            "activeId": mgr.active_id,
            "ready": setup.get("ready", False),
        })

    async def get_setup(request):
        return _ok(mgr.check_setup())

    async def install_ffmpeg(request):
        import asyncio
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, mgr.try_install_ffmpeg)
        return _ok(result) if result.get("ok") else _ok(result, 500)

    async def get_logs(request):
        try:
            limit = int(request.query.get("limit", "200"))
        except ValueError:
            limit = 200
        job_id = request.query.get("jobId") or None
        return _ok({"logs": mgr.get_logs(limit=limit, job_id=job_id)})

    async def retry_job(request):
        jid = request.match_info["jobId"]
        try:
            job = await mgr.retry_job(jid)
        except ValueError as exc:
            return _err(str(exc), 404)
        return _ok(job)

    async def get_events(request):
        return _ok({"events": mgr.list_events(), "activeId": mgr.active_id})

    async def create_event(request):
        try:
            body = await request.json()
            name = str(body.get("name", "")).strip()
            ingest = body.get("ingestUrl") or None
        except Exception:
            return _err("JSON inválido")
        try:
            return _ok(mgr.create_event(name, ingest), 201)
        except ValueError as exc:
            return _err(str(exc))

    async def update_event(request):
        eid = request.match_info["id"]
        try:
            body = await request.json()
        except Exception:
            return _err("JSON inválido")
        kwargs = {}
        if "name" in body:
            kwargs["name"] = body.get("name")
        if "ingestUrl" in body:
            kwargs["ingestUrl"] = body.get("ingestUrl")
        try:
            result = mgr.update_event(eid, **kwargs)
        except ValueError as exc:
            return _err(str(exc))
        return _ok(result) if result else _err("Evento no encontrado", 404)

    async def delete_event(request):
        eid = request.match_info["id"]
        return _ok({"ok": True}) if mgr.delete_event(eid) else _err("Evento no encontrado", 404)

    async def activate(request):
        eid = request.match_info["id"]
        if not mgr.activate(eid):
            return _err("Evento no encontrado", 404)
        return _ok({"ok": True, "activeId": eid})

    async def deactivate(request):
        mgr.deactivate()
        return _ok({"ok": True, "activeId": None})

    async def get_marco(request):
        eid = request.match_info["id"]
        path = mgr.get_frame_path(eid)
        if not path:
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={**_cors(), "Cache-Control": "no-cache"})

    async def upload_marco(request):
        eid = request.match_info["id"]
        e = mgr.get_event(eid)
        if not e:
            return _err("Evento no encontrado", 404)
        if not (e.get("name") or "").strip() or not (e.get("ingestUrl") or "").strip():
            return _err("Guarda primero el nombre y la URL de ingest del evento")
        try:
            reader = await request.multipart()
            field = await reader.next()
            if field is None:
                return _err("Archivo requerido")
            data = b""
            while True:
                chunk = await field.read_chunk(64 * 1024)
                if not chunk:
                    break
                data += chunk
                if len(data) > MAX_FRAME:
                    return _err("El marco supera 30 MB", 413)
        except Exception as exc:
            return _err(f"Error al leer marco: {exc}")
        event, err = mgr.set_frame(eid, data)
        return _ok(event) if event else _err(err or "Error")

    async def delete_marco(request):
        eid = request.match_info["id"]
        return _ok({"ok": True}) if mgr.remove_frame(eid) else _err("Evento no encontrado", 404)

    async def upload_videos(request):
        eid = request.match_info["id"]
        e = mgr.get_event(eid)
        if not e:
            return _err("Evento no encontrado", 404)
        if not (e.get("name") or "").strip() or not (e.get("ingestUrl") or "").strip():
            return _err("Guarda primero el nombre y la URL de ingest del evento")
        import asyncio
        mgr.ensure_worker(asyncio.get_event_loop())
        created = []
        try:
            reader = await request.multipart()
            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name not in ("videos", "file", "video"):
                    # drenar campos no-archivo
                    if field.filename is None:
                        await field.read(decode=False)
                        continue
                filename = field.filename or "video.mp4"
                data = b""
                while True:
                    chunk = await field.read_chunk(256 * 1024)
                    if not chunk:
                        break
                    data += chunk
                    if len(data) > MAX_VIDEO:
                        return _err(f"{filename} supera 2 GB", 413)
                if not data:
                    continue
                job = await mgr.enqueue_upload(eid, filename, data)
                created.append(job)
        except Exception as exc:
            return _err(f"Error al recibir videos: {exc}")
        if not created:
            return _err("No se recibieron videos")
        return _ok({"ok": True, "jobs": created}, 201)

    async def list_jobs(request):
        eid = request.match_info["id"]
        if eid not in mgr.events:
            return _err("Evento no encontrado", 404)
        return _ok({"jobs": mgr.list_jobs(eid)})

    async def get_job(request):
        jid = request.match_info["jobId"]
        job = mgr.get_job(jid)
        return _ok(job) if job else _err("Job no encontrado", 404)

    async def get_thumb(request):
        eid = request.match_info["id"]
        jid = request.match_info["jobId"]
        path = mgr.get_thumb_path(eid, jid)
        if not path:
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={**_cors(), "Cache-Control": "private, max-age=60"})

    app = web.Application(client_max_size=MAX_VIDEO + 8 * 1024 * 1024)
    app["cabin360"] = mgr
    app.router.add_route("OPTIONS", "/{path_info:.*}", handle_options)
    app.router.add_get(    "/api/360/status",                         status)
    app.router.add_get(    "/api/360/setup",                          get_setup)
    app.router.add_post(   "/api/360/setup/install-ffmpeg",          install_ffmpeg)
    app.router.add_get(    "/api/360/logs",                           get_logs)
    app.router.add_post(   "/api/360/jobs/{jobId}/retry",             retry_job)
    app.router.add_get(    "/api/360/events",                         get_events)
    app.router.add_post(   "/api/360/events",                         create_event)
    app.router.add_put(    "/api/360/events/{id}",                    update_event)
    app.router.add_delete( "/api/360/events/{id}",                    delete_event)
    app.router.add_post(   "/api/360/events/{id}/activate",           activate)
    app.router.add_delete( "/api/360/events/{id}/activate",           deactivate)
    app.router.add_get(    "/api/360/events/{id}/marco",              get_marco)
    app.router.add_post(   "/api/360/events/{id}/marco",              upload_marco)
    app.router.add_delete( "/api/360/events/{id}/marco",              delete_marco)
    app.router.add_post(   "/api/360/events/{id}/videos",             upload_videos)
    app.router.add_get(    "/api/360/events/{id}/jobs",               list_jobs)
    app.router.add_get(    "/api/360/jobs/{jobId}",                   get_job)
    app.router.add_get(    "/api/360/events/{id}/videos/{jobId}/thumb", get_thumb)
    return app


async def start_cabin360_server(mgr: Cabin360Manager | None = None) -> web.AppRunner:
    mgr = mgr or Cabin360Manager()
    runner = web.AppRunner(make_cabin360_app(mgr))
    await runner.setup()
    await web.TCPSite(runner, "localhost", CABIN360_PORT).start()
    print(f"  Cabina 360 → http://localhost:{CABIN360_PORT}")
    ff = mgr.ffmpeg_status()
    if ff["ok"]:
        print(f"  ffmpeg     → {ff['ffmpeg']}")
    else:
        print("  AVISO: ffmpeg/ffprobe no encontrados (define FFMPEG_PATH)")
    return runner
