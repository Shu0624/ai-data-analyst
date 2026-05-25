"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { User, Shield, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { useAuthStore } from "@/lib/store"
import { api } from "@/lib/api"
import { changePassword } from "@/lib/auth"

interface FullProfile {
  id: string
  name: string
  email: string
  role: string
  created_at: string
  updated_at: string
  profile: {
    company_name: string | null
    industry: string | null
    experience_level: string | null
  } | null
}

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [changingPw, setChangingPw] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [company, setCompany] = useState("")
  const [industry, setIndustry] = useState("")
  const [experience, setExperience] = useState("")

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")

  useEffect(() => {
    api.get<FullProfile>("/users/me")
      .then((res) => {
        const p = res.data
        setName(p.name)
        setEmail(p.email)
        setCompany(p.profile?.company_name || "")
        setIndustry(p.profile?.industry || "")
        setExperience(p.profile?.experience_level || "")
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSaveProfile = async () => {
    setError("")
    setSuccess("")
    setSaving(true)

    try {
      // Update basic info
      const { data: updatedUser } = await api.put("/users/update", { name, email })

      // Update profile (company/industry)
      if (company || industry || experience) {
        await api.put("/users/profile", {
          company_name: company || null,
          industry: industry || null,
          experience_level: experience || null,
        })
      }

      // Update store
      setUser({
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        is_verified: user?.is_verified ?? true,
        created_at: updatedUser.created_at,
      })
      setSuccess("Profile saved successfully")
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { detail?: string } } })?.response
      setError(resp?.data?.detail || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setError("")
    setSuccess("")
    setChangingPw(true)

    try {
      const result = await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setSuccess(result.message)
      setCurrentPassword("")
      setNewPassword("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed")
    } finally {
      setChangingPw(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-light" />
      </div>
    )
  }

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">Account Settings</h1>
        <p className="text-foreground/60 text-lg">Manage your profile and security.</p>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          {success}
        </div>
      )}

      {/* Account Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-1 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.03]">
        <div className="p-4 rounded-xl">
          <p className="text-[10px] text-foreground/50 uppercase tracking-widest font-semibold mb-1">Role</p>
          <p className="text-lg font-bold capitalize">{user?.role || "User"}</p>
        </div>
        <div className="p-4 rounded-xl">
          <p className="text-[10px] text-foreground/50 uppercase tracking-widest font-semibold mb-1">Status</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <p className="text-lg font-bold text-emerald-400">Active</p>
          </div>
        </div>
        <div className="p-4 rounded-xl">
          <p className="text-[10px] text-foreground/50 uppercase tracking-widest font-semibold mb-1">Member Since</p>
          <p className="text-lg font-bold">{user?.created_at ? new Date(user.created_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—"}</p>
        </div>
        <div className="p-4 rounded-xl">
          <p className="text-[10px] text-foreground/50 uppercase tracking-widest font-semibold mb-1">Plan</p>
          <p className="text-lg font-bold text-brand-light">Free Tier</p>
        </div>
      </div>

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Personal Information
          </CardTitle>
          <CardDescription>Update your personal details here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center space-x-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand to-accent flex items-center justify-center text-2xl font-bold text-white shadow-glow">
              {initials}
            </div>
            <div>
              <p className="font-medium text-foreground">{name}</p>
              <p className="text-sm text-foreground/50">{email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80 pl-1">Full Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80 pl-1">Email Address</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80 pl-1">Company</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Your company" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80 pl-1">Industry</label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Technology" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80 pl-1">Experience Level</label>
              <select
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                className="w-full h-12 px-4 rounded-xl text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-brand/50 border border-surface-border cursor-pointer"
                style={{ backgroundColor: '#0d0d14' }}
              >
                <option value="" style={{ backgroundColor: '#0d0d14', color: '#999' }}>Select...</option>
                <option value="student" style={{ backgroundColor: '#0d0d14' }}>Student</option>
                <option value="beginner" style={{ backgroundColor: '#0d0d14' }}>Beginner Analyst</option>
                <option value="intermediate" style={{ backgroundColor: '#0d0d14' }}>Intermediate</option>
                <option value="professional" style={{ backgroundColor: '#0d0d14' }}>Professional Data Analyst</option>
                <option value="advanced" style={{ backgroundColor: '#0d0d14' }}>Advanced / Senior</option>
                <option value="lead" style={{ backgroundColor: '#0d0d14' }}>Team Lead</option>
              </select>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t border-surface-border/50 py-4 mt-2">
          <Button variant="brand" onClick={handleSaveProfile} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </CardFooter>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Security
          </CardTitle>
          <CardDescription>Change your password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80 pl-1">Current Password</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80 pl-1">New Password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
              <p className="text-xs text-foreground/40 pl-1">Min 8 chars, 1 uppercase, 1 number</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t border-surface-border/50 py-4 mt-2">
          <Button
            variant="outline"
            onClick={handleChangePassword}
            disabled={changingPw || !currentPassword || !newPassword}
          >
            {changingPw ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Change Password
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
