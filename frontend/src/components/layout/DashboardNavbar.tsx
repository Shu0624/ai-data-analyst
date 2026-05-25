"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, User, LogOut, Database, MessageSquare, FileText, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/lib/store"
import { logoutUser } from "@/lib/auth"

const navItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Datasets", href: "/datasets", icon: Database },
  { name: "Analysis", href: "/analysis", icon: MessageSquare },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "WhatsApp CRM", href: "/whatsapp", icon: MessageCircle },
  { name: "Profile", href: "/profile", icon: User },
]

export function DashboardNavbar() {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)

  const handleLogout = async () => {
    await logoutUser()
    router.push("/login")
  }

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-surface-border bg-background/80 backdrop-blur-xl" aria-label="Dashboard navigation">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-8 h-20 flex items-center justify-between gap-4">
        {/* Left: Logo */}
        <Link href="/dashboard" className="flex items-center space-x-3 group shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-light to-brand-dark flex items-center justify-center shadow-glow group-hover:scale-105 transition-transform duration-300">
            <Database className="w-5 h-5 text-background" />
          </div>
          <span className="text-xl font-display font-bold tracking-tight luxury-text-gradient hidden md:block">AI Analyst</span>
        </Link>

        {/* Center: Navigation Pill (Flex container instead of absolute positioning to prevent overlap) */}
        <div className="hidden lg:flex items-center space-x-1 bg-surface/[0.2] border border-surface-border p-1 rounded-full shadow-glass overflow-x-auto scrollbar-none">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center space-x-2 px-3.5 py-2 rounded-full transition-all duration-300 group shrink-0",
                  isActive
                    ? "bg-brand/15 text-brand-light shadow-sm"
                    : "text-foreground/60 hover:text-brand-light hover:bg-surface-hover"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-brand-light" : "text-foreground/50 group-hover:text-brand-light")} />
                <span className="font-medium text-sm hidden xl:inline">{item.name}</span>
                <span className="font-medium text-sm xl:hidden inline">{item.name.split(" ")[0]}</span>
              </Link>
            )
          })}
        </div>

        {/* Right: User & Logout */}
        <div className="flex items-center space-x-3 shrink-0">
          {user && (
            <span className="text-sm text-foreground/60 hidden sm:block max-w-[120px] truncate">{user.name}</span>
          )}
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className="flex items-center space-x-2 px-4 py-2 rounded-full text-foreground/60 hover:bg-red-500/10 hover:text-red-500 transition-colors group border border-transparent hover:border-red-500/20"
          >
            <LogOut className="w-4 h-4 text-foreground/50 group-hover:text-red-500" aria-hidden="true" />
            <span className="font-medium text-sm hidden sm:block">Logout</span>
          </button>
        </div>
      </div>
    </nav>
  )
}
