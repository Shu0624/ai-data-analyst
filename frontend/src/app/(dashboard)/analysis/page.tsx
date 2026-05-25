"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import {
  Database, Sparkles, Send, MessageSquare, Loader2,
  ScanSearch, Cpu, BrainCircuit, BarChart3, AlertCircle, RotateCcw
} from "lucide-react"
import { useAuthStore } from "@/lib/store"
import { api } from "@/lib/api"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { ProfessionalDashboard } from "@/components/ProfessionalDashboard"

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
  row_count?: number
  result_preview?: Record<string, unknown>[]
  chart_config?: { type: string; data: unknown; options?: unknown } | null
}

interface ChatMessage {
  role: string
  content: string
  analysis?: AnalysisResult
}

const PIPELINE_STEPS = [
  { icon: ScanSearch, label: "Scanning dataset schema…", node: "schema_selector" },
  { icon: Cpu, label: "Synthesizing DuckDB SQL queries…", node: "generate_sql" },
  { icon: BrainCircuit, label: "Reasoning and execution via duckdb…", node: "execute_sql" },
  { icon: BarChart3, label: "Formatting charts & recommendations…", node: "chart" },
]

function TypewriterMarkdown({ content }: { content: string }) {
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    let index = 0
    setDisplayed("")
    const interval = setInterval(() => {
      index += 3 // Fluid reveal speed
      if (index >= content.length) {
        setDisplayed(content)
        clearInterval(interval)
      } else {
        setDisplayed(content.slice(0, index))
      }
    }, 12)
    return () => clearInterval(interval)
  }, [content])

  return (
    <div className="prose prose-invert prose-sm max-w-none 
      prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent
      prose-td:border prose-td:border-surface-border prose-th:border prose-th:border-surface-border
      prose-a:text-brand-light hover:prose-a:text-brand transition-colors text-foreground/85">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode }) {
            const match = /language-(\w+)/.exec(className || "")
            const codeString = String(children).replace(/\n$/, "")
            return !inline && match ? (
              <div className="my-4 rounded-xl border border-surface-border bg-[#040406] overflow-hidden shadow-glass">
                <div className="flex items-center justify-between px-4 py-2 bg-[#0a0a10] border-b border-surface-border/50 text-[10px] font-bold text-foreground/35 tracking-widest uppercase">
                  <span>{match[1]}</span>
                  <button
                    onClick={(e) => {
                      navigator.clipboard.writeText(codeString)
                      const target = e.currentTarget
                      target.innerHTML = `<span class="text-emerald-400">✓ Copied</span>`
                      setTimeout(() => {
                        target.innerHTML = `<span>Copy</span>`
                      }, 1500)
                    }}
                    className="hover:text-brand-light transition-all active:scale-95"
                  >
                    <span>Copy</span>
                  </button>
                </div>
                <SyntaxHighlighter
                  style={vscDarkPlus as Record<string, React.CSSProperties>}
                  language={match[1]}
                  PreTag="div"
                  className="!m-0 !p-4 !bg-transparent text-xs overflow-x-auto font-mono"
                  {...props}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code className="bg-surface-border/50 px-1 py-0.5 rounded text-brand-light font-mono text-xs" {...props}>
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

export default function AnalysisPage() {
  const searchParams = useSearchParams()
  const initialDatasetId = searchParams.get("dataset")
  const initialQuery = searchParams.get("query")

  const [datasets, setDatasets] = useState<DatasetOption[]>([])
  const [selectedDatasetId, setSelectedDatasetId] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  
  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [progressStatus, setProgressStatus] = useState("")
  const [currentStepNode, setCurrentStepNode] = useState("")
  
  // Error state
  const [error, setError] = useState("")
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch datasets on mount
  useEffect(() => {
    api.get("/datasets/")
      .then((r) => {
        setDatasets(r.data)
        // Auto-select dataset from query param if available
        if (initialDatasetId && r.data.some((d: DatasetOption) => d.id === initialDatasetId)) {
          setSelectedDatasetId(initialDatasetId)
        } else if (r.data.length > 0) {
          setSelectedDatasetId(r.data[0].id)
        }
      })
      .catch(() => {})
  }, [initialDatasetId])

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])


  // Reset conversation session
  const handleResetSession = () => {
    setMessages([])
    setSessionId(null)
    setError("")
    setProgressStatus("")
    setCurrentStepNode("")
  }

  // Run AI Query pipeline
  const handleRunQuery = useCallback(async (queryText: string) => {
    if (!selectedDatasetId) {
      setError("Please select a dataset first.")
      return
    }

    const q = queryText.trim()
    if (!q) return

    setLoading(true)
    setError("")
    setProgressStatus("Connecting to pipeline...")
    setCurrentStepNode("router")
    
    // Add user query to chat history
    setMessages(prev => [...prev, { role: "user", content: q }])

    try {
      let currentSessionId = sessionId
      
      // 1. Establish session if not already existing
      if (!currentSessionId) {
        setProgressStatus("Establishing chat session...")
        const ds = datasets.find(d => d.id === selectedDatasetId)
        const { data: session } = await api.post("/chat/sessions", {
          dataset_id: selectedDatasetId,
          session_name: `AI Query Playground: ${ds?.dataset_name || "Dataset"}`,
        })
        currentSessionId = session.id
        setSessionId(session.id)
      }

      // 2. Open SSE stream
      const token = useAuthStore.getState().token
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/ai/agent/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          dataset_id: selectedDatasetId,
          user_query: q,
          session_id: currentSessionId
        })
      })

      if (!response.ok) {
        throw new Error(`Pipeline API returned status ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("Connection failed")

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
                setCurrentStepNode(payload.node || "")
              } else if (eventType === "complete") {
                const result = payload as AnalysisResult
                
                // Format the AI's response text block nicely
                const rowCount = result.row_count ?? result.result?.result_row_count ?? 0
                const insightTexts = (result.insights || []).map(i => i.insight_text).filter(Boolean)
                const recs = (result.recommendations || []).map(r => r.recommendation_text).filter(Boolean)
                
                let summaryContent = ""
                let introText = result.final_answer || result.explanation || ""
                if (!introText) {
                  introText = `Analysis complete. Processed **${rowCount} records**.`
                }
                summaryContent += introText + "\n\n"
                
                if (result.generated_sql) {
                  summaryContent += `\`\`\`sql\n${result.generated_sql}\n\`\`\`\n\n`
                }
                
                if (insightTexts.length > 0) {
                  summaryContent += `**Key Findings (${insightTexts.length}):**\n`
                  insightTexts.forEach((t, i) => {
                    summaryContent += `${i + 1}. ${t}\n`
                  })
                  summaryContent += "\n"
                }
                
                if (recs.length > 0) {
                  summaryContent += `**Strategic Recommendations (${recs.length}):**\n`
                  recs.forEach((t, i) => {
                    summaryContent += `${i + 1}. ${t}\n`
                  })
                }

                setMessages(prev => [...prev, {
                  role: "assistant",
                  content: summaryContent,
                  analysis: result
                }])
                setLoading(false)
                setProgressStatus("")
                setCurrentStepNode("")
              } else if (eventType === "error") {
                setError(payload.error || "An error occurred in the AI graph pipeline.")
                setLoading(false)
                setProgressStatus("")
                setCurrentStepNode("")
              }
            } catch (err) {
              console.error("Failed to parse event", err)
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed. Verify server connection.")
      setLoading(false)
      setProgressStatus("")
      setCurrentStepNode("")
    }
  }, [selectedDatasetId, sessionId, datasets])

  // Auto trigger query if present in search params
  useEffect(() => {
    if (selectedDatasetId && initialQuery) {
      // Clear query params to prevent re-triggering on reload
      const url = new URL(window.location.href)
      url.searchParams.delete("query")
      window.history.replaceState({}, "", url)
      
      handleRunQuery(initialQuery)
    }
  }, [selectedDatasetId, initialQuery, handleRunQuery])

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim() || loading) return
    const text = chatInput.trim()
    setChatInput("")
    handleRunQuery(text)
  }

  // Pre-approved prompt suggestions
  const suggestedQueries = [
    "Summarize this dataset and show key trends",
    "Show me the top 5 categories by frequency",
    "Identify any anomalies or outliers in numeric fields",
    "Calculate average values grouped by segment"
  ]

  const activeDataset = datasets.find(d => d.id === selectedDatasetId)

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-surface-border/50 pb-5">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-brand-light" />
            AI Query Playground
          </h1>
          <p className="text-xs text-foreground/50 mt-1">
            Talk directly to your dataset. The AI will translate queries into DuckDB SQL, generate charts, and summarize key insights.
          </p>
        </div>
        
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-foreground/45" />
            <select
              value={selectedDatasetId}
              onChange={(e) => {
                setSelectedDatasetId(e.target.value)
                handleResetSession()
              }}
              className="h-10 text-xs bg-[#0F0F16] border border-surface-border rounded-xl px-3 text-foreground font-bold"
            >
              {datasets.length === 0 ? (
                <option value="">No Ingested Datasets</option>
              ) : (
                datasets.map(d => (
                  <option key={d.id} value={d.id}>{d.dataset_name} ({d.dataset_type.toUpperCase()})</option>
                ))
              )}
            </select>
          </div>
          {messages.length > 0 && (
            <Button
              variant="brand"
              onClick={handleResetSession}
              className="h-10 w-10 p-0 rounded-xl border border-brand/20 bg-brand/5 text-brand hover:bg-brand/15"
              title="Reset Conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      
      <div className="space-y-6">
        
        {/* CHAT INTERFACE: Full width */}
        <Card className="flex flex-col border-brand/10 bg-surface/[0.01]">
          <CardHeader className="pb-3 border-b border-surface-border/50 shrink-0">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <MessageSquare className="w-4.5 h-4.5 text-brand-light" />
              Conversation Log
              {activeDataset && (
                <span className="ml-auto text-[10px] font-bold text-foreground/40 border border-surface-border px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Querying: {activeDataset.dataset_name}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          
          {/* Messages Body */}
          <div className={`overflow-y-auto p-6 space-y-6 scrollbar-thin ${messages.length === 0 ? "h-[500px]" : "max-h-[600px]"}`}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-8 relative overflow-hidden">
                {/* Subtle grid light overlay */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(212,168,83,0.02)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />
                
                <div className="relative w-16 h-16 rounded-3xl bg-brand/5 border border-brand/15 flex items-center justify-center shadow-glow animate-[bounce_3s_infinite]">
                  <Sparkles className="w-8 h-8 text-brand-light" />
                </div>
                
                <div className="space-y-2">
                  <h3 className="font-display font-bold text-lg text-foreground/90">Ask anything about {activeDataset?.dataset_name || "your data"}</h3>
                  <p className="text-xs text-foreground/45 max-w-sm mx-auto leading-relaxed">
                    Input a natural language query. The pipeline will compile tailored DuckDB queries, run computations, and formulate strategic decisions.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5 justify-center max-w-lg pt-2 relative z-10">
                  {suggestedQueries.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleRunQuery(q)}
                      disabled={!selectedDatasetId}
                      className="px-4 py-2.5 text-xs font-semibold rounded-2xl border border-surface-border bg-gradient-to-b from-white/[0.02] to-white/[0.00] hover:border-brand/40 hover:text-brand-light active:scale-95 duration-200 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    {msg.role === "user" ? (
                      <div className="max-w-[60%] px-4.5 py-3 rounded-2xl rounded-tr-sm bg-gradient-to-br from-brand to-brand-light text-[#06060A] font-semibold text-sm shadow-glow">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="w-full rounded-2xl border border-surface-border bg-surface/[0.03] p-5 space-y-5">
                        <div className="flex items-center gap-2 border-b border-surface-border/30 pb-3">
                          <div className="w-7 h-7 rounded-lg bg-brand/15 flex items-center justify-center border border-brand/20">
                            <Sparkles className="w-4.5 h-4.5 text-brand-light" />
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/50">AI Data Analyst</span>
                          {msg.analysis?.execution_time_ms && (
                            <span className="ml-auto text-[10px] text-foreground/35">
                              Executed in {msg.analysis.execution_time_ms}ms
                            </span>
                          )}
                        </div>
                        <TypewriterMarkdown content={msg.content} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {/* Loader & Pipeline Step indicators */}
            {loading && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-brand/5 border border-brand/10 text-xs text-brand-light animate-pulse font-semibold">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  {progressStatus || "AI routing agent running…"}
                </div>
                
                {/* Futuristic Interactive HUD Node Visualizer */}
                <div className="relative flex items-start justify-between bg-[#040406] border border-brand/20 p-8 rounded-2xl shadow-[inset_0_0_30px_rgba(212,168,83,0.03)] overflow-hidden">
                  {/* subtle tech grid background */}
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(212,168,83,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(212,168,83,0.03)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />
                  
                  {PIPELINE_STEPS.map((step, idx) => {
                    const stepOrder = ["schema_selector", "generate_sql", "execute_sql", "chart"];
                    const stepIndex = stepOrder.indexOf(step.node);
                    const currentIndex = stepOrder.indexOf(currentStepNode || "schema_selector");
                    
                    const isPastNode = stepIndex < currentIndex;
                    const isActiveNode = stepIndex === currentIndex;

                    return (
                      <div key={idx} className="relative flex flex-col items-center flex-1 z-10">
                        
                        {/* Animated Connecting Line to next node */}
                        {idx < PIPELINE_STEPS.length - 1 && (
                          <div className="absolute top-6 left-[50%] right-[-50%] h-0.5 bg-surface-border/40 z-[-1] overflow-hidden">
                             <div className={`h-full transition-all duration-700 ease-in-out ${
                               isPastNode ? "w-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" : 
                               isActiveNode ? "w-1/2 bg-brand shadow-[0_0_10px_rgba(212,168,83,0.8)] animate-pulse" : 
                               "w-0"
                             }`} />
                          </div>
                        )}

                        {/* Node Orb */}
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                          isActiveNode ? "border-brand bg-[#06060A] text-brand shadow-[0_0_25px_rgba(212,168,83,0.5)] scale-110" :
                          isPastNode ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]" :
                          "border-surface-border bg-surface/[0.05] text-foreground/30"
                        }`}>
                          {isActiveNode ? <Loader2 className="w-5 h-5 animate-spin" /> : <step.icon className="w-5 h-5" />}
                        </div>
                        
                        {/* Node Labeling */}
                        <div className="mt-4 flex flex-col items-center text-center">
                          <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors duration-300 ${
                            isActiveNode ? "text-brand" :
                            isPastNode ? "text-emerald-400" :
                            "text-foreground/40"
                          }`}>{step.node.split("_")[0]}</span>
                          <span className={`text-[9px] mt-1.5 hidden xl:block max-w-[110px] leading-relaxed font-medium ${
                            isActiveNode ? "text-brand-light/80 animate-pulse" : "text-foreground/30"
                          }`}>
                            {step.label}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div className="p-4 border-t border-surface-border/50 shrink-0">
            <form onSubmit={handleFormSubmit} className="flex gap-3">
              <div className="flex-1 relative">
                <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-brand-light/50 pointer-events-none" />
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={loading ? "Analyzing dataset..." : "Ask your dataset anything..."}
                  className="h-12 pl-12 pr-4 text-sm rounded-xl border-surface-border bg-surface/[0.02] focus:bg-surface/[0.05] focus:border-brand-light/30 transition-all"
                  disabled={loading || !selectedDatasetId}
                />
              </div>
              <Button
                type="submit"
                variant="brand"
                className="h-12 px-6 rounded-xl font-bold shadow-glow"
                disabled={!chatInput.trim() || loading || !selectedDatasetId}
              >
                <Send className="w-4.5 h-4.5" />
              </Button>
            </form>
          </div>
        </Card>

        {/* FULL-WIDTH VISUAL DASHBOARD — renders below chat for the latest analysis */}
        {messages.length > 0 && messages[messages.length - 1]?.analysis && (
          <div className="animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-brand-light" />
              <h2 className="text-lg font-display font-bold">Visual Dashboard</h2>
              <span className="text-[10px] text-foreground/30 font-medium border border-surface-border px-2 py-0.5 rounded-full uppercase tracking-wider">Full Analysis</span>
            </div>
            <ProfessionalDashboard 
              analysis={messages[messages.length - 1].analysis as unknown as React.ComponentProps<typeof ProfessionalDashboard>["analysis"]} 
              isCompact={false}
            />
          </div>
        )}

      </div>

    </div>
  )
}
