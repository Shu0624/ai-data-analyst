"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { useState, useEffect, useRef, useCallback, useId } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import {
  UploadCloud, Database, Sparkles, Send, MessageSquare,
  Loader2, CheckCircle2, ScanSearch, Cpu, BrainCircuit,
  BarChart3, PieChart as PieChartIcon, TrendingUp, Lightbulb,
  ArrowRight, FileSpreadsheet, X, User, Trash2, Maximize2, Minimize2,
  Globe, Zap, Target, Activity
} from "lucide-react"
import { useAuthStore } from "@/lib/store"
import { api } from "@/lib/api"
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { ProfessionalDashboard } from "@/components/ProfessionalDashboard"
// ── Types ─────────────────────────────────────────────────────

interface DatasetOption {
  id: string
  dataset_name: string
  dataset_type: string
  created_at: string
}

interface AnalysisResult {
  query_id: string
  user_query: string
  generated_sql: string | null
  sql_valid: boolean
  execution_time_ms: number | null
  result?: { result_row_count: number | null; result_preview: Record<string, unknown>[] | null } | null
  visualizations?: { chart_type: string; chart_config: Record<string, unknown> }[]
  insights: { insight_text: string; importance_score: number | null }[]
  recommendations: { recommendation_text: string; confidence_score: number | null }[]
  confidence_score: number | null
  generated_code: string | null
  code_output: string | null
  final_answer: string | null
  explanation: string | null
  
  // Backwards compatibility with AgentResponse structure from streaming endpoint
  row_count?: number
  result_preview?: Record<string, unknown>[]
  chart_config?: { type: string; data: any; options?: any } | null
}

interface ChatMessage {
  role: string
  content: string
  analysis?: AnalysisResult
}

interface DataProfile {
  rows: number
  columns: {
    name: string
    dtype: string
    null_count: number
    null_pct: number
    unique_count: number
    top_values?: { value: string; count: number }[]
    stats?: {
      mean: number
      median: number
      min: number
      max: number
      std: number
      p25: number
      p75: number
      skewness?: number
      skew_direction?: string
    }
  }[]
  correlations?: {
    col1: string
    col2: string
    correlation: number
    strength: string
  }[]
}

// ── Pipeline Steps Config ─────────────────────────────────────

const PIPELINE_STEPS = [
  { icon: ScanSearch, label: "Scanning data schema…", duration: 1200 },
  { icon: Cpu, label: "Processing columns & types…", duration: 1000 },
  { icon: BrainCircuit, label: "AI Agent generating insights…", duration: 1500 },
  { icon: BarChart3, label: "Building visualizations…", duration: 800 },
]

const CHART_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"]

// ── Chart Styles Constants (Fix for infinite render loop) ────
const CHART_TICK_STYLE = { fill: "#ffffff60", fontSize: 11 }
const CHART_MARGINS = { top: 10, right: 10, left: -20, bottom: 0 }
const TOOLTIP_STYLE = { backgroundColor: "#0a0a0a", border: "1px solid #333", borderRadius: "12px" }

// ── Main Component ────────────────────────────────────────────

