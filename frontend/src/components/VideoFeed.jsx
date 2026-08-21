import { forwardRef } from 'react'
import { motion } from 'framer-motion'

/**
 * Muestra el stream de la webcam.
 * El elemento <img> se actualiza directamente via ref (sin pasar por React state)
 * para no re-renderizar el árbol 30 veces por segundo.
 */
const VideoFeed = forwardRef(function VideoFeed({ flash, blur, contain }, imgRef) {
  return (
    <div className="absolute inset-0 bg-black flex items-center justify-center">
      {/* Feed */}
      <motion.img
        ref={imgRef}
        alt="webcam"
        style={{
          display:    'block',
          objectFit:  contain ? 'contain' : 'cover',
          width:      contain ? 'auto' : '100%',
          height:     contain ? '100%' : '100%',
          maxWidth:   '100%',
          maxHeight:  '100%',
        }}
        animate={{ filter: blur ? 'blur(10px) brightness(0.6)' : 'blur(0px) brightness(1)' }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
      />

      {/* Flash blanco al capturar */}
      <motion.div
        className="absolute inset-0 bg-white pointer-events-none"
        animate={{ opacity: flash ? 1 : 0 }}
        transition={{ duration: flash ? 0.05 : 0.3 }}
      />

      {/* Viñeta decorativa sutil */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </div>
  )
})

export default VideoFeed
