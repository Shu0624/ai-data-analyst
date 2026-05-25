/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Navbar } from "@/components/layout/Navbar"
import { Button } from "@/components/ui/Button"
import Link from "next/link"
import { Database, Zap, Lock, BarChart3, ArrowRight, BrainCircuit, MessageSquare, FileText, Lightbulb, TrendingUp } from "lucide-react"
import { DataNeuron } from "@/components/ui/DataNeuron"

export default function Home() {
  return (
    <div className="min-h-screen bg-background relative selection:bg-brand selection:text-white">
      <Navbar />

      {/* Main content landmark for skip-nav accessibility */}
      <main id="main-content">

        {/* Hero Section */}
        <section className="relative pt-32 pb-20 md:pt-40 md:pb-32 px-6 overflow-hidden min-h-[90vh] flex items-center bg-background">

          {/* Anti-Gravity Cinematic Background Video (Flowing Yellow Waves) */}
          <video
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover z-0 opacity-100 pointer-events-none transform scale-[1.05]"
          >
            <source src="/Glowing_light_waves_202603191823.mp4" type="video/mp4" />
          </video>

          {/* Subtle radial shadow strictly for text readability, keeping the video crystal clear */}
          <div className="absolute inset-y-0 left-0 w-full md:w-[60%] bg-[radial-gradient(ellipse_at_left,rgba(6,6,10,0.85)_0%,transparent_80%)] z-0 pointer-events-none" />

          {/* Ambient Lights - Warm Gold */}
          <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[800px] h-[800px] bg-brand/10 blur-[150px] rounded-[100%] pointer-events-none opacity-40 z-0" />

          <div className="container mx-auto max-w-7xl relative z-10 h-full flex items-center justify-start">

            {/* Left Column: AI Analysis Copy (Luxury minimalism) */}
            <div className="relative z-10 flex flex-col items-start text-left w-full max-w-4xl px-4 md:px-0">

              <h1 className="text-5xl md:text-6xl lg:text-[5.5rem] font-display font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-brand-light mb-8 leading-[1.05] animate-slide-up drop-shadow-2xl">
                Talk to your data.<br />
                Get real answers.
              </h1>

              <p className="text-xl md:text-2xl text-white/70 max-w-2xl leading-relaxed font-light animate-fade-in drop-shadow-lg" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
                Stop wrestling with complex SQL and pivot tables. Upload your dataset and get instant charts, statistical analysis, and insights just by asking questions in plain English.
              </p>

            </div>
          </div>
        </section>
        {/* Start Analysis CTA */}
        {/* Start Analysis CTA — moderate spacing (transitional section) */}
        <section className="relative py-16 md:py-20 px-6 bg-gradient-to-b from-surface/[0.02] to-transparent bg-[#000511]">
          <div className="container mx-auto max-w-6xl">
            <div className="glass-panel p-12 md:p-20 rounded-[3rem] border-brand/20 shadow-glass relative overflow-hidden group flex flex-col md:flex-row items-center gap-12">

              <div className="absolute inset-0 bg-brand/5 group-hover:bg-brand/10 transition-colors duration-700 z-0" />

              {/* Left Side: Small Neural Network */}
              <div className="relative z-10 w-full md:w-1/3 flex justify-center md:justify-start">
                <div className="w-48 h-48 sm:w-56 sm:h-56 mix-blend-screen opacity-90 scale-125 md:scale-150 transform origin-center">
                  <DataNeuron />
                </div>
              </div>

              {/* Right Side: Copy & Button */}
              <div className="relative z-10 flex flex-col items-start text-left w-full md:w-2/3">
                <div className="w-16 h-16 rounded-2xl bg-primary-gradient flex items-center justify-center mb-6 shadow-glow-lg border border-brand/30">
                  <BarChart3 className="w-8 h-8 text-background" />
                </div>
                <h2 className="text-4xl md:text-5xl font-display font-bold mb-4 tracking-tight">Ready to map your data?</h2>
                <p className="text-xl text-foreground/70 mb-8 max-w-2xl">
                  Jump straight into the dashboard, upload a dataset, and let our AI generate professional graphs, pie charts, and deep insights instantly.
                </p>
                <Link href="/dashboard">
                  <Button variant="brand" size="lg" className="h-14 px-10 text-lg font-bold shadow-[0_0_30px_rgba(212,168,83,0.3)] hover:shadow-[0_0_50px_rgba(212,168,83,0.5)] hover:scale-105 transition-all duration-300">
                    Build Analysis Now
                    <ArrowRight className="w-5 h-5 ml-3" />
                  </Button>
                </Link>
              </div>

            </div>
          </div>
        </section>

        {/* Features Section */}
        {/* Features — slightly less padding than hero (supporting content) */}
        <section id="features" className="py-20 md:py-24 relative">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-surface-border to-transparent" />
          <div className="container mx-auto px-6 max-w-6xl relative z-10">
            <div className="text-center mb-20 animate-fade-in">
              <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 tracking-tight luxury-text-gradient inline-block">Intelligent Features</h2>
              <p className="text-foreground/60 max-w-2xl mx-auto text-xl">Everything you need to turn raw data into strategic advantage.</p>
            </div>

            <div className="grid md:grid-cols-4 gap-8">
              <FeatureCard
                icon={<Lightbulb className="w-7 h-7 text-brand-light" />}
                title="AI Insights"
                description="Automatically uncover hidden trends, anomalies, and critical business metrics."
                delay="100ms"
              />
              <FeatureCard
                icon={<TrendingUp className="w-7 h-7 text-accent-light" />}
                title="Predictive Analytics"
                description="Forecast future outcomes and model scenarios using state-of-the-art algorithms."
                delay="200ms"
              />
              <FeatureCard
                icon={<MessageSquare className="w-7 h-7 text-green-400" />}
                title="Natural Language Queries"
                description="Talk to your data like a human. No SQL required to extract perfect answers."
                delay="300ms"
              />
              <FeatureCard
                icon={<FileText className="w-7 h-7 text-orange-400" />}
                title="Automated Reports"
                description="Generate stunning, comprehensive data reports with a single click."
                delay="400ms"
              />
            </div>
          </div>
        </section>

        {/* How It Works (AI Pipeline) */}
        {/* How It Works — medium spacing (educational content, not primary CTA) */}
        <section id="how-it-works" className="py-20 md:py-28 relative bg-surface/[0.02] border-t border-surface-border/50">
          <div className="container mx-auto px-6 max-w-5xl relative z-10">
            <div className="text-center mb-24 animate-fade-in">
              <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 tracking-tight">How it Works</h2>
              <p className="text-foreground/60 max-w-2xl mx-auto text-xl">A seamless, fully automated AI pipeline.</p>
            </div>

            <div className="relative">
              {/* Connecting Line */}
              <div className="hidden md:block absolute top-[45px] left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-brand/10 via-brand-light to-accent-light opacity-30" />

              <div className="grid grid-cols-1 md:grid-cols-4 gap-12 text-center relative z-10">
                {/* Step 1 */}
                <div className="flex flex-col items-center group">
                  <div className="w-24 h-24 rounded-[2rem] bg-background border-2 border-surface-border flex items-center justify-center mb-6 group-hover:border-brand-light transition-colors transform group-hover:scale-105 duration-500 shadow-glass">
                    <Database className="w-10 h-10 text-brand-light" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">1. Upload Data</h3>
                  <p className="text-foreground/50 text-sm">Drop your CSV or Excel safely into our secure vault.</p>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col items-center group">
                  <div className="w-24 h-24 rounded-[2rem] bg-background border-2 border-surface-border flex items-center justify-center mb-6 group-hover:border-accent-light transition-colors transform group-hover:scale-105 duration-500 shadow-glass">
                    <BrainCircuit className="w-10 h-10 text-accent-light" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">2. AI Processing</h3>
                  <p className="text-foreground/50 text-sm">Our models parse schema and execute smart SQL.</p>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col items-center group">
                  <div className="w-24 h-24 rounded-[2rem] bg-background border-2 border-surface-border flex items-center justify-center mb-6 group-hover:border-green-400 transition-colors transform group-hover:scale-105 duration-500 shadow-glass">
                    <Lightbulb className="w-10 h-10 text-green-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">3. Insights Generated</h3>
                  <p className="text-foreground/50 text-sm">Detect anomalies, trends, and business KPIs automatically.</p>
                </div>

                {/* Step 4 */}
                <div className="flex flex-col items-center group">
                  <div className="w-24 h-24 rounded-[2rem] bg-background border-2 border-surface-border flex items-center justify-center mb-6 group-hover:border-orange-400 transition-colors transform group-hover:scale-105 duration-500 shadow-glass">
                    <BarChart3 className="w-10 h-10 text-orange-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">4. Visualizations</h3>
                  <p className="text-foreground/50 text-sm">Beautifully rendered charts ready for boardroom presentation.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Services Section */}
        {/* Services — same rhythm as features (parallel content sections) */}
        <section id="services" className="py-20 md:py-24 relative bg-background border-t border-surface-border/50">
          <div className="container mx-auto px-6 max-w-6xl relative z-10">
            <div className="text-center mb-20">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Professional Services</h2>
              <p className="text-foreground/60 max-w-2xl mx-auto text-xl">Beyond software. We provide world-class analytics consulting.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="glass-panel p-10 rounded-3xl border-brand/20 hover:border-brand/50 transition-colors duration-300">
                <h3 className="text-2xl font-bold mb-4 text-brand-light">Data Strategy</h3>
                <p className="text-foreground/70 leading-relaxed">Establish a foundational data strategy tailored to your business goals. We help you map your entire data ecosystem.</p>
              </div>
              <div className="glass-panel p-10 rounded-3xl border-brand/20 hover:border-brand/50 transition-colors duration-300">
                <h3 className="text-2xl font-bold mb-4 text-brand-light">Custom Integrations</h3>
                <p className="text-foreground/70 leading-relaxed">Connect our AI engine directly to your enterprise data warehouses, CRMs, and internal, proprietary APIs.</p>
              </div>
              <div className="glass-panel p-10 rounded-3xl border-brand/20 hover:border-brand/50 transition-colors duration-300">
                <h3 className="text-2xl font-bold mb-4 text-brand-light">Dedicated Analysts</h3>
                <p className="text-foreground/70 leading-relaxed">Hire our experts to proactively monitor your metrics, maintain pipelines, and deliver weekly strategic reports.</p>
              </div>
            </div>
          </div>
        </section>
        {/* Final CTA — clean, direct, no fluff */}
        <section className="py-32 md:py-40 relative overflow-hidden bg-surface/[0.02]">
          <div className="absolute inset-0 bg-brand/5" aria-hidden="true" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-[400px] bg-brand/15 blur-[180px] rounded-[100%] pointer-events-none" aria-hidden="true" />
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-surface-border to-transparent" aria-hidden="true" />

          <div className="container mx-auto px-6 max-w-4xl relative z-10 text-center animate-slide-up">
            <h2 className="text-5xl md:text-7xl font-display font-bold tracking-tight mb-6 leading-tight">
              Let&apos;s Get Started
            </h2>
            <p className="text-xl text-foreground/50 mb-12 max-w-xl mx-auto">
              Upload your first dataset and see insights in seconds.
            </p>
            <Link href="/signup">
              <Button variant="brand" size="lg" className="h-16 px-12 text-xl font-bold shadow-[0_0_40px_rgba(212,168,83,0.4)] hover:shadow-[0_0_60px_rgba(212,168,83,0.6)] transition-all duration-500 hover:scale-105">
                Start Free
                <ArrowRight className="w-6 h-6 ml-3" />
              </Button>
            </Link>
          </div>
        </section>

      </main>

      <footer className="py-10 border-t border-surface-border text-center text-foreground/40 text-sm" role="contentinfo">
        <p>&copy; {new Date().getFullYear()} AI Analyst Platform. All rights reserved.</p>
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description, delay }: { icon: React.ReactNode, title: string, description: string, delay: string }) {
  return (
    <div className="glass-panel p-10 rounded-[2rem] group hover:border-brand/40 transition-colors duration-500 animate-slide-up" style={{ animationDelay: delay, animationFillMode: "both" }}>
      <div className="w-16 h-16 rounded-2xl bg-[#06060A] mb-8 flex items-center justify-center border border-surface-border group-hover:bg-brand/10 group-hover:border-brand/30 transition-colors duration-500 shadow-sm">
        {icon}
      </div>
      <h3 className="text-2xl font-display font-bold text-white mb-4 tracking-tight">{title}</h3>
      <p className="text-foreground/70 leading-relaxed text-lg">
        {description}
      </p>
    </div>
  )
}
