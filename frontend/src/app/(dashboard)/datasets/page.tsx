"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import {
  UploadCloud, Database, Loader2, CheckCircle2,
  FileSpreadsheet, ArrowRight, TableProperties, Sparkles,
  Trash, Server, FileText, ChevronRight, AlertCircle
} from "lucide-react"
import { api } from "@/lib/api"
import { motion, AnimatePresence } from "framer-motion"

interface DatasetOption {
  id: string
  dataset_name: string
  dataset_type: string
  description?: string
  created_at: string
  table_count: number
  total_rows: number
}

interface ColumnDetail {
  column_name: string
  data_type: string
  is_nullable: boolean
  sample_values?: string
}

interface TableDetail {
  table_name: string
  row_count: number
  columns: ColumnDetail[]
}

interface DatasetDetail {
  id: string
  dataset_name: string
  dataset_type: string
  description?: string
  created_at: string
  tables: TableDetail[]
}

interface ColumnProfile {
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
  }
}

interface DataProfile {
  rows: number
  columns: ColumnProfile[]
}

export default function DatasetsPage() {
  const router = useRouter()
  const [datasets, setDatasets] = useState<DatasetOption[]>([])
  const [selectedDataset, setSelectedDataset] = useState<DatasetOption | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<DatasetDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  
  // Profile
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileData, setProfileData] = useState<DataProfile | null>(null)
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  
  // Tabs for the detail view
  const [activeDetailTab, setActiveDetailTab] = useState<"schema" | "profile" | "prompts">("schema")

  // Ingestion Modal
  const [showIngestModal, setShowIngestModal] = useState(false)
  const [activeIngestTab, setActiveIngestTab] = useState<"file" | "database">("file")
  const [uploading, setUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState("")
  const [uploadError, setUploadError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Database Connection Form
  const [dbForm, setDbForm] = useState({
    dataset_name: "",
    db_type: "postgresql",
    host: "",
    port: 5432,
    username: "",
    password: "",
    database: "",
    description: ""
  })
  const [connectingDb, setConnectingDb] = useState(false)
  const [connectDbError, setConnectDbError] = useState("")
  const [connectDbSuccess, setConnectDbSuccess] = useState("")

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Load datasets on mount
  useEffect(() => {
    loadDatasets()
  }, [])

  const loadDatasets = async () => {
    try {
      const res = await api.get("/datasets/")
      setDatasets(res.data)
    } catch (err) {
      console.error("Failed to load datasets", err)
    }
  }

  // Handle selecting a dataset card
  const handleSelectDataset = async (ds: DatasetOption) => {
    setSelectedDataset(ds)
    setLoadingDetail(true)
    setProfileLoading(true)
    setProfileData(null)
    setSuggestedQuestions([])
    setSelectedDetail(null)
    setActiveDetailTab("schema")

    try {
      // 1. Fetch tables and schemas
      const detailRes = await api.get(`/datasets/${ds.id}`)
      setSelectedDetail(detailRes.data)
      setLoadingDetail(false)

      // 2. Fetch AI profile & suggestions
      const profileRes = await api.get(`/datasets/${ds.id}/profile`)
      if (profileRes.data.profile) {
        // The profile key is usually the table name, let's extract the first one
        const keys = Object.keys(profileRes.data.profile)
        if (keys.length > 0) {
          setProfileData(profileRes.data.profile[keys[0]])
        }
      }
      setSuggestedQuestions(profileRes.data.suggested_questions || [])
    } catch (err) {
      console.error("Failed to load dataset details/profile", err)
    } finally {
      setLoadingDetail(false)
      setProfileLoading(false)
    }
  }

  // Handle spreadsheet upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError("")
    setUploadSuccess("")
    const formData = new FormData()
    formData.append("file", file)
    formData.append("dataset_name", file.name.replace(/\.[^/.]+$/, ""))

    try {
      const { data } = await api.post("/datasets/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      setUploadSuccess(`"${file.name}" uploaded successfully!`)
      await loadDatasets()
      
      // Auto select newly uploaded dataset
      if (data.dataset_id) {
        const found = datasets.find(d => d.id === data.dataset_id)
        if (found) handleSelectDataset(found)
      }
      setTimeout(() => setShowIngestModal(false), 1500)
    } catch (err: unknown) {
      const errResponse = err as { response?: { data?: { detail?: string } } };
      setUploadError(errResponse.response?.data?.detail || "Upload failed. Please try again.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // Handle external database connection
  const handleConnectDb = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dbForm.dataset_name.trim() || !dbForm.host.trim() || !dbForm.username.trim() || !dbForm.password.trim() || !dbForm.database.trim()) {
      setConnectDbError("Please fill in all connection parameters.")
      return
    }
    setConnectingDb(true)
    setConnectDbError("")
    setConnectDbSuccess("")
    try {
      await api.post("/datasets/connect-db", {
        ...dbForm,
        port: Number(dbForm.port)
      })
      setConnectDbSuccess(`Connected to "${dbForm.dataset_name}" successfully!`)
      await loadDatasets()
      setTimeout(() => setShowIngestModal(false), 1500)
    } catch (err: unknown) {
      const errResponse = err as { response?: { data?: { detail?: string } } };
      setConnectDbError(errResponse.response?.data?.detail || "Connection failed. Check credentials and host connectivity.")
    } finally {
      setConnectingDb(false)
    }
  }

  // Handle delete
  const handleDelete = async (ds: DatasetOption) => {
    if (!confirm(`Are you sure you want to delete "${ds.dataset_name}"? All analysis sessions and chat history will be permanently deleted.`)) return
    setDeletingId(ds.id)
    try {
      await api.delete(`/datasets/${ds.id}`)
      if (selectedDataset?.id === ds.id) {
        setSelectedDataset(null)
        setSelectedDetail(null)
        setProfileData(null)
      }
      await loadDatasets()
    } catch {
      alert("Failed to delete dataset.")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-10 animate-fade-in pb-20">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2 flex items-center gap-3">
            <Database className="w-9 h-9 text-brand-light" />
            Datasets Manager
          </h1>
          <p className="text-foreground/60 text-lg">
            Upload spreadsheets or connect external databases to fuel your AI data queries.
          </p>
        </div>
        <Button 
          variant="brand" 
          onClick={() => {
            setUploadSuccess("")
            setUploadError("")
            setConnectDbSuccess("")
            setConnectDbError("")
            setShowIngestModal(true)
          }}
          className="h-12 px-6 rounded-xl font-bold shadow-glow hover:scale-105 transition-all shrink-0"
        >
          <UploadCloud className="w-5 h-5 mr-2" />
          Ingest Dataset
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
        
        {/* LEFT COLUMN: Dataset Cards list */}
        <div className="xl:col-span-1 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-surface-border/50">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-brand-light" />
                Available Datasets
                {datasets.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-foreground/40 bg-surface border border-surface-border px-2 py-0.5 rounded-full">
                    {datasets.length}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {datasets.length === 0 ? (
                <div className="text-center py-12 text-foreground/40 flex flex-col items-center">
                  <Database className="w-12 h-12 text-foreground/10 mb-3" />
                  <p className="text-sm font-medium">No datasets ingested yet</p>
                  <p className="text-xs text-foreground/30 mt-1">Upload a CSV/Excel file or connect a database to begin.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {datasets.map((ds) => (
                    <div
                      key={ds.id}
                      onClick={() => handleSelectDataset(ds)}
                      className={`group relative flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${
                        selectedDataset?.id === ds.id
                          ? "border-brand-light/50 bg-brand/10 shadow-[0_0_20px_rgba(212,168,83,0.1)]"
                          : "border-surface-border hover:border-brand/30 hover:bg-surface/[0.04]"
                      }`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                        selectedDataset?.id === ds.id ? "bg-brand/20" : "bg-surface border border-surface-border"
                      }`}>
                        {ds.dataset_type === "database" ? (
                          <Server className={`w-5 h-5 ${selectedDataset?.id === ds.id ? "text-brand-light" : "text-foreground/50"}`} />
                        ) : (
                          <FileSpreadsheet className={`w-5 h-5 ${selectedDataset?.id === ds.id ? "text-brand-light" : "text-foreground/50"}`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-sm font-bold truncate">{ds.dataset_name}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-light bg-brand/5 border border-brand/10 px-1.5 py-0.25 rounded">
                            {ds.dataset_type}
                          </span>
                          <span className="text-xs text-foreground/40 font-medium">
                            {ds.total_rows.toLocaleString()} rows
                          </span>
                        </div>
                      </div>
                      {selectedDataset?.id === ds.id && (
                        <ChevronRight className="w-5 h-5 text-brand-light shrink-0" />
                      )}
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(ds)
                        }}
                        disabled={deletingId === ds.id}
                        className="opacity-0 group-hover:opacity-100 absolute top-4 right-4 p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 text-foreground/35 transition-all"
                      >
                        {deletingId === ds.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: Dataset details & profile tabs */}
        <div className="xl:col-span-2">
          {!selectedDataset ? (
            <div className="h-[450px] flex flex-col items-center justify-center text-center border-2 border-dashed border-surface-border rounded-3xl p-12 bg-surface/[0.01]">
              <Database className="w-16 h-16 text-foreground/15 mb-4" />
              <h3 className="text-lg font-bold text-foreground/50">Select a dataset</h3>
              <p className="text-sm text-foreground/30 mt-1 max-w-sm">
                Choose a dataset from the list to view its schema details, statistical AI profiles, and suggested questions.
              </p>
            </div>
          ) : (
            <Card className="border-brand/10">
              <CardHeader className="pb-3 border-b border-surface-border/50">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand/15 flex items-center justify-center border border-brand/20">
                      {selectedDataset.dataset_type === "database" ? (
                        <Server className="w-5 h-5 text-brand-light" />
                      ) : (
                        <FileSpreadsheet className="w-5 h-5 text-brand-light" />
                      )}
                    </div>
                    <div>
                      <p className="text-base font-bold leading-tight">{selectedDataset.dataset_name}</p>
                      <p className="text-xs text-foreground/45 mt-0.5">
                        Ingested: {new Date(selectedDataset.created_at).toLocaleDateString()} · {selectedDataset.total_rows.toLocaleString()} rows total
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="brand" 
                    onClick={() => router.push(`/analysis?dataset=${selectedDataset.id}`)}
                    className="h-10 px-4 rounded-xl text-xs font-bold shadow-glow hover:scale-105 transition-all"
                  >
                    Analyze with AI <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
                
                {/* Tabs */}
                <div className="flex gap-2 mt-6 border-t border-surface-border/50 pt-4">
                  {(["schema", "profile", "prompts"] as const).map((tab) => {
                    const labelMap = { schema: "Table Schema", profile: "AI Profile & Stats", prompts: "Suggested Questions" }
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveDetailTab(tab)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                          activeDetailTab === tab
                            ? "bg-brand/10 border-brand-light/40 text-brand-light"
                            : "border-transparent text-foreground/40 hover:text-foreground/75 hover:bg-surface-hover"
                        }`}
                      >
                        {labelMap[tab]}
                      </button>
                    )
                  })}
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                
                {/* TAB 1: Schema Details */}
                {activeDetailTab === "schema" && (
                  <div className="space-y-6">
                    {loadingDetail ? (
                      <div className="py-20 flex flex-col items-center justify-center text-foreground/40 gap-2">
                        <Loader2 className="w-8 h-8 text-brand-light animate-spin" />
                        <span className="text-xs font-medium">Fetching database schemas…</span>
                      </div>
                    ) : selectedDetail?.tables?.length === 0 ? (
                      <p className="text-sm text-foreground/40 py-8 text-center">No schema information found.</p>
                    ) : (
                      selectedDetail?.tables?.map((table, tIdx) => (
                        <div key={tIdx} className="border border-surface-border/50 rounded-2xl p-5 bg-surface/[0.01]">
                          <div className="flex items-center justify-between mb-4 border-b border-surface-border/30 pb-3">
                            <span className="font-bold text-sm flex items-center gap-2 text-foreground/90">
                              <TableProperties className="w-4 h-4 text-brand-light" />
                              Table: {table.table_name}
                            </span>
                            <span className="text-xs font-semibold text-foreground/40 px-2.5 py-0.5 rounded-full border border-surface-border">
                              {table.row_count?.toLocaleString()} rows
                            </span>
                          </div>
                          
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-surface-border/50 text-foreground/40 font-bold">
                                  <th className="text-left py-2 px-3">Column Name</th>
                                  <th className="text-left py-2 px-3">Data Type</th>
                                  <th className="text-center py-2 px-3">Nullable</th>
                                  <th className="text-left py-2 px-3">Distinct Value Snippets</th>
                                </tr>
                              </thead>
                              <tbody>
                                {table.columns.map((col, cIdx) => (
                                  <tr key={cIdx} className="border-b border-surface-border/20 hover:bg-brand/5 transition-colors">
                                    <td className="py-2.5 px-3 font-semibold text-foreground/80 font-mono">{col.column_name}</td>
                                    <td className="py-2.5 px-3 text-brand-light font-mono font-medium">{col.data_type}</td>
                                    <td className="py-2.5 px-3 text-center text-foreground/50">{col.is_nullable ? "Yes" : "No"}</td>
                                    <td className="py-2.5 px-3 text-foreground/45 max-w-[200px] truncate" title={col.sample_values}>
                                      {col.sample_values || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* TAB 2: AI Profile & Stats */}
                {activeDetailTab === "profile" && (
                  <div className="space-y-6">
                    {profileLoading ? (
                      <div className="py-20 flex flex-col items-center justify-center text-foreground/40 gap-2">
                        <Loader2 className="w-8 h-8 text-brand-light animate-spin" />
                        <span className="text-xs font-medium">Running statistical profiling of dataset…</span>
                      </div>
                    ) : !profileData ? (
                      <div className="py-12 text-center text-foreground/35 flex flex-col items-center border border-dashed border-surface-border rounded-2xl">
                        <AlertCircle className="w-8 h-8 text-foreground/20 mb-2" />
                        <p className="text-xs font-medium">Profiling stats not available for this database connection.</p>
                      </div>
                    ) : (
                      <div className="space-y-6 animate-fade-in">
                        <div className="p-4 rounded-xl bg-brand/5 border border-brand/10 flex justify-between items-center">
                          <span className="text-xs font-bold text-foreground/50">DATASET PROFILE METRICS</span>
                          <span className="text-xs font-bold text-brand-light">{profileData.rows?.toLocaleString()} Records Analyzed</span>
                        </div>
                        
                        <div className="overflow-x-auto rounded-2xl border border-surface-border/50">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-[#0b0b10] border-b border-surface-border text-foreground/55 font-bold">
                                <th className="text-left py-3 px-4">Column</th>
                                <th className="text-left py-3 px-4">Type</th>
                                <th className="text-center py-3 px-4">Nulls</th>
                                <th className="text-center py-3 px-4">Unique</th>
                                <th className="text-right py-3 px-4">Mean / Distribution</th>
                              </tr>
                            </thead>
                            <tbody>
                              {profileData.columns?.map((col, idx) => (
                                <tr key={idx} className="border-b border-surface-border/30 hover:bg-brand/5 transition-colors">
                                  <td className="py-3 px-4 font-semibold text-foreground/80 font-mono">{col.name}</td>
                                  <td className="py-3 px-4 font-mono text-brand-light/80">{col.dtype}</td>
                                  <td className="py-3 px-4 text-center">
                                    <span className={col.null_count > 0 ? "text-amber-400" : "text-foreground/40"}>
                                      {col.null_count > 0 ? `${col.null_count} (${Math.round(col.null_pct * 100)}%)` : "0%"}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-center font-medium">{col.unique_count?.toLocaleString()}</td>
                                  <td className="py-3 px-4 text-right">
                                    {col.stats ? (
                                      <div className="inline-flex flex-col text-[10px] text-foreground/60 leading-tight">
                                        <span>mean: <strong className="text-foreground">{col.stats.mean.toLocaleString(undefined, {maximumFractionDigits:2})}</strong></span>
                                        <span>range: <strong className="text-foreground/45">[{col.stats.min.toLocaleString(undefined, {maximumFractionDigits:1})} · {col.stats.max.toLocaleString(undefined, {maximumFractionDigits:1})}]</strong></span>
                                      </div>
                                    ) : col.top_values && col.top_values.length > 0 ? (
                                      <span className="text-[10px] text-foreground/40 truncate max-w-[150px] inline-block" title={col.top_values.map(v => `${v.value} (${v.count})`).join(', ')}>
                                        top: {col.top_values[0].value} ({col.top_values[0].count})
                                      </span>
                                    ) : (
                                      <span className="text-foreground/30">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: Suggested Questions */}
                {activeDetailTab === "prompts" && (
                  <div className="space-y-6">
                    {profileLoading ? (
                      <div className="py-20 flex flex-col items-center justify-center text-foreground/40 gap-2">
                        <Loader2 className="w-8 h-8 text-brand-light animate-spin" />
                        <span className="text-xs font-medium">Generating suggested questions…</span>
                      </div>
                    ) : suggestedQuestions.length === 0 ? (
                      <div className="py-12 text-center text-foreground/35 border border-dashed border-surface-border rounded-2xl flex flex-col items-center">
                        <Sparkles className="w-8 h-8 text-foreground/20 mb-2 animate-pulse" />
                        <p className="text-xs font-medium">Suggested questions not generated yet.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-xs font-bold text-foreground/40 uppercase tracking-wider mb-2">
                          Click any question below to open in the AI Analysis Playground:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {suggestedQuestions.map((q, idx) => (
                            <button
                              key={idx}
                              onClick={() => router.push(`/analysis?dataset=${selectedDataset.id}&query=${encodeURIComponent(q)}`)}
                              className="text-left p-4 rounded-xl border border-surface-border bg-surface/[0.02] hover:border-brand/40 hover:bg-brand/5 hover:text-brand-light text-sm font-semibold transition-all group flex items-start gap-3 justify-between"
                            >
                              <span>{q}</span>
                              <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-brand-light transition-all shrink-0 mt-0.5" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* INGESTION FORM MODAL */}
      <AnimatePresence>
        {showIngestModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg glass-panel max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-surface-border/50">
                <h3 className="text-lg font-display font-bold">Ingest a New Dataset</h3>
                <button 
                  onClick={() => setShowIngestModal(false)}
                  className="p-1 rounded-lg text-foreground/40 hover:bg-surface-hover hover:text-foreground transition-colors"
                >
                  <ChevronRight className="w-5 h-5 rotate-90" />
                </button>
              </div>

              {/* Tabs selector */}
              <div className="flex border-b border-surface-border">
                <button
                  type="button"
                  onClick={() => setActiveIngestTab("file")}
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider text-center transition-colors ${
                    activeIngestTab === "file"
                      ? "border-b-2 border-brand-light text-brand-light"
                      : "text-foreground/40 hover:text-foreground/75"
                  }`}
                >
                  Spreadsheet File
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIngestTab("database")}
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider text-center transition-colors ${
                    activeIngestTab === "database"
                      ? "border-b-2 border-brand-light text-brand-light"
                      : "text-foreground/40 hover:text-foreground/75"
                  }`}
                >
                  Live Connection
                </button>
              </div>

              <div className="p-6">
                {/* FILE UPLOAD PANEL */}
                {activeIngestTab === "file" ? (
                  <div className="space-y-4">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-surface-border hover:border-brand/40 hover:bg-brand/5 rounded-2xl p-12 text-center cursor-pointer flex flex-col items-center justify-center transition-all group"
                    >
                      <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleUpload} />
                      {uploading ? (
                        <Loader2 className="w-12 h-12 text-brand-light animate-spin mb-4" />
                      ) : (
                        <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center mb-4 group-hover:bg-brand/20 transition-colors">
                          <UploadCloud className="w-8 h-8 text-brand-light" />
                        </div>
                      )}
                      <p className="font-semibold text-sm mb-1">{uploading ? "Analyzing & indexing dataset…" : "Select a spreadsheet"}</p>
                      <p className="text-xs text-foreground/45">Supports CSV or Excel files (Max 50MB)</p>
                    </div>

                    {uploadSuccess && (
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {uploadSuccess}
                      </div>
                    )}
                    {uploadError && (
                      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {uploadError}
                      </div>
                    )}
                  </div>
                ) : (
                  // DATABASE FORM PANEL
                  <form onSubmit={handleConnectDb} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Engine Type</label>
                        <select
                          value={dbForm.db_type}
                          onChange={(e) => setDbForm({ ...dbForm, db_type: e.target.value, port: e.target.value === "postgresql" ? 5432 : 3306 })}
                          className="w-full h-11 text-sm bg-[#0F0F16] border border-surface-border rounded-xl px-3 mt-1.5 text-foreground"
                        >
                          <option value="postgresql">PostgreSQL</option>
                          <option value="mysql">MySQL</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Dataset ID Name</label>
                        <Input
                          value={dbForm.dataset_name}
                          onChange={(e) => setDbForm({ ...dbForm, dataset_name: e.target.value })}
                          placeholder="e.g. ecommerce_db"
                          className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Host Address</label>
                        <Input
                          value={dbForm.host}
                          onChange={(e) => setDbForm({ ...dbForm, host: e.target.value })}
                          placeholder="db.example.com or IP"
                          className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Port</label>
                        <Input
                          type="number"
                          value={dbForm.port}
                          onChange={(e) => setDbForm({ ...dbForm, port: Number(e.target.value) })}
                          className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Username</label>
                        <Input
                          value={dbForm.username}
                          onChange={(e) => setDbForm({ ...dbForm, username: e.target.value })}
                          placeholder="postgres"
                          className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Password</label>
                        <Input
                          type="password"
                          value={dbForm.password}
                          onChange={(e) => setDbForm({ ...dbForm, password: e.target.value })}
                          placeholder="••••••••"
                          className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Database Name</label>
                      <Input
                        value={dbForm.database}
                        onChange={(e) => setDbForm({ ...dbForm, database: e.target.value })}
                        placeholder="production_sales"
                        className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                      />
                    </div>

                    {connectDbError && (
                      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {connectDbError}
                      </div>
                    )}
                    {connectDbSuccess && (
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {connectDbSuccess}
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={connectingDb}
                      className="w-full h-12 rounded-xl bg-brand hover:bg-brand/85 text-[#06060A] font-bold shadow-glow"
                    >
                      {connectingDb ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin mr-2" />
                          Testing Connection…
                        </>
                      ) : (
                        <>
                          <Database className="w-5 h-5 mr-2" />
                          Establish Live Connection
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  )
}
