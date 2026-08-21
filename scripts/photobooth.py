"""
PHOTOBOOTH con gestos de mano
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Gestos:
  ✋ Palma abierta (0.6 s)  → Inicia sesión: cuenta 3-2-1, toma 3 fotos cada 5 s
  👋 Desliza palma →        → Siguiente filtro
  👋 Desliza palma ←        → Filtro anterior

Teclas:
  Q / ESC   → Salir
  F         → Siguiente filtro (atajo de teclado)

Dependencias: opencv-python  mediapipe  Pillow  numpy
"""

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import numpy as np
from PIL import Image, ImageEnhance
import time
import os
import sys
import urllib.request
from datetime import datetime
from collections import deque

# ─── Configuración ────────────────────────────────────────────────────────────
PHOTOS_DIR     = os.path.join(os.path.dirname(__file__), "..", "photos")
MODEL_PATH     = os.path.join(os.path.dirname(__file__), "hand_landmarker.task")
MODEL_URL      = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)
BURST_COUNT    = 3      # Fotos por sesión
PHOTO_INTERVAL = 5.0    # Segundos entre disparos
COUNTDOWN_SECS = 3      # Cuenta regresiva inicial
PREVIEW_SECS   = 6      # Duración de la vista previa
PALM_HOLD_SECS = 0.6    # Segundos sosteniendo la palma para activar
SWIPE_FRAMES   = 14     # Historial de frames para detectar swipe
SWIPE_THRESH   = 0.13   # Desplazamiento X mínimo para considerar swipe
FLASH_SECS     = 0.25   # Duración del flash blanco al capturar

# Estados de la máquina de estados
IDLE      = "idle"
COUNTDOWN = "countdown"
TAKING    = "taking"
PREVIEW   = "preview"

# Filtros disponibles
FILTERS = ["Normal", "Blanco y Negro", "Sepia", "Vintage", "Blur", "Sketch"]

# Conexiones de la mano para dibujar el esqueleto
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (0, 9), (9, 10), (10, 11), (11, 12),
    (0, 13), (13, 14), (14, 15), (15, 16),
    (0, 17), (17, 18), (18, 19), (19, 20),
    (5, 9), (9, 13), (13, 17),
]

os.makedirs(PHOTOS_DIR, exist_ok=True)


# ─── Descarga del modelo ──────────────────────────────────────────────────────

def ensure_model() -> None:
    if os.path.exists(MODEL_PATH):
        return
    print("Descargando modelo de deteccion de manos (~8 MB)...")
    try:
        def _progress(block, block_size, total):
            downloaded = block * block_size
            pct = min(downloaded * 100 // total, 100) if total > 0 else 0
            print(f"\r  {pct}%  ({downloaded // 1024} KB)", end="", flush=True)
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH, reporthook=_progress)
        print("\nModelo descargado correctamente.")
    except Exception as exc:
        print(f"\nERROR al descargar el modelo: {exc}")
        print(f"Descargalo manualmente desde:\n  {MODEL_URL}")
        print(f"y colócalo en:\n  {MODEL_PATH}")
        sys.exit(1)


# ─── Filtros ──────────────────────────────────────────────────────────────────

def _vignette(frame: np.ndarray, strength: float = 0.55) -> np.ndarray:
    """Aplica un efecto de viñeta rápido con kernels gaussianos."""
    rows, cols = frame.shape[:2]
    kx = cv2.getGaussianKernel(cols, int(cols * strength))
    ky = cv2.getGaussianKernel(rows, int(rows * strength))
    mask = (ky * kx.T)
    mask = (mask / mask.max()).astype(np.float32)
    out = frame.astype(np.float32)
    out[:, :, 0] *= mask
    out[:, :, 1] *= mask
    out[:, :, 2] *= mask
    return np.clip(out, 0, 255).astype(np.uint8)


