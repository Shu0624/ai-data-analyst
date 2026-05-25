"use client"

import React, { useState, useRef } from "react"
import { cn } from "@/lib/utils"

interface GlowCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  glowColor?: string
  radialRadius?: number
}

export function GlowCard({
  children,
  className,
  glowColor = "rgba(212, 168, 83, 0.06)", // Soft gold default
  radialRadius = 300,
  ...props
}: GlowCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const [opacity, setOpacity] = useState(0)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={cn(
        "relative overflow-hidden rounded-3xl bg-surface/[0.01] border border-surface-border transition-all duration-300 shadow-glass",
        className
      )}
      {...props}
    >
      {/* Background radial spotlight glow */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300 z-0"
        style={{
          opacity,
          background: `radial-gradient(${radialRadius}px circle at ${coords.x}px ${coords.y}px, ${glowColor}, transparent 80%)`
        }}
      />

      {/* Content wrapper */}
      <div className="relative z-10 w-full h-full">
        {children}
      </div>
    </div>
  )
}
