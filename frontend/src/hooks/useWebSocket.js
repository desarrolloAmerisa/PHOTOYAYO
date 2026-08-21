import { useEffect, useRef, useCallback } from 'react'

/**
 * Hook que mantiene una conexión WebSocket con reconexión automática.
 * Usa un flag `active` para evitar reconexiones fantasma en React StrictMode.
 * @param {string}   url       ws://localhost:8765
 * @param {function} onMessage callback(parsedJSON)
 * @returns {function} send(object)
 */
export function useWebSocket(url, onMessage) {
  const wsRef    = useRef(null)
  const cbRef    = useRef(onMessage)
  cbRef.current  = onMessage

  useEffect(() => {
    let ws
    let timer
    let active = true   // ← previene reconexión fantasma en StrictMode

    const connect = () => {
      ws            = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => console.info('[WS] Conectado')

      ws.onmessage = (e) => {
        try { cbRef.current(JSON.parse(e.data)) } catch {}
      }

      ws.onclose = () => {
        if (!active) return   // ← no reconectar si el efecto ya se limpió
        console.info('[WS] Desconectado – reconectando en 1.5 s…')
        timer = setTimeout(connect, 1500)
      }

      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      active = false            // ← desactiva antes de cerrar
      clearTimeout(timer)
      ws?.close()
    }
  }, [url])

  return useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(msg))
  }, [])
}
