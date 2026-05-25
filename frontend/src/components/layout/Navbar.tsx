"use client"

import Link from "next/link"
import { Button } from "@/components/ui/Button"
import { Database } from "lucide-react"
import { useAuthStore } from "@/lib/store"
import { useEffect, useState } from "react"

export function Navbar() {
  const { isAuthenticated } = useAuthStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-surface-border bg-background/60 backdrop-blur-2xl" aria-label="Main navigation">
      <div className="container mx-auto px-8 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-light to-brand-dark flex items-center justify-center shadow-glow group-hover:scale-105 transition-transform duration-300">
            <Database className="w-5 h-5 text-background" />
          </div>
          <span className="text-2xl font-display font-bold tracking-tight luxury-text-gradient">AI Analyst</span>
        </Link>
        <div className="hidden md:flex items-center space-x-8">
          <Link href="/" className="text-sm font-medium text-foreground/70 hover:text-brand-light transition-colors">Home</Link>
          <Link href="/dashboard" className="text-sm font-medium text-foreground/70 hover:text-brand-light transition-colors">Dashboard</Link>
          <Link href="/#features" className="text-sm font-medium text-foreground/70 hover:text-brand-light transition-colors">Features</Link>
          <Link href="/#services" className="text-sm font-medium text-foreground/70 hover:text-brand-light transition-colors">Services</Link>
        </div>
        <div className="flex items-center space-x-4">
          {mounted && isAuthenticated ? (
            <Link href="/dashboard">
              <Button variant="brand" className="px-6">Go to Dashboard</Button>
            </Link>
          ) : mounted ? (
            <>
              <Link href="/login">
                <Button variant="ghost" className="px-6">Log in</Button>
              </Link>
              <Link href="/signup">
                <Button variant="brand" className="px-6">Get Started</Button>
              </Link>
            </>
          ) : (
            <div className="w-32 h-10" />
          )}
        </div>
      </div>
    </nav>
  )
}
