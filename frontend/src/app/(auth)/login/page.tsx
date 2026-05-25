"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Mail, Lock, ArrowRight, Loader2, AlertCircle } from "lucide-react"
import { loginUser, devLoginUser } from "@/lib/auth"

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isDevLoading, setIsDevLoading] = useState(false)
  const [error, setError] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      await loginUser({ email, password })
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setIsLoading(false)
    }
  }

  const handleDevLogin = async () => {
    setError("")
    setIsDevLoading(true)
    try {
      await devLoginUser()
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dev login failed")
    } finally {
      setIsDevLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="animate-slide-up" style={{ animationDuration: "0.6s" }}>
        <Card className="border-t-brand/50 shadow-glow mx-auto w-full max-w-[440px]">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-3xl font-display font-bold tracking-tight mb-2 text-foreground">Welcome back</CardTitle>
            <CardDescription className="text-base text-foreground/50">
              Sign in to your AI Data Analyst account
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="flex items-center gap-3 p-4 mb-5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/70 pl-1" htmlFor="email">Email Address</label>
                <div className="relative group">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40 group-focus-within:text-brand-light transition-colors pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your gmail"
                    className="pl-12 h-14 bg-surface/[0.5] text-base border-surface-border text-foreground placeholder:text-foreground/30 focus-visible:bg-surface/[0.8] focus-visible:border-brand-light focus-visible:ring-brand-light"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between pl-1">
                  <label className="text-sm font-medium text-foreground/70" htmlFor="password">Password</label>
                  <Link href="/forgot-password" className="text-sm text-brand-light hover:text-brand transition-colors font-medium">Forgot password?</Link>
                </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40 group-focus-within:text-brand-light transition-colors pointer-events-none" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    className="pl-12 h-14 bg-surface/[0.5] text-base border-surface-border text-foreground placeholder:text-foreground/30 focus-visible:bg-surface/[0.8] focus-visible:border-brand-light focus-visible:ring-brand-light"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <Button type="submit" variant="brand" className="w-full h-14 text-lg mt-6 group" disabled={isLoading || isDevLoading}>
                {isLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleDevLogin}
                className="w-full h-14 text-lg mt-3 border-dashed border-brand/40 text-brand-light hover:bg-brand/10"
                disabled={isLoading || isDevLoading}
              >
                {isDevLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  "Quick Demo / Dev Login"
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex justify-center pt-2 pb-8 border-t border-white/5 mt-6">
            <p className="text-foreground/60 text-base mt-6">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-brand font-semibold hover:text-brand-light transition-colors">
                Create one now
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </AuthLayout>
  )
}