def apply_filter(frame: np.ndarray, name: str) -> np.ndarray:
    if name == "Normal":
        return frame.copy()

    if name == "Blanco y Negro":
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)

    if name == "Sepia":
        kernel = np.array([[0.272, 0.534, 0.131],
                           [0.349, 0.686, 0.168],
                           [0.393, 0.769, 0.189]], dtype=np.float32)
        out = cv2.transform(frame.astype(np.float32), kernel)
        return np.clip(out, 0, 255).astype(np.uint8)

    if name == "Vintage":
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        img = ImageEnhance.Color(img).enhance(0.55)
        img = ImageEnhance.Contrast(img).enhance(1.4)
        img = ImageEnhance.Brightness(img).enhance(0.88)
        out = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        return _vignette(out)

    if name == "Blur":
        return cv2.GaussianBlur(frame, (31, 31), 0)

    if name == "Sketch":
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        inv = cv2.bitwise_not(g)
        blur = cv2.GaussianBlur(inv, (21, 21), 0)
        sketch = cv2.divide(g, 255 - blur, scale=256.0)
        return cv2.cvtColor(sketch, cv2.COLOR_GRAY2BGR)

    return frame.copy()


# ─── Detección de gestos ──────────────────────────────────────────────────────

def is_open_palm(lm: list) -> bool:
    """True si los 4 dedos principales están extendidos."""
    tips = [8, 12, 16, 20]
    pips = [6, 10, 14, 18]
    return sum(1 for t, p in zip(tips, pips) if lm[t].y < lm[p].y) >= 4


def is_index_only(lm: list) -> bool:
    """☘️ Solo el dedo índice levantado, los demás recogidos.
    Índice: tip 8 > pip 6 (arriba).
    Medio/anular/meñique: tip bajo respecto a pip (recogidos).
    Pulgar: tip 4 más separado en X que el nudo 3.
    """
    index_up  = lm[8].y  < lm[6].y
    middle_dn = lm[12].y > lm[10].y
    ring_dn   = lm[16].y > lm[14].y
    pinky_dn  = lm[20].y > lm[18].y
    return index_up and middle_dn and ring_dn and pinky_dn


# ─── Dibujo de manos ──────────────────────────────────────────────────────────

def draw_hand(img: np.ndarray, lm: list, h: int, w: int) -> None:
    pts = [(int(p.x * w), int(p.y * h)) for p in lm]
    for a, b in HAND_CONNECTIONS:
        cv2.line(img, pts[a], pts[b], (0, 200, 255), 2, cv2.LINE_AA)
    for x, y in pts:
        cv2.circle(img, (x, y), 4, (0, 255, 150), -1, cv2.LINE_AA)


# ─── Utilidades de dibujo ─────────────────────────────────────────────────────

def put_text(img: np.ndarray, text: str, pos: tuple,
             scale: float = 1.0, color=(255, 255, 255),
             thickness: int = 2) -> None:
    """Texto con sombra negra para mayor legibilidad."""
    font = cv2.FONT_HERSHEY_DUPLEX
    x, y = pos
    cv2.putText(img, text, (x + 2, y + 2), font, scale,
                (0, 0, 0), thickness + 2, cv2.LINE_AA)
    cv2.putText(img, text, (x, y), font, scale, color, thickness, cv2.LINE_AA)


def centered_text(img: np.ndarray, text: str, cy_offset: int = 0,
                  scale: float = 4.0, color=(255, 80, 80),
                  thickness: int = 7) -> None:
    """Texto centrado horizontalmente."""
    h, w = img.shape[:2]
    font = cv2.FONT_HERSHEY_DUPLEX
    (tw, th), _ = cv2.getTextSize(text, font, scale, thickness)
    x = (w - tw) // 2
    y = h // 2 + cy_offset
    cv2.putText(img, text, (x + 3, y + 3), font, scale,
                (0, 0, 0), thickness + 3, cv2.LINE_AA)
    cv2.putText(img, text, (x, y), font, scale, color, thickness, cv2.LINE_AA)


def draw_progress_ring(img: np.ndarray, cx: int, cy: int, r: int,
                        progress: float, color=(0, 220, 255), thickness: int = 6) -> None:
    """Arco de progreso. progress ∈ [0, 1]."""
    angle = int(360 * progress)
    cv2.ellipse(img, (cx, cy), (r, r), -90, 0, angle, color, thickness, cv2.LINE_AA)
    cv2.ellipse(img, (cx, cy), (r, r), 0, 0, 360, (80, 80, 80), 2, cv2.LINE_AA)


# ─── Tira de fotos (photo strip) ─────────────────────────────────────────────────────

STRIP_PHOTO_W = 400   # Ancho de cada foto en la tira (px)
STRIP_BORDER  = 12    # Borde blanco entre fotos y bordes (px)


