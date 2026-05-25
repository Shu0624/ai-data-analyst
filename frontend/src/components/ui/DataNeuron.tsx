"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"

export function DataNeuron() {
  const [mounted, setMounted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  
  useEffect(() => {
    setMounted(true)
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.6 // Slow down for premium feel
    }
  }, [])

  if (!mounted) return null

  return (
    <div className="relative w-full aspect-square max-w-[800px] flex items-center justify-center" aria-hidden="true" role="presentation">
      {/* Ambient glow matching the deep space tech theme behind the video */}
      <div className="absolute w-[50%] h-[50%] bg-[#0B48A1] rounded-full blur-[100px] opacity-60 animate-pulse pointer-events-none" />
      <div className="absolute w-[30%] h-[30%] bg-cyan-400/50 rounded-full blur-[80px] opacity-30 mix-blend-screen pointer-events-none" />
      
      {/* Video Container - using the generated 360 vertical rotation MP4 */}
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
        
        <motion.div 
          className="relative w-[130%] h-[130%] flex items-center justify-center drop-shadow-[0_0_50px_rgba(59,130,246,0.2)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5 }}
        >
          {/* Smooth, continuous 360-degree rotation on the vertical axis. Seamless loop. */}
          <video
            ref={videoRef}
            autoPlay
            loop
            muted
            playsInline
            controls={false}
            className="w-full h-full object-cover mix-blend-screen mix-blend-lighten opacity-90"
            style={{ 
              WebkitMaskImage: 'radial-gradient(circle at center, rgba(0,0,0,1) 20%, rgba(0,0,0,0) 65%)',
              maskImage: 'radial-gradient(circle at center, rgba(0,0,0,1) 20%, rgba(0,0,0,0) 65%)'
            }}
          >
            <source src="/Glowing_blue_sphere_202603191454.mp4" type="video/mp4" />
          </video>
        </motion.div>
      </div>

    </div>
  )
}
