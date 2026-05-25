"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { 
  LayoutDashboard, MessageSquare, Database, User, LogOut, FileText, 
  MessageCircle, ChevronLeft, ChevronRight 
} from "lucide-react"
import { cn } from "@/lib/utils"
import { logoutUser } from "@/lib/auth"

const navItems = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Analysis", href: "/analysis", icon: MessageSquare },
  { name: "Datasets", href: "/datasets", icon: Database },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "WhatsApp CRM", href: "/whatsapp", icon: MessageCircle },
  { name: "Profile", href: "/profile", icon: User },
]


export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = async () => {
    await logoutUser()
    router.push("/login")
  }

  return (
    <aside 
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-surface-border bg-background/60 backdrop-blur-2xl flex flex-col sidebar-transition",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      {/* ── Logo & Collapse Toggle ── */}
      <div className={cn(
        "h-[72px] flex items-center border-b border-surface-border/50 shrink-0",
        collapsed ? "px-4 justify-center" : "px-6 justify-between"
      )}>
        <Link href="/dashboard" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-light to-brand-dark flex items-center justify-center shadow-glow group-hover:scale-110 transition-transform duration-300 shrink-0">
             <Database className="w-5 h-5 text-background" />
          </div>
          {!collapsed && (
            <span className="text-lg font-display font-bold tracking-tight luxury-text-gradient animate-fade-in whitespace-nowrap">
              AI Analyst
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-foreground/40 hover:text-brand-light transition-all"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Navigation Links ── */}
      <div className="flex-1 py-4 px-3 flex flex-col gap-1 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              title={item.name}
              className={cn(
                "flex items-center rounded-xl transition-all duration-200 group relative",
                collapsed ? "justify-center px-0 py-3" : "space-x-3 px-4 py-3",
                isActive
                  ? "bg-brand/15 text-brand-light shadow-[inset_0_0_20px_rgba(212,168,83,0.08)]"
                  : "text-foreground/60 hover:bg-surface-hover hover:text-brand-light"
              )}
            >
              {/* Active indicator bar */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-brand-light rounded-r-full" />
              )}
              <item.icon className={cn(
                "w-5 h-5 shrink-0 transition-colors", 
                isActive ? "text-brand-light" : "text-foreground/50 group-hover:text-brand-light"
              )} />
              {!collapsed && (
                <span className="font-medium text-sm animate-fade-in whitespace-nowrap">{item.name}</span>
              )}
            </Link>
          )
        })}
      </div>

      {/* ── Bottom Section ── */}
      <div className="p-3 border-t border-surface-border/50 space-y-1">
        {/* Expand button when collapsed */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="w-full flex items-center justify-center py-3 rounded-xl text-foreground/40 hover:bg-surface-hover hover:text-brand-light transition-colors"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
        <button 
          onClick={handleLogout}
          className={cn(
            "flex items-center w-full rounded-xl text-foreground/60 hover:bg-red-500/10 hover:text-red-500 transition-colors group",
            collapsed ? "justify-center px-0 py-3" : "space-x-3 px-4 py-3"
          )}
          title="Logout"
        >
          <LogOut className="w-5 h-5 text-foreground/50 group-hover:text-red-500 shrink-0" />
          {!collapsed && <span className="font-medium text-sm animate-fade-in">Logout</span>}
        </button>
      </div>
    </aside>
  )
}