// ── Typewriter Markdown ───────────────────────────────────────
function TypewriterMarkdown({ content }: { content: string }) {
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    let index = 0
    setDisplayed("")
    const interval = setInterval(() => {
      index += 3 // Reveal 3 characters per tick for fluid speed
      if (index >= content.length) {
        setDisplayed(content)
        clearInterval(interval)
      } else {
        setDisplayed(content.slice(0, index))
      }
    }, 15)
    return () => clearInterval(interval)
  }, [content])

  return (
    <div className="prose prose-invert prose-sm max-w-none 
      prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent
      prose-td:border prose-td:border-surface-border prose-th:border prose-th:border-surface-border
      prose-a:text-brand-light hover:prose-a:text-brand transition-colors">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "")
            return !inline && match ? (
              <SyntaxHighlighter
                style={vscDarkPlus as any}
                language={match[1]}
                PreTag="div"
                className="rounded-lg border border-surface-border my-2 !bg-[#06060A] text-sm"
                {...props}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            ) : (
              <code className={`${className || ""} bg-surface-border/50 px-1.5 py-0.5 rounded text-brand-light`} {...props}>
                {children}
              </code>
            )
          }
        }}
      >
        {displayed}
      </ReactMarkdown>
    </div>
  )
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const firstName = user?.name?.split(" ")[0] || "there"

  // ── State ────────────────────────────
  const [summary, setSummary] = useState<{ total_datasets: number; total_sessions: number; total_queries: number } | null>(null)
  const [datasets, setDatasets] = useState<DatasetOption[]>([])
  const [selectedDataset, setSelectedDataset] = useState<string>("")
  const [uploading, setUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState("")

  const [analysisStep, setAnalysisStep] = useState(-1) // -1 = not started
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analysisError, setAnalysisError] = useState("")

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [chatLoading, setChatLoading] = useState(false)

  const [dataProfile, setDataProfile] = useState<DataProfile | null>(null)
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [showOverview, setShowOverview] = useState(false)
  const [isFullscreenChat, setIsFullscreenChat] = useState(false)

  const [userQuery, setUserQuery] = useState("")

  const [progressStatus, setProgressStatus] = useState("")

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // ── Load dashboard data on mount ────
  useEffect(() => {
    api.get("/datasets/").then((r) => setDatasets(r.data)).catch(() => {})
    api.get("/users/dashboard-summary").then((r) => setSummary(r.data)).catch(() => {})
  }, [])

  // ── Auto-scroll chat ────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // ── Upload handler ──────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadSuccess("")
    const formData = new FormData()
    formData.append("file", file)
    formData.append("dataset_name", file.name.replace(/\.[^/.]+$/, ""))
    try {
      const { data } = await api.post("/datasets/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      setUploadSuccess(`"${file.name}" uploaded!`)
      const refreshed = await api.get("/datasets/")
      setDatasets(refreshed.data)
      
      // Auto-select and show profile
      if (data.dataset_id) {
        setSelectedDataset(data.dataset_id)
        if (data.profile) {
          const profileKey = Object.keys(data.profile)[0]
          setDataProfile(data.profile[profileKey])
          setSuggestedQuestions(data.suggested_questions || [])
          setShowOverview(true)
        }
      }
    } catch {
      setAnalysisError("Upload failed. Please try again.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // ── Dataset selector ────────────────
  const handleSelectDataset = async (id: string) => {
    setSelectedDataset(id)
    setAnalysisResult(null)
    setAnalysisStep(-1)
    setShowOverview(false)
    setDataProfile(null)
    setSuggestedQuestions([])

    try {
      const { data } = await api.get(`/datasets/${id}/profile`)
      if (data.profile) {
        const profileKey = Object.keys(data.profile)[0]
        setDataProfile(data.profile[profileKey])
        setSuggestedQuestions(data.suggested_questions || [])
        setShowOverview(true)
      }
    } catch {
      // Profile not available or error — just continue without overview
    }
  }

  // ── Dataset delete ──────────────────
  const handleDeleteDataset = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation() // Prevent selecting the dataset while clicking delete
    if (!confirm("Are you sure you want to delete this dataset? This cannot be undone.")) return

    try {
      await api.delete(`/datasets/${id}`)
      // Refresh the dataset list
      const refreshed = await api.get("/datasets/")
      setDatasets(refreshed.data)
      
      // If the deleted dataset was selected, clear selection
      if (selectedDataset === id) {
        setSelectedDataset("")
        setAnalysisResult(null)
        setAnalysisStep(-1)
        setShowOverview(false)
        setDataProfile(null)
        setSuggestedQuestions([])
      }
    } catch {
      alert("Failed to delete dataset. Please try again.")
    }
  }

  // ── Run Analysis Pipeline (SSE Version) ─────────────
  const runAnalysis = useCallback(async (overrideQuery?: string, isFollowUp = false) => {
    const q = (overrideQuery || userQuery).trim()
    
    if (!selectedDataset) {
      setAnalysisError("Please select a dataset first.")
      return
    }

    const finalQuery = q || "Summarize this dataset and show key trends"
    if (!isFollowUp) {
      if (q) setUserQuery(q)
      else setUserQuery(finalQuery)
    }

    // Reset states
    setAnalysisResult(null)
    setAnalysisError("")
    setProgressStatus("Initializing...")
    setAnalysisStep(0)
    
    if (!isFollowUp) {
      setMessages([{ role: "user", content: finalQuery }])
      setShowOverview(false)
    } else {
      setMessages(p => [...p, { role: "user", content: finalQuery }])
      setChatLoading(true)
    }

    try {
      let currentSessionId = sessionId
      
      // 1. Create session if missing
      if (!currentSessionId) {
        const ds = datasets.find((d) => d.id === selectedDataset)
        setProgressStatus("Creating analysis session...")
        const { data: session } = await api.post("/chat/sessions", {
          dataset_id: selectedDataset,
          session_name: `Analysis: ${ds?.dataset_name || "Dataset"}`,
        })
        currentSessionId = session.id
        setSessionId(session.id)
      }

      // 2. Start SSE Stream
      const token = useAuthStore.getState().token
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/ai/agent/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          dataset_id: selectedDataset,
          user_query: finalQuery,
          session_id: currentSessionId
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No reader available")

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.split("event: ")[1].split("\n")[0]
            const dataLine = line.split("data: ")[1]
            if (!dataLine) continue

            try {
              const payload = JSON.parse(dataLine)

              if (eventType === "progress") {
                setProgressStatus(payload.status)
                // Map node names to step indices (heuristic)
                const nodeMap: Record<string, number> = {
                  "router": 0,
                  "schema_selector": 1,
                  "generate_sql": 2,
                  "execute_sql": 2,
                  "generate_python": 2,
                  "execute_python": 2,
                  "insights": 3,
                  "recommendations": 3,
                  "chart": 3
                }
                if (payload.node in nodeMap) {
                  setAnalysisStep(nodeMap[payload.node])
                }
              } else if (eventType === "complete") {
                const result = payload as any
                setAnalysisResult(result)
                setAnalysisStep(PIPELINE_STEPS.length)
                
                // Set session ID from results if not already set
                // (Backend returns it in the final payload or we can fetch it)
                
                // Build a rich ChatGPT-style summary
                const rowCount = result.row_count ?? result.result?.result_row_count ?? 0
                const insightTexts = (result.insights || []).map((i: any) => i.text || i.insight_text || "").filter(Boolean)
                const recs = (result.recommendations || []).map((r: any) => r.text || r.recommendation_text || "").filter(Boolean)
                const confidence = result.confidence_score != null ? Math.round(result.confidence_score * 100) : null
                
                const today = new Date().toLocaleDateString("en-GB")
                const topicName = result.user_query || (q ? q.substring(0, 60) + "..." : "Data Intelligence Report")
                
                let summaryContent = ""
                summaryContent += `**${topicName}**\n\n`
                
                let introText = result.final_answer || result.explanation || ""
                if (!introText) {
                  introText = `Analysis complete. Processed **${rowCount} rows** and generated insights below.`
                }
                summaryContent += introText + "\n\n"
                
                if (result.generated_sql) {
                  summaryContent += `\`\`\`sql\n${result.generated_sql}\n\`\`\`\n\n`
                }
                
                if (insightTexts.length > 0) {
                  summaryContent += `**Key Findings (${insightTexts.length}):**\n`
                  insightTexts.forEach((t: string, i: number) => {
                    summaryContent += `${i + 1}. ${t}\n`
                  })
                  summaryContent += "\n"
                }
                
                if (recs.length > 0) {
                  summaryContent += `**Strategic Recommendations (${recs.length}):**\n`
                  recs.forEach((t: string, i: number) => {
                    summaryContent += `${i + 1}. ${t}\n`
                  })
                  summaryContent += "\n"
                }

                const followups = result.followup_questions || result.follow_up_questions || []
                if (followups.length > 0) {
                  summaryContent += `**Follow-up Questions:**\n`
                  followups.forEach((q: string) => {
                    summaryContent += `• ${q}\n`
                  })
                }

                setMessages(p => [...p, {
                  role: "assistant",
                  content: summaryContent,
                  analysis: result
                }])

                if (isFollowUp) setChatLoading(false)

                setTimeout(() => {
                  resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }, 300)
              } else if (eventType === "error") {
                setAnalysisError(payload.error || "An error occurred during analysis.")
                setAnalysisStep(-1)
                if (isFollowUp) setChatLoading(false)
              }
            } catch (e) {
              console.error("Error parsing SSE data", e)
            }
          }
        }
      }
    } catch (err: any) {
      setAnalysisError(err.message || "Analysis failed. Please try again.")
      setAnalysisStep(-1)
      if (isFollowUp) setChatLoading(false)
    }
  }, [selectedDataset, userQuery, sessionId, datasets])

  // ── Send chat message ───────────────
  const handleChatSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    const msg = chatInput.trim()
    setChatInput("")
    
    // Call the full data pipeline so every chat message can generate charts
    await runAnalysis(msg, true)
  }

  // ── Suggested queries ───────────────
  const suggestedQueries = [
    "Show me the overall trends",
    "What are the top 5 categories?",
    "Compare metrics across segments",
    "Find any anomalies in the data",
  ]

  // ── Render ──────────────────────────

  const hasResults = analysisStep >= PIPELINE_STEPS.length && analysisResult

  return (
    <div className="space-y-10 animate-fade-in pb-20">

      {/* ═══ HEADER ═══ */}
      <div>
        <h1 className="text-4xl font-display font-bold tracking-tight mb-2">
          Welcome back, {firstName} 👋
        </h1>
        <p className="text-foreground/60 text-lg">Here&apos;s your data intelligence overview.</p>
      </div>

      {/* ═══ DASHBOARD STATS ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="group p-6 rounded-2xl border border-surface-border bg-surface/[0.02] hover:border-brand/30 transition-all duration-300 hover:shadow-[0_0_30px_rgba(212,168,83,0.08)]">
          <div className="flex justify-between items-start mb-4">
            <p className="text-foreground/60 font-medium text-sm">Total Datasets</p>
            <div className="w-11 h-11 rounded-xl bg-surface flex items-center justify-center border border-surface-border group-hover:bg-brand/10 group-hover:border-brand/20 transition-colors">
              <Database className="w-5 h-5 text-brand-light" />
            </div>
          </div>
          <h3 className="text-4xl font-bold tracking-tight">{summary?.total_datasets ?? datasets.length}</h3>
          <p className="text-xs text-foreground/30 mt-1">Active intelligence sources</p>
        </div>
        <div className="group p-6 rounded-2xl border border-surface-border bg-surface/[0.02] hover:border-cyan-500/30 transition-all duration-300 hover:shadow-[0_0_30px_rgba(6,182,212,0.08)]">
          <div className="flex justify-between items-start mb-4">
            <p className="text-foreground/60 font-medium text-sm">Chat Sessions</p>
            <div className="w-11 h-11 rounded-xl bg-surface flex items-center justify-center border border-surface-border group-hover:bg-cyan-500/10 group-hover:border-cyan-500/20 transition-colors">
              <MessageSquare className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <h3 className="text-4xl font-bold tracking-tight">{summary?.total_sessions ?? 0}</h3>
          <p className="text-xs text-foreground/30 mt-1">Analysis conversations</p>
        </div>
        <div className="group p-6 rounded-2xl border border-surface-border bg-surface/[0.02] hover:border-emerald-500/30 transition-all duration-300 hover:shadow-[0_0_30px_rgba(16,185,129,0.08)]">
          <div className="flex justify-between items-start mb-4">
            <p className="text-foreground/60 font-medium text-sm">AI Queries</p>
            <div className="w-11 h-11 rounded-xl bg-surface flex items-center justify-center border border-surface-border group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 transition-colors">
              <BarChart3 className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <h3 className="text-4xl font-bold tracking-tight">{summary?.total_queries ?? 0}</h3>
          <p className="text-xs text-foreground/30 mt-1">Data intelligence reports</p>
        </div>
      </div>

      {/* ═══ DIVIDER ═══ */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-surface-border/50" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-4 text-sm text-foreground/40 font-medium">Analysis Workspace</span>
        </div>
      </div>

      {/* ═══ STEP 1: UPLOAD & SELECT ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Upload Zone */}
        <Card className="lg:col-span-1 border-dashed border-2 border-surface-border hover:border-brand/40 transition-colors group cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="p-8 flex flex-col items-center justify-center text-center min-h-[200px]">
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleUpload} />
            {uploading ? (
              <Loader2 className="w-10 h-10 text-brand-light animate-spin mb-4" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center mb-4 group-hover:bg-brand/20 transition-colors">
                <UploadCloud className="w-8 h-8 text-brand-light" />
              </div>
            )}
            <h3 className="text-lg font-semibold mb-1">{uploading ? "Uploading…" : "Upload Dataset"}</h3>
            <p className="text-sm text-foreground/50">Drop CSV or Excel • Click to browse</p>
            {uploadSuccess && (
              <div className="mt-3 flex items-center gap-2 text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" /> {uploadSuccess}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Existing Datasets */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5 text-brand-light" />
              Your Datasets
            </CardTitle>
          </CardHeader>
          <CardContent>
            {datasets.length === 0 ? (
              <p className="text-foreground/40 text-sm py-6 text-center">No datasets yet. Upload one to get started.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {datasets.map((ds) => (
                  <button
                    key={ds.id}
                    onClick={() => handleSelectDataset(ds.id)}
                    className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                      selectedDataset === ds.id
                        ? "border-brand-light/50 bg-brand/10 shadow-[0_0_20px_rgba(212,168,83,0.15)]"
                        : "border-surface-border bg-surface/[0.02] hover:border-brand/30 hover:bg-surface/[0.05]"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      selectedDataset === ds.id ? "bg-brand/20" : "bg-surface border border-surface-border"
                    }`}>
                      <FileSpreadsheet className={`w-5 h-5 ${selectedDataset === ds.id ? "text-brand-light" : "text-foreground/50"}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{ds.dataset_name}</p>
                      <p className="text-xs text-foreground/40">{new Date(ds.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="ml-auto shrink-0 flex items-center gap-2">
                      {selectedDataset === ds.id && (
                        <CheckCircle2 className="w-5 h-5 text-brand-light" />
                      )}
                      <button
                        onClick={(e) => handleDeleteDataset(e, ds.id)}
                        className="p-1.5 rounded-md hover:bg-red-500/20 text-foreground/40 hover:text-red-400 transition-colors"
                        title="Delete dataset"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ QUERY INPUT ═══ */}
      {selectedDataset && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Data Overview (Show after upload or select, hide when analysis running) */}
          {showOverview && dataProfile && analysisStep === -1 && (
            <DataOverview 
              profile={dataProfile} 
              suggested={suggestedQuestions} 
              onAsk={runAnalysis}
              onClose={() => setShowOverview(false)}
            />
          )}

          <Card className="border-brand/20 shadow-[0_0_40px_rgba(138,43,226,0.08)]">
            <CardContent className="p-6">
              <form onSubmit={(e) => { e.preventDefault(); runAnalysis() }} className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-light/60 pointer-events-none" />
                  <Input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Ask anything about your data..."
                    className="h-14 pl-14 pr-6 text-lg rounded-[1.5rem] border-surface-border bg-surface/[0.03] focus:bg-surface/[0.06] focus:border-brand-light/40 transition-all placeholder:text-foreground/20"
                  />
                </div>
                <Button
                  type="submit"
                  variant="brand"
                  className="h-14 px-8 text-base font-semibold rounded-2xl shadow-[0_0_20px_rgba(212,168,83,0.3)]"
                  disabled={analysisStep >= 0 && analysisStep < PIPELINE_STEPS.length}
                >
                  {analysisStep >= 0 && analysisStep < PIPELINE_STEPS.length ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>Analyze <ArrowRight className="w-5 h-5 ml-2" /></>
                  )}
                </Button>
              </form>

              <div className="flex flex-wrap gap-2 mt-4">
                {(suggestedQuestions && suggestedQuestions.length > 0 ? suggestedQuestions : suggestedQueries).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => runAnalysis(q)}
                    className="px-4 py-3 rounded-full border border-surface-border text-xs text-foreground/60 hover:border-brand/40 hover:text-brand-light hover:bg-brand/5 transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══ STEP 2: PIPELINE ANIMATION ═══ */}
      {analysisStep >= 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in">
          {PIPELINE_STEPS.map((step, i) => {
            const isDone = analysisStep > i
            const isActive = analysisStep === i
            const Icon = step.icon
            return (
              <div
                key={i}
                className={`relative p-6 rounded-2xl border backdrop-blur-sm transition-all duration-500 ${
                  isDone
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : isActive
                    ? "border-brand/50 bg-brand/10 shadow-[0_0_30px_rgba(138,43,226,0.2)]"
                    : "border-surface-border bg-surface/[0.02] opacity-40"
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  {isDone ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  ) : isActive ? (
                    <div className="relative">
                      <Icon className="w-6 h-6 text-brand-light" />
                      <div className="absolute -inset-1 bg-brand/30 rounded-full animate-ping" />
                    </div>
                  ) : (
                    <Icon className="w-6 h-6 text-foreground/30" />
                  )}
                  <span className={`text-xs font-bold uppercase tracking-wider ${
                    isDone ? "text-emerald-400" : isActive ? "text-brand-light" : "text-foreground/30"
                  }`}>
                    Step {i + 1}
                  </span>
                </div>
                <p className={`text-sm font-medium ${
                  isDone ? "text-emerald-300" : isActive ? "text-foreground" : "text-foreground/30"
                }`}>
                  {isDone ? step.label.replace("…", " ✓") : isActive ? progressStatus : step.label}
                </p>
                {isActive && (
                  <div className="mt-3 h-1 bg-surface-border rounded-full overflow-hidden">
                    <div className="h-full bg-brand-light rounded-full animate-[progress_1s_ease-in-out_infinite]"
                      style={{ width: "60%" }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Analysis Error */}
      {analysisError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-fade-in">
          <X className="w-5 h-5 shrink-0" />
          {analysisError}
        </div>
      )}

      {/* ═══ STEP 3: VISUAL RESULTS ═══ */}
      {hasResults && (
        <div ref={resultsRef} className={`grid grid-cols-1 gap-6 animate-fade-in items-start ${isFullscreenChat ? '' : 'xl:grid-cols-4'}`}>
          
          {/* Left Column: Dashboard (hidden in fullscreen chat) */}
          {!isFullscreenChat && (
            <div className="xl:col-span-3 space-y-8">
              {/* Result Summary Bar */}
              <div className="flex flex-wrap items-center gap-6 p-6 rounded-2xl bg-surface/[0.03] border border-surface-border">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-400">Analysis Complete</span>
                </div>
                {analysisResult.execution_time_ms && (
                  <div className="text-sm text-foreground/50">
                    Executed in <strong className="text-foreground">{analysisResult.execution_time_ms}ms</strong>
                  </div>
                )}
                {(analysisResult.row_count != null || analysisResult.result?.result_row_count != null) && (
                  <div className="text-sm text-foreground/50">
                    <strong className="text-foreground">{analysisResult.row_count ?? analysisResult.result?.result_row_count}</strong> rows returned
                  </div>
                )}
                {analysisResult.confidence_score != null && (
                  <div className="ml-auto text-sm font-semibold flex items-center gap-2">
                    <span className="text-foreground/40">Confidence:</span>
                    <span className={analysisResult.confidence_score > 0.8 ? "text-emerald-400" : "text-amber-400"}>
                      {Math.round(analysisResult.confidence_score * 100)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Professional Data Visualization */}
              <ProfessionalDashboard analysis={{
                result_preview: analysisResult.result_preview || analysisResult.result?.result_preview || null,
                chart_config: analysisResult.chart_config || undefined,
                insights: analysisResult.insights || [],
                recommendations: analysisResult.recommendations || [],
                row_count: analysisResult.row_count ?? analysisResult.result?.result_row_count ?? 0,
                execution_time_ms: analysisResult.execution_time_ms,
                confidence_score: analysisResult.confidence_score,
                generated_sql: analysisResult.generated_sql,
                user_query: analysisResult.user_query,
              }} />
            </div>
          )}

          {/* Right Column: AI Chatbot */}
          <div className={`border border-surface-border rounded-2xl bg-surface/[0.02] flex flex-col shadow-glow overflow-hidden transition-all duration-300 ${
            isFullscreenChat
              ? 'col-span-1 h-[80vh]'
              : 'xl:col-span-1 h-[760px] sticky top-8'
          }`}>
            {/* Chat Header */}
            <div className="p-4 border-b border-surface-border bg-surface/[0.05] flex items-center gap-3 shrink-0">
              <div className="relative">
                <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center border border-brand/30">
                  <BrainCircuit className="w-4 h-4 text-brand-light" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#06060A]" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-sm">Data Assistant</h3>
                <p className="text-xs text-foreground/50">Interactive AI Analysis</p>
              </div>
              <button
                onClick={() => setIsFullscreenChat(prev => !prev)}
                title={isFullscreenChat ? "Exit fullscreen" : "Expand chat"}
                className="p-1.5 rounded-lg hover:bg-brand/10 text-foreground/40 hover:text-brand-light transition-colors"
              >
                {isFullscreenChat ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                  <MessageSquare className="w-8 h-8 mb-3 text-foreground/30" />
                  <p className="text-sm">Ask me anything about<br/>this dataset.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border mt-1 ${
                      msg.role === "user" 
                        ? "bg-surface border-surface-border" 
                        : "bg-brand/20 border-brand/30"
                    }`}>
                      {msg.role === "user" ? <User className="w-4 h-4 text-foreground/70" /> : <BrainCircuit className="w-4 h-4 text-brand-light" />}
                    </div>
                    <div className={`flex flex-col gap-3 ${
                      msg.role === "user" ? "items-end max-w-[85%]" : "flex-1"
                    }`}>
                      <div className={`rounded-2xl px-4 py-3 text-sm ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-brand to-brand-light text-[#06060A] font-medium shadow-[0_4px_20px_rgba(212,168,83,0.3)] rounded-tr-sm"
                          : "bg-surface border border-surface-border text-foreground/80 rounded-tl-sm w-full"
                      }`}>
                        {msg.role === "user" ? msg.content : <TypewriterMarkdown content={msg.content} />}
                      </div>
                      {/* Inline data result — shown in both normal and fullscreen chat */}
                      {msg.role === "assistant" && msg.analysis && (() => {
                        const preview = msg.analysis.result_preview || msg.analysis.result?.result_preview || []
                        const insights = (msg.analysis.insights || []).map((ins: {text?: string; insight_text?: string}) => ins.text || ins.insight_text || "").filter(Boolean)
                        const recs = (msg.analysis.recommendations || []).map((r: {text?: string; recommendation_text?: string}) => r.text || r.recommendation_text || "").filter(Boolean)
                        const followups: string[] = (msg.analysis as any).followup_questions || (msg.analysis as any).follow_up_questions || []
                        const rowCount = msg.analysis.row_count ?? msg.analysis.result?.result_row_count ?? 0
                        const cols = preview.length > 0 ? Object.keys(preview[0]) : []
                        const shownRows = preview.length
                        if (!preview.length && !insights.length) return null
                        return (
                          <div className="w-full rounded-xl border border-surface-border bg-[#0a0a10] overflow-hidden text-xs">
                            {/* Data table — all rows, all columns */}
                            {preview.length > 0 && (
                              <div className="overflow-x-auto max-h-[400px] overflow-y-auto scrollbar-thin">
                                <table className="w-full min-w-max">
                                  <thead className="sticky top-0 bg-[#0d0d14] z-10">
                                    <tr className="border-b border-surface-border/50">
                                      {cols.map((k: string) => (
                                        <th key={k} className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-foreground/40 whitespace-nowrap">{k.replace(/_/g, " ")}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {preview.map((row: Record<string, unknown>, ri: number) => (
                                      <tr key={ri} className="border-b border-surface-border/20 hover:bg-brand/5 transition-colors">
                                        {cols.map((k: string) => (
                                          <td key={k} className="py-1.5 px-3 text-foreground/70 whitespace-nowrap max-w-[200px] truncate" title={String(row[k] ?? "")}>{String(row[k] ?? "—")}</td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="flex items-center justify-between px-3 py-1.5 border-t border-surface-border/20 bg-[#0d0d14]">
                                  <span className="text-[10px] text-foreground/30">{cols.length} columns</span>
                                  <span className="text-[10px] text-foreground/30">Showing {shownRows} of {rowCount} rows</span>
                                </div>
                              </div>
                            )}
                            {/* All Insights */}
                            {insights.length > 0 && (
                              <div className="px-3 py-2 border-t border-surface-border/30 flex flex-col gap-1.5">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/30 mb-1">Insights</p>
                                {insights.map((text: string, ii: number) => (
                                  <div key={ii} className="flex items-start gap-2">
                                    <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${ii === 0 ? 'bg-brand-light' : ii === 1 ? 'bg-emerald-400' : 'bg-cyan-400'}`} />
                                    <p className="text-[11px] text-foreground/70 leading-snug">{text}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* All Recommendations */}
                            {recs.length > 0 && (
                              <div className="px-3 py-2 border-t border-surface-border/30 flex flex-col gap-1.5">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/30 mb-1">Recommendations</p>
                                {recs.map((text: string, ri: number) => (
                                  <div key={ri} className="flex items-start gap-2">
                                    <div className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400" />
                                    <p className="text-[11px] text-foreground/70 leading-snug">{text}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Follow-up question chips */}
                            {followups.length > 0 && (
                              <div className="px-3 py-2 border-t border-surface-border/30">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/30 mb-2">Follow-up</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {followups.map((q: string, qi: number) => (
                                    <button
                                      key={qi}
                                      onClick={() => { setChatInput(q) }}
                                      className="px-2.5 py-1 rounded-full border border-brand/30 text-[10px] text-brand-light/70 hover:border-brand/60 hover:text-brand-light hover:bg-brand/10 transition-all text-left"
                                    >
                                      {q}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="flex gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center shrink-0">
                    <BrainCircuit className="w-4 h-4 text-brand-light" />
                  </div>
                  <div className="bg-surface border border-surface-border rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex items-center gap-1.5 w-16">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand-light/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-brand-light/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-brand-light/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-surface-border bg-surface/[0.02] shrink-0">
              <form onSubmit={handleChatSend} className="relative flex items-center gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask anything — I'll show charts & data..."
                  className="pr-12 bg-surface/[0.05] border-surface-border focus:border-brand-light/40 transition-colors rounded-xl text-sm"
                  disabled={chatLoading}
                />
                <Button 
                  type="submit" 
                  size="icon" 
                  variant="brand" 
                  disabled={!chatInput.trim() || chatLoading}
                  className="absolute right-1 w-8 h-8 rounded-lg shadow-none"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Chart Renderers ───────────────────────────────────────────

function RenderChart({ config, chartType }: { config: Record<string, unknown>; chartType: string }) {
  const chartId = useId().replace(/:/g, "-")
  // Normalize data from Chart.js format (backend) -> recharts flat array format
  const rawData = config.data as Record<string, unknown> | undefined

  let data: Record<string, unknown>[] = []
  let xKey = "name"
  let yKey = "value"

  if (rawData && Array.isArray(rawData)) {
    // Already a flat array (recharts style)
    data = rawData as Record<string, unknown>[]
    xKey = (config.x_axis as string) || (config.xKey as string) || Object.keys(data[0] || {})[0] || "name"
    yKey = (config.y_axis as string) || (config.yKey as string) || Object.keys(data[0] || {}).find((k) => k !== xKey) || "value"
  } else if (rawData && typeof rawData === "object") {
    // Chart.js style: { labels: string[], datasets: [{label, data}] }
    const labels = (rawData.labels as string[]) || []
    const datasets = (rawData.datasets as { label?: string; data: number[] }[]) || []
    if (labels.length > 0 && datasets.length > 0) {
      xKey = "name"
      yKey = datasets[0]?.label || "value"
      data = labels.map((label, i) => ({
        name: label,
        [yKey]: datasets[0]?.data?.[i] ?? 0,
      }))
    }
  }

  if (data.length === 0) {
    return <p className="text-foreground/40 text-sm text-center pt-20">No data to visualize</p>
  }

  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey={yKey} nameKey={xKey} cx="50%" cy="50%" outerRadius="80%" label isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (chartType === "area" || chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={CHART_MARGINS}>
          <defs>
            <linearGradient id={`${chartId}-grad`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
          <XAxis dataKey={xKey} stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
          <YAxis stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Area type="monotone" dataKey={yKey} stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill={`url(#${chartId}-grad)`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  // Default: bar chart
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
        <XAxis dataKey={xKey} stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
        <YAxis stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey={yKey} fill="#8b5cf6" radius={[6, 6, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function AutoChart({ data }: { data: Record<string, unknown>[] }) {
  if (!data.length) return null
  const keys = Object.keys(data[0])
  const xKey = keys[0]
  const yKey = keys.find((k) => typeof data[0][k] === "number") || keys[1]

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
        <XAxis dataKey={xKey} stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
        <YAxis stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey={yKey!} fill="#8b5cf6" radius={[6, 6, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Data Overview Component ───────────────────────────────────

function DataOverview({ 
  profile, 
  suggested, 
  onAsk,
  onClose 
}: { 
  profile: DataProfile; 
  suggested: string[]; 
  onAsk: (q: string) => void;
  onClose: () => void 
}) {
  return (
    <Card className="border-brand/30 bg-gradient-to-br from-brand/5 to-transparent overflow-hidden animate-fade-in relative">
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={onClose}
        className="absolute top-4 right-4 hover:bg-brand/10"
      >
        <X className="w-4 h-4" />
      </Button>

      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-brand/20">
            <ScanSearch className="w-5 h-5 text-brand-light" />
          </div>
          <CardTitle>Dataset Overview</CardTitle>
        </div>
        <p className="text-sm text-foreground/60">
          We&apos;ve analyzed <span className="text-white font-semibold">{profile.rows.toLocaleString()}</span> rows 
          across <span className="text-white font-semibold">{profile.columns.length}</span> columns. 
          Here are some initial findings:
        </p>
      </CardHeader>

      <CardContent className="space-y-8">
        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {profile.columns.map((col, i) => (
            <div key={i} className="p-4 rounded-xl bg-surface/[0.03] border border-surface-border">
              <p className="text-[10px] uppercase tracking-wider text-brand-light font-bold mb-1">{col.name}</p>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-lg font-bold">{col.unique_count.toLocaleString()}</p>
                  <p className="text-xs text-foreground/40 font-medium">Unique Values</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-foreground/60">{Math.round(col.null_pct)}% Null</p>
                  <p className="text-[10px] text-foreground/30 uppercase">{col.dtype}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Detailed Column Analysis */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Top Numeric Stats */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-foreground/40 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" />
              Numeric Distributions
            </h4>
            <div className="space-y-3">
              {profile.columns.filter(c => c.stats).map((col, i) => (
                <div key={i} className="p-5 rounded-2xl bg-surface border border-surface-border flex flex-col gap-4 group hover:border-brand/40 transition-all duration-300 relative shadow-sm hover:shadow-[0_0_20px_rgba(212,168,83,0.1)] overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-brand/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none group-hover:bg-brand/15 transition-colors duration-500" />
                  
                  <div className="flex justify-between items-center z-10 w-full relative">
                    <span className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-foreground to-foreground/60 w-max">
                      {col.name}
                    </span>
                    {col.stats?.skew_direction && (
                      <span className="text-[9px] tracking-wider uppercase font-bold text-brand-light/70 bg-brand/10 border border-brand/20 px-2 py-0.5 rounded-full">
                        {col.stats.skew_direction} skew
                      </span>
                    )}
                  </div>
                  
                  {/* Metrics Grid (Expanded) */}
                  <div className="grid grid-cols-4 gap-y-4 gap-x-2 text-center z-10 pt-1">
                    <div>
                      <p className="text-[10px] text-brand-light/70 uppercase font-bold tracking-widest mb-1">Mean</p>
                      <p className="text-sm font-bold text-brand-light drop-shadow-sm">
                        {col.stats?.mean != null ? Number(col.stats.mean).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/40 uppercase font-bold tracking-widest mb-1">Median</p>
                      <p className="text-xs font-semibold text-foreground/80">
                        {col.stats?.median != null ? Number(col.stats.median).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/40 uppercase font-bold tracking-widest mb-1">Min</p>
                      <p className="text-xs font-semibold text-foreground/80">
                        {col.stats?.min != null ? Number(col.stats.min).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/40 uppercase font-bold tracking-widest mb-1">Max</p>
                      <p className="text-xs font-semibold text-foreground/80">
                        {col.stats?.max != null ? Number(col.stats.max).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "-"}
                      </p>
                    </div>
                    
                    <div>
                      <p className="text-[10px] text-foreground/40 uppercase font-bold tracking-widest mb-1">Std Dev</p>
                      <p className="text-xs font-semibold text-foreground/80">
                        {col.stats?.std != null ? Number(col.stats.std).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/40 uppercase font-bold tracking-widest mb-1">P25</p>
                      <p className="text-xs font-semibold text-foreground/80">
                        {col.stats?.p25 != null ? Number(col.stats.p25).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/40 uppercase font-bold tracking-widest mb-1">P75</p>
                      <p className="text-xs font-semibold text-foreground/80">
                        {col.stats?.p75 != null ? Number(col.stats.p75).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/40 uppercase font-bold tracking-widest mb-1">Skewness</p>
                      <p className="text-xs font-semibold text-foreground/80">
                        {col.stats?.skewness != null ? Number(col.stats.skewness).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {profile.columns.filter(c => c.stats).length === 0 && (
                <div className="p-8 rounded-xl bg-surface/20 border border-dashed border-surface-border text-center">
                  <p className="text-xs text-foreground/40">No numeric statistics detected.</p>
                </div>
              )}
            </div>
          </div>

          {/* Categorical Top Values */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-foreground/40 flex items-center gap-2">
              <PieChartIcon className="w-3.5 h-3.5" />
              Top Categories
            </h4>
            <div className="space-y-3">
              {profile.columns.filter(c => c.dtype === "str" && c.top_values && c.top_values.length > 0).map((col, i) => {
                const chartData = col.top_values?.slice(0, 5).map(tv => ({
                  name: tv.value || "N/A",
                  count: tv.count
                })) || [];
                const barColor = CHART_COLORS[i % CHART_COLORS.length];
                
                return (
                  <div key={i} className="p-5 rounded-2xl bg-surface border border-surface-border flex flex-col gap-3 group hover:border-brand/40 transition-all duration-300 relative shadow-sm hover:shadow-[0_0_20px_rgba(212,168,83,0.1)]">
                    {/* Subtle Glow */}
                    <div 
                      className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none transition-colors duration-500 opacity-20 group-hover:opacity-40" 
                      style={{ backgroundColor: barColor }} 
                    />
                    
                    <span className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-foreground to-foreground/60 z-10 w-max">
                      {col.name}
                    </span>
                    
                    <div className="h-[140px] w-full mt-2 relative z-10 -ml-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id={`barGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={barColor} stopOpacity={0.8} />
                              <stop offset="100%" stopColor={barColor} stopOpacity={0.2} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                          <XAxis 
                            dataKey="name" 
                            stroke="#ffffff30" 
                            fontSize={10} 
                            tickLine={false} 
                            axisLine={false}
                            tick={{ fill: "#ffffff50" }}
                            tickFormatter={(val: string) => val.length > 10 ? val.substring(0, 8) + '...' : val}
                          />
                          <YAxis 
                            stroke="#ffffff30" 
                            fontSize={10} 
                            tickLine={false} 
                            axisLine={false} 
                            tick={{ fill: "#ffffff50" }}
                            tickFormatter={(val: number) => val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toString()}
                            width={45}
                          />
                          <Tooltip 
                            cursor={{ fill: '#ffffff08' }}
                            contentStyle={{ backgroundColor: "#06060A", border: "1px solid #333", borderRadius: "8px", fontSize: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }} 
                            itemStyle={{ color: barColor, fontWeight: "bold" }}
                            labelStyle={{ color: "#ffffff80", marginBottom: "4px" }}
                          />
                          <Bar dataKey="count" fill={`url(#barGrad-${i})`} radius={[4, 4, 0, 0]} maxBarSize={32} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
              {profile.columns.filter(c => c.dtype === "str" && c.top_values && c.top_values.length > 0).length === 0 && (
                <div className="p-8 rounded-xl bg-surface/20 border border-dashed border-surface-border text-center">
                  <p className="text-xs text-foreground/40">No categorical top values detected.</p>
                </div>
              )}
            </div>
          </div>

          {/* Correlations / Trends */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-foreground/40 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" />
              Initial Data Correlations
            </h4>
            {profile.correlations && profile.correlations.length > 0 ? (
              <div className="space-y-3">
                {profile.correlations.map((corr, i) => {
                  const corrPct = Math.abs(corr.correlation) * 100;
                  const isPositive = corr.correlation >= 0;
                  const colorClass = isPositive ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20";
                  const barColor = isPositive ? "bg-gradient-to-r from-emerald-500/20 to-emerald-500" : "bg-gradient-to-l from-amber-500/20 to-amber-500";
                  
                  return (
                    <div key={i} className="p-4 rounded-xl bg-surface border border-surface-border group hover:border-brand/40 transition-colors shadow-sm cursor-default">
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-foreground/90 truncate max-w-[140px]" title={corr.col1}>{corr.col1}</span>
                          <ArrowRight className="w-3 h-3 text-foreground/30 shrink-0" />
                          <span className="text-xs font-bold text-foreground/90 truncate max-w-[140px]" title={corr.col2}>{corr.col2}</span>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border ${colorClass}`}>
                          {corr.strength}
                        </span>
                      </div>
                      
                      {/* Center-anchored visualizer */}
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-medium text-foreground/40 w-4">-1</span>
                        <div className="flex-1 h-1.5 bg-surface-border/40 rounded-full flex items-center relative overflow-hidden">
                          {/* Center Divider */}
                          <div className="absolute left-1/2 w-0.5 h-full bg-foreground/20 -translate-x-1/2 z-10" />
                          {/* Left Fill (Negative) */}
                          {!isPositive && (
                            <div className={`absolute right-1/2 h-full rounded-l-full opacity-80 ${barColor} shadow-[0_0_10px_rgba(245,158,11,0.5)]`} style={{ width: `${corrPct / 2}%` }} />
                          )}
                          {/* Right Fill (Positive) */}
                          {isPositive && (
                            <div className={`absolute left-1/2 h-full rounded-r-full opacity-80 ${barColor} shadow-[0_0_10px_rgba(16,185,129,0.5)]`} style={{ width: `${corrPct / 2}%` }} />
                          )}
                        </div>
                        <span className="text-[10px] font-medium text-foreground/40 w-4 text-right">+1</span>
                        
                        {/* Percentage Label */}
                        <span className={`text-xs font-bold w-12 text-right tracking-tight ${isPositive ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {(corr.correlation * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-surface/20 border border-dashed border-surface-border text-center">
                <p className="text-xs text-foreground/40">No strong correlations detected yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Suggested Next Steps */}
        {suggested.length > 0 && (
          <div className="pt-4 border-t border-brand/20">
            <h4 className="text-xs font-bold uppercase tracking-widest text-brand-light mb-4 flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              Suggested Analysis
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suggested.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onAsk(q)}
                  className="flex items-center justify-between p-4 rounded-xl bg-brand/5 border border-brand/10 hover:border-brand/40 hover:bg-brand/10 transition-all text-left group"
                >
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-white">{q}</span>
                  <ArrowRight className="w-4 h-4 text-brand-light opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
