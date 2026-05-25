"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Mail, Lock, User, ArrowRight, Loader2, AlertCircle } from "lucide-react"
import { signupUser } from "@/lib/auth"

export default function SignupPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      await signupUser({ name, email, password })
      // Redirect to OTP verification page
      router.push(`/verify-email?email=${encodeURIComponent(email)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="animate-slide-up" style={{ animationDuration: "0.6s" }}>
        <Card className="border-t-brand/50 shadow-glow mt-8 mx-auto w-full max-w-[440px]">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-3xl font-display font-bold tracking-tight mb-2 text-foreground">Create Account</CardTitle>
            <CardDescription className="text-base text-foreground/50">
              Join forward-thinking analysts and startups today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="flex items-center gap-3 p-4 mb-5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}
            <form onSubmit={handleSignup} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/70 pl-1" htmlFor="name">Full Name</label>
                <div className="relative group">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40 group-focus-within:text-brand-light transition-colors pointer-events-none" />
                  <Input 
                    id="name" 
                    type="text" 
                    placeholder="Enter your name" 
                    className="pl-12 h-14 bg-surface/[0.5] text-base border-surface-border text-foreground placeholder:text-foreground/30 focus-visible:bg-surface/[0.8] focus-visible:border-brand-light focus-visible:ring-brand-light" 
                    required 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/70 pl-1" htmlFor="email">Work Email</label>
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
                <label className="text-sm font-medium text-foreground/70 pl-1" htmlFor="password">Password</label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40 group-focus-within:text-brand-light transition-colors pointer-events-none" />
                  <Input 
                    id="password" 
                    type="password" 
                    placeholder="••••••••" 
                    className="pl-12 h-14 bg-surface/[0.5] text-base border-surface-border text-foreground placeholder:text-foreground/30 focus-visible:bg-surface/[0.8] focus-visible:border-brand-light focus-visible:ring-brand-light" 
                    required 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <p className="text-xs text-foreground/40 pl-1">Min 8 chars, 1 uppercase, 1 number</p>
              </div>

              <Button type="submit" variant="brand" className="w-full h-14 text-lg mt-6 group" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <>
                    Sign Up Free
                    <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex justify-center pt-2 pb-8 border-t border-surface-border/50 mt-6">
            <p className="text-foreground/60 text-base mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-brand font-semibold hover:text-brand-light transition-colors">
                Log in instead
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </AuthLayout>
  )
}