def make_strip(photos: list) -> np.ndarray:
    """Construye una tira vertical tipo photobooth con fondo blanco."""
    target_w = STRIP_PHOTO_W
    strips = []
    for p in photos:
        ph, pw = p.shape[:2]
        scale   = target_w / pw
        resized = cv2.resize(p, (target_w, int(ph * scale)))
        strips.append(resized)

    # Fondo blanco total
    photo_h = strips[0].shape[0]
    total_h = STRIP_BORDER + (photo_h + STRIP_BORDER) * len(strips)
    canvas  = np.full((total_h, target_w + STRIP_BORDER * 2, 3), 255, dtype=np.uint8)

    for i, img in enumerate(strips):
        y = STRIP_BORDER + i * (photo_h + STRIP_BORDER)
        canvas[y:y + photo_h, STRIP_BORDER:STRIP_BORDER + target_w] = img

    return canvas


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    ensure_model()

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)

    base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.72,
        min_hand_presence_confidence=0.65,
        min_tracking_confidence=0.65,
    )
    landmarker = mp_vision.HandLandmarker.create_from_options(options)

    # ── Estado ────────────────────────────────────────────────────────────────
    state            = IDLE
    filter_idx       = 0
    debug_mode       = False   # Tecla D para activar/desactivar

    # Sesión de fotos
    session_dir      = None
    photo_count      = 0
    photos_taken: list = []
    next_shot_at     = 0.0
    session_start_at = 0.0   # momento en que empezó el COUNTDOWN

    # Vista previa
    preview_start_at = 0.0

    # Flash
    flash_until      = 0.0

    # Gesto: palma sostenida
    palm_held_since  = None   # timestamp cuando se detectó primera vez la palma abierta

    # Gesto: swipe (historial de posición X de la muñeca)
    palm_x_hist: deque = deque(maxlen=SWIPE_FRAMES)
    swipe_cooldown   = 0.0

    # Cooldown al volver al estado IDLE
    palm_cooldown    = 0.0

    print("═" * 50)
    print("  PHOTOBOOTH  –  Controles")
    print("═" * 50)
    print("  ✋  Palma abierta (~0.6 s)  →  Iniciar sesión")
    print("  ✋→  Desliza derecha       →  Siguiente filtro")
    print("  ✋←  Desliza izquierda     →  Filtro anterior")
    print("  F  →  Siguiente filtro (teclado)")
    print("  Q / ESC  →  Salir")
    print("═" * 50)

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Aplicar flip según configuración (por ahora desactivado)
        # frame = cv2.flip(frame, 1)   # espejo horizontal
        h, w    = frame.shape[:2]
        now     = time.time()

        # Aplicar filtro al frame de visualización
        display = apply_filter(frame, FILTERS[filter_idx])

        # ── Detección de manos ────────────────────────────────────────────────
        rgb      = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        detection = landmarker.detect(mp_image)

        palm_open  = False
        index_only = False
        palm_x     = None

        if detection.hand_landmarks:
            lm         = detection.hand_landmarks[0]
            palm_open  = is_open_palm(lm)
            index_only = is_index_only(lm)
            palm_x     = lm[8].x   # punta del índice para swipe

            if debug_mode:
                draw_hand(display, lm, h, w)

        # ── Detección de swipe con índice ────────────────────────────────────────────
        if index_only and palm_x is not None:
            palm_x_hist.append(palm_x)
        else:
            palm_x_hist.clear()

        hand_moving = False
        if len(palm_x_hist) >= 4:
            # Considera la mano en movimiento si el rango de X en los últimos frames supera umbral
            recent = list(palm_x_hist)[-8:]
            hand_moving = (max(recent) - min(recent)) > 0.04

        if len(palm_x_hist) == SWIPE_FRAMES and now > swipe_cooldown:
            delta = palm_x_hist[-1] - palm_x_hist[0]
            if abs(delta) > SWIPE_THRESH:
                if delta > 0:
                    filter_idx = (filter_idx + 1) % len(FILTERS)
                else:
                    filter_idx = (filter_idx - 1) % len(FILTERS)
                swipe_cooldown = now + 1.2
                palm_held_since = None   # cancelar contador de foto al deslizar
                palm_x_hist.clear()
                print(f"Filtro: {FILTERS[filter_idx]}")
                display = apply_filter(frame, FILTERS[filter_idx])

        # ── Máquina de estados ────────────────────────────────────────────────

        # ── IDLE ─────────────────────────────────────────────────────────────
        if state == IDLE:
            # Instrucciones en pantalla
            bar_h = 44
            cv2.rectangle(display, (0, h - bar_h), (w, h), (0, 0, 0), -1)
            put_text(display, "Palma quieta = iniciar  |  ☝️ Desliza indice = cambiar filtro",
                     (14, h - 12), scale=0.65, color=(200, 200, 200), thickness=1)

            # Nombre del filtro (esquina superior izquierda)
            cv2.rectangle(display, (0, 0), (280, 38), (0, 0, 0), -1)
            put_text(display, f"Filtro: {FILTERS[filter_idx]}",
                     (10, 26), scale=0.75, color=(255, 220, 50), thickness=2)

            # Palma quieta y sostenida → anillo de progreso y activar
            if palm_open and not hand_moving and now > palm_cooldown:
                if palm_held_since is None:
                    palm_held_since = now
                held = now - palm_held_since
                progress = min(held / PALM_HOLD_SECS, 1.0)
                draw_progress_ring(display, w // 2, h // 2, 60, progress,
                                   color=(0, 220, 255), thickness=8)
                put_text(display, "Mantenga quieto...",
                         (w // 2 - 110, h // 2 + 80), scale=0.8,
                         color=(0, 220, 255), thickness=2)

                if held >= PALM_HOLD_SECS:
                    state          = COUNTDOWN
                    session_start_at = now
                    photo_count    = 0
                    photos_taken   = []
                    session_dir    = os.path.join(
                        PHOTOS_DIR,
                        datetime.now().strftime("%Y%m%d_%H%M%S"),
                    )
                    os.makedirs(session_dir, exist_ok=True)
                    palm_held_since = None
                    print(f"\n📸  Sesión iniciada → {session_dir}")
            else:
                palm_held_since = None

        # ── COUNTDOWN ────────────────────────────────────────────────────────
        elif state == COUNTDOWN:
            elapsed   = now - session_start_at
            remaining = COUNTDOWN_SECS - elapsed

            if remaining <= 0:
                # Pasar a tomar fotos
                state       = TAKING
                next_shot_at = now
            else:
                num = str(int(remaining) + 1)
                centered_text(display, num, cy_offset=20,
                              scale=5.0, color=(255, 80, 80), thickness=9)
                put_text(display, f"Foto 1 / {BURST_COUNT}",
                         (10, 36), scale=0.9, color=(255, 220, 50), thickness=2)

        # ── TAKING ───────────────────────────────────────────────────────────
        elif state == TAKING:
            if now >= next_shot_at:
                # ─ Disparar foto ─
                photo = apply_filter(frame, FILTERS[filter_idx])
                photo_count += 1
                filename = os.path.join(session_dir, f"foto_{photo_count}.jpg")
                cv2.imwrite(filename, photo)
                photos_taken.append(photo.copy())
                flash_until = now + FLASH_SECS
                print(f"  📷  Foto {photo_count}/{BURST_COUNT} → {filename}")

                if photo_count >= BURST_COUNT:
                    # Guardar tira completa
                    strip = make_strip(photos_taken)
                    strip_path = os.path.join(session_dir, "tira.jpg")
                    cv2.imwrite(strip_path, strip)
                    print(f"  🎞️  Tira guardada → {strip_path}")
                    state            = PREVIEW
                    preview_start_at = now
                    palm_cooldown    = now + 2.0
                else:
                    next_shot_at = now + PHOTO_INTERVAL
            else:
                # Cuenta regresiva entre fotos
                secs_left = next_shot_at - now
                num = str(int(secs_left) + 1)
                centered_text(display, num, cy_offset=20,
                              scale=4.5, color=(80, 255, 150), thickness=8)
                put_text(display, f"Foto {photo_count + 1} / {BURST_COUNT}",
                         (10, 36), scale=0.9, color=(255, 220, 50), thickness=2)

        # ── PREVIEW ──────────────────────────────────────────────────────────
        elif state == PREVIEW:
            elapsed_prev = now - preview_start_at
            if elapsed_prev >= PREVIEW_SECS:
                state = IDLE
            else:
                strip          = make_strip(photos_taken)
                strip_h, strip_w = strip.shape[:2]

                # Escalar la tira para que quepa en la ventana con margen
                max_h = h - 80
                max_w = w - 80
                scale_fit = min(max_h / strip_h, max_w / strip_w, 1.0)
                disp_w = int(strip_w * scale_fit)
                disp_h = int(strip_h * scale_fit)
                strip_small = cv2.resize(strip, (disp_w, disp_h))

                # Fondo semi-oscuro
                overlay = display.copy()
                cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.60, display, 0.40, 0, display)

                # Centrar tira
                x0 = (w - disp_w) // 2
                y0 = (h - disp_h) // 2
                display[y0:y0 + disp_h, x0:x0 + disp_w] = strip_small

                # Textos
                centered_text(display, "Tira guardada!",
                              cy_offset=-(disp_h // 2 + 36),
                              scale=1.0, color=(100, 255, 120), thickness=2)
                secs_left = int(PREVIEW_SECS - elapsed_prev) + 1
                put_text(display, f"Volviendo en {secs_left}s...",
                         (w // 2 - 110, y0 + disp_h + 28),
                         scale=0.75, color=(180, 180, 180), thickness=1)

        # ── Flash ─────────────────────────────────────────────────────────────
        if now < flash_until:
            alpha = 1.0 - (now - (flash_until - FLASH_SECS)) / FLASH_SECS
            alpha = max(0.0, min(1.0, alpha))
            white = np.full_like(display, 255)
            cv2.addWeighted(white, alpha, display, 1.0 - alpha, 0, display)

        # ── Indicador de filtro al hacer swipe ────────────────────────────────
        if now < swipe_cooldown:
            fade = min(1.0, (swipe_cooldown - now) / 0.6)
            color = (int(255 * fade), int(220 * fade), int(50 * fade))
            put_text(display, f"< {FILTERS[filter_idx]} >",
                     (w // 2 - 130, 48), scale=1.0, color=color, thickness=2)

        cv2.imshow("PHOTOBOOTH", display)

        # ── Overlay de debug (encima de todo) ────────────────────────────────
        if debug_mode:
            dbg = display.copy()
            # Panel semitransparente
            panel_h = 130
            cv2.rectangle(dbg, (w - 230, 0), (w, panel_h), (0, 0, 0), -1)
            cv2.addWeighted(dbg, 0.65, display, 0.35, 0, dbg)

            # Indicador debug ON
            cv2.rectangle(dbg, (w - 228, 2), (w - 2, 22), (0, 80, 200), -1)
            put_text(dbg, "DEBUG ON  [D]", (w - 224, 18),
                     scale=0.55, color=(255, 255, 100), thickness=1)

            # Gestos detectados
            hand_detected = detection.hand_landmarks != []
            put_text(dbg, f"Mano:      {'SI' if hand_detected else 'NO'}",
                     (w - 224, 44), scale=0.55,
                     color=(0, 255, 100) if hand_detected else (100, 100, 100),
                     thickness=1)
            put_text(dbg, f"Palma:     {'SI' if palm_open  else 'NO'}",
                     (w - 224, 64), scale=0.55,
                     color=(0, 220, 255) if palm_open  else (100, 100, 100),
                     thickness=1)
            put_text(dbg, f"Indice:    {'SI' if index_only else 'NO'}",
                     (w - 224, 84), scale=0.55,
                     color=(255, 200, 0) if index_only else (100, 100, 100),
                     thickness=1)
            put_text(dbg, f"Movim:     {'SI' if hand_moving else 'NO'}",
                     (w - 224, 104), scale=0.55,
                     color=(255, 100, 0) if hand_moving else (100, 100, 100),
                     thickness=1)
            put_text(dbg, f"Estado:    {state}",
                     (w - 224, 124), scale=0.55, color=(200, 200, 200),
                     thickness=1)
            cv2.imshow("PHOTOBOOTH", dbg)
        else:
            # Botón discreto en esquina para recordar la tecla
            cv2.rectangle(display, (w - 90, 0), (w, 22), (30, 30, 30), -1)
            put_text(display, "[D] debug", (w - 86, 16),
                     scale=0.45, color=(120, 120, 120), thickness=1)
            cv2.imshow("PHOTOBOOTH", display)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), 27):
            break
        if key == ord('d') or key == ord('D'):
            debug_mode = not debug_mode
            print(f"Debug {'ON' if debug_mode else 'OFF'}")
        if key == ord('f') and state == IDLE:
            filter_idx = (filter_idx + 1) % len(FILTERS)
            print(f"Filtro: {FILTERS[filter_idx]}")

    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()
    print("\nFotobooth cerrado. ¡Hasta pronto!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nFotobooth cerrado. ¡Hasta pronto!")
