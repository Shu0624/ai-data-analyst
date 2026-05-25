"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import {
  MessageCircle, Loader2, Plus, Smartphone,
  Users, BarChart3, Clock, TrendingUp,
  User, Bot, ShieldCheck,
  Building, Send, ChevronRight, X
} from "lucide-react"
import { api } from "@/lib/api"
import { motion, AnimatePresence } from "framer-motion"

interface ClientResponse {
  id: string
  business_name: string
  niche: string
  whatsapp_number: string
  document_id: string | null
  greeting_message: string | null
  is_active: boolean
  lead_count: number
  created_at: string
}

interface LeadResponse {
  id: string
  client_id: string
  phone: string
  name: string | null
  interest: string | null
  status: string
  source: string
  lead_score: number | null
  message_count: number
  created_at: string
  last_message_at: string | null
}

interface LeadMessageResponse {
  id: string
  lead_id: string
  direction: string // inbound / outbound
  message_text: string
  message_type: string // text / button / button_reply / image / template
  created_at: string
}

interface DocumentOption {
  id: string
  document_name: string
}

interface ClientAnalytics {
  total_leads: number
  new_leads_today: number
  new_leads_week: number
  leads_by_status: Record<string, number>
  conversion_rate: number
  top_interests: { interest: string; count: number }[]
}

export default function WhatsAppCRMPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "clients" | "leads">("overview")

  // Data states
  const [clients, setClients] = useState<ClientResponse[]>([])
  const [selectedClient, setSelectedClient] = useState<ClientResponse | null>(null)
  
  const [leads, setLeads] = useState<LeadResponse[]>([])
  const [selectedLead, setSelectedLead] = useState<LeadResponse | null>(null)
  const [messages, setMessages] = useState<LeadMessageResponse[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [analytics, setAnalytics] = useState<ClientAnalytics | null>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)

  // Document options for binding
  const [documents, setDocuments] = useState<DocumentOption[]>([])

  // Modal states
  const [showAddClientModal, setShowAddClientModal] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientForm, setClientForm] = useState({
    business_name: "",
    niche: "gym",
    whatsapp_number: "",
    document_id: "",
    greeting_message: ""
  })
  const [addClientError, setAddClientError] = useState("")

  // Lead status updates
  const [updatingLeadStatus, setUpdatingLeadStatus] = useState(false)

  // Message Sending (Testing / CRM replies)
  const [crmReplyText, setCrmReplyText] = useState("")
  const [sendingCrmReply, setSendingCrmReply] = useState(false)



  const loadClients = useCallback(async () => {
    try {
      const res = await api.get("/whatsapp/clients")
      setClients(res.data)
    } catch (err) {
      console.error("Failed to load clients", err)
    }
  }, [])

  const loadDocuments = useCallback(async () => {
    try {
      const res = await api.get("/documents/")
      setDocuments(res.data)
    } catch (err) {
      console.error("Failed to load documents", err)
    }
  }, [])

  // Handle client selection
  const handleSelectClient = useCallback(async (client: ClientResponse) => {
    setSelectedClient(client)
    setSelectedLead(null)
    setMessages([])
    setLeads([])
    
    // Load leads for selected client
    try {
      const leadsRes = await api.get(`/whatsapp/clients/${client.id}/leads`)
      setLeads(leadsRes.data)
    } catch (err) {
      console.error("Failed to load client leads", err)
    }

    // Load analytics for selected client
    setLoadingAnalytics(true)
    try {
      const analRes = await api.get(`/whatsapp/clients/${client.id}/analytics`)
      setAnalytics(analRes.data)
    } catch (err) {
      console.error("Failed to load client analytics", err)
    } finally {
      setLoadingAnalytics(false)
    }
  }, [])

  // Handle lead selection
  const handleSelectLead = useCallback(async (lead: LeadResponse) => {
    setSelectedLead(lead)
    setLoadingMessages(true)
    setMessages([])
    
    try {
      const msgsRes = await api.get(`/whatsapp/leads/${lead.id}/messages`)
      setMessages(msgsRes.data)
    } catch (err) {
      console.error("Failed to load lead messages", err)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  // Load initial data
  useEffect(() => {
    loadClients()
    loadDocuments()
  }, [loadClients, loadDocuments])

  // Auto-select client and load associated data when clients load
  useEffect(() => {
    if (clients.length > 0 && !selectedClient) {
      handleSelectClient(clients[0])
    }
  }, [clients, selectedClient, handleSelectClient])

  // Handle client creation
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientForm.business_name || !clientForm.whatsapp_number) {
      setAddClientError("Please fill in business name and phone number.")
      return
    }

    setCreatingClient(true)
    setAddClientError("")
    
    const payload = {
      business_name: clientForm.business_name,
      niche: clientForm.niche,
      whatsapp_number: clientForm.whatsapp_number,
      document_id: clientForm.document_id || null,
      greeting_message: clientForm.greeting_message || null
    }

    try {
      await api.post("/whatsapp/clients", payload)
      await loadClients()
      setShowAddClientModal(false)
      setClientForm({
        business_name: "",
        niche: "gym",
        whatsapp_number: "",
        document_id: "",
        greeting_message: ""
      })
    } catch (err: unknown) {
      const errResponse = err as { response?: { data?: { detail?: string } } };
      setAddClientError(errResponse.response?.data?.detail || "Failed to create client. Verify fields.")
    } finally {
      setCreatingClient(false)
    }
  }

  // Update lead status
  const handleUpdateLeadStatus = async (status: string) => {
    if (!selectedLead) return
    setUpdatingLeadStatus(true)
    try {
      const res = await api.put(`/whatsapp/leads/${selectedLead.id}`, { status })
      // Update local state
      setSelectedLead(prev => prev ? { ...prev, status: res.data.status } : null)
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, status: res.data.status } : l))
      // Refresh analytics
      if (selectedClient) {
        const analRes = await api.get(`/whatsapp/clients/${selectedClient.id}/analytics`)
        setAnalytics(analRes.data)
      }
    } catch (err) {
      console.error("Failed to update status", err)
    } finally {
      setUpdatingLeadStatus(false)
    }
  }

  // Send a manual reply through CRM (calls backend verify / test-send endpoint)
  const handleSendCrmReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLead || !crmReplyText.trim() || sendingCrmReply) return
    
    setSendingCrmReply(true)
    const reply = crmReplyText.trim()
    setCrmReplyText("")
    
    try {
      // Simulate real-time outbound reply logs.
      // Wait, in backend, test-send calls the send_text_message Cloud API
      await api.post(`/whatsapp/test-send`, null, {
        params: {
          phone: selectedLead.phone,
          message: reply
        }
      })
      
      // Load updated messages
      const msgsRes = await api.get(`/whatsapp/leads/${selectedLead.id}/messages`)
      setMessages(msgsRes.data)
    } catch (err) {
      console.error("Failed to send CRM reply", err)
      alert("Failed to send message via WhatsApp Business Cloud API.")
    } finally {
      setSendingCrmReply(false)
    }
  }

  return (
    <div className="space-y-10 animate-fade-in pb-20">
      
      {/* Header and Client selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-surface-border/50 pb-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2 flex items-center gap-3">
            <MessageCircle className="w-9 h-9 text-brand-light" />
            WhatsApp Chatbot CRM
          </h1>
          <p className="text-foreground/60 text-lg">
            Monitor captured leads, view analytics, and inspect conversations captured by AI.
          </p>
        </div>
        
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-foreground/45" />
            <select
              value={selectedClient?.id || ""}
              onChange={(e) => {
                const found = clients.find(c => c.id === e.target.value)
                if (found) handleSelectClient(found)
              }}
              className="h-11 text-xs bg-[#0F0F16] border border-surface-border rounded-xl px-3 text-foreground font-bold"
            >
              {clients.length === 0 ? (
                <option value="">No Registered Businesses</option>
              ) : (
                clients.map(c => (
                  <option key={c.id} value={c.id}>{c.business_name} ({c.whatsapp_number})</option>
                ))
              )}
            </select>
          </div>
          
          <Button 
            variant="brand" 
            onClick={() => {
              setAddClientError("")
              setShowAddClientModal(true)
            }}
            className="h-11 px-4 rounded-xl font-bold shadow-glow hover:scale-105 transition-all"
          >
            <Plus className="w-4 h-4 mr-2" /> Configure Business
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-border/50 pb-4">
        {(["overview", "clients", "leads"] as const).map((tab) => {
          const labelMap = { overview: "Analytics Overview", clients: "Business Profiles", leads: "CRM Leads & Live Chat" }
          const iconMap = { overview: BarChart3, clients: Smartphone, leads: Users }
          const Icon = iconMap[tab]
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border flex items-center gap-2 ${
                activeTab === tab
                  ? "bg-brand/10 border-brand-light/40 text-brand-light shadow-sm"
                  : "border-transparent text-foreground/40 hover:text-foreground/75 hover:bg-surface-hover"
              }`}
            >
              <Icon className="w-4 h-4" />
              {labelMap[tab]}
            </button>
          )
        })}
      </div>

      {/* Main Tab Views */}
      <div className="grid grid-cols-1 gap-8">
        
        {/* ========================================================
            TAB 1: Overview & Analytics
            ======================================================== */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {!selectedClient ? (
              <div className="py-20 text-center text-foreground/40 border border-dashed border-surface-border rounded-3xl bg-surface/[0.01]">
                <Smartphone className="w-12 h-12 text-foreground/10 mx-auto mb-3" />
                <p className="text-sm font-semibold">No configured businesses found</p>
                <p className="text-xs text-foreground/30 mt-1">Configure your business to unlock lead capture tracking.</p>
              </div>
            ) : loadingAnalytics ? (
              <div className="py-24 flex flex-col items-center justify-center text-foreground/40 gap-2">
                <Loader2 className="w-8 h-8 text-brand-light animate-spin" />
                <span className="text-xs font-medium">Computing analytics aggregates…</span>
              </div>
            ) : !analytics ? (
              <p className="text-center text-xs text-foreground/40 py-12">Failed to load analytics summaries.</p>
            ) : (
              <div className="space-y-8 animate-fade-in">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border hover:border-brand/20 transition-all flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 mb-1">Total Captured Leads</p>
                      <h4 className="text-3xl font-bold tracking-tight">{analytics.total_leads}</h4>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-brand/5 border border-brand/10 flex items-center justify-center shrink-0">
                      <Users className="w-5 h-5 text-brand-light" />
                    </div>
                  </div>

                  <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border hover:border-brand/20 transition-all flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 mb-1">New Leads (Today)</p>
                      <h4 className="text-3xl font-bold tracking-tight">{analytics.new_leads_today}</h4>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-emerald-400" />
                    </div>
                  </div>

                  <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border hover:border-brand/20 transition-all flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 mb-1">Leads (This Week)</p>
                      <h4 className="text-3xl font-bold tracking-tight">{analytics.new_leads_week}</h4>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/5 border border-cyan-500/10 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-5 h-5 text-cyan-400" />
                    </div>
                  </div>

                  <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border hover:border-brand/20 transition-all flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 mb-1">Conversion Rate</p>
                      <h4 className="text-3xl font-bold tracking-tight text-brand-light">{analytics.conversion_rate}%</h4>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-brand/5 border border-brand/10 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-5 h-5 text-brand-light" />
                    </div>
                  </div>
                </div>

                {/* Subcharts */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Status counts card */}
                  <Card className="col-span-2">
                    <CardHeader className="pb-3 border-b border-surface-border/50">
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <Users className="w-4 h-4 text-brand-light" /> Leads Breakdown by Pipeline Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {["new", "contacted", "qualified", "converted", "lost"].map((st) => {
                          const count = analytics.leads_by_status[st] || 0
                          const bgMap: Record<string, string> = {
                            new: "bg-blue-500/10 text-blue-400 border-blue-500/25",
                            contacted: "bg-amber-500/10 text-amber-400 border-amber-500/25",
                            qualified: "bg-purple-500/10 text-purple-400 border-purple-500/25",
                            converted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
                            lost: "bg-red-500/10 text-red-400 border-red-500/25"
                          }
                          return (
                            <div key={st} className={`p-4 rounded-xl border ${bgMap[st]} text-center`}>
                              <span className="text-[10px] font-bold uppercase tracking-widest">{st}</span>
                              <h5 className="text-3xl font-extrabold mt-2 tracking-tight">{count}</h5>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Top interests card */}
                  <Card className="col-span-1">
                    <CardHeader className="pb-3 border-b border-surface-border/50">
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-cyan-400" /> Top Customer Intent Fields
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      {analytics.top_interests.length === 0 ? (
                        <p className="text-xs text-foreground/35 py-10 text-center">No lead interests captured by AI yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {analytics.top_interests.map((int, i) => (
                            <div key={i} className="flex justify-between items-center border-b border-surface-border/20 pb-2">
                              <span className="text-sm font-semibold capitalize text-foreground/80">{int.interest}</span>
                              <span className="text-xs font-bold text-foreground/45 bg-surface border border-surface-border px-2 py-0.5 rounded-full">
                                {int.count} captured
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 2: Client/Business Profiles
            ======================================================== */}
        {activeTab === "clients" && (
          <div className="space-y-6 animate-fade-in">
            {clients.length === 0 ? (
              <div className="py-20 text-center text-foreground/40 border border-dashed border-surface-border rounded-3xl bg-surface/[0.01]">
                <Smartphone className="w-12 h-12 text-foreground/10 mx-auto mb-3" />
                <p className="text-sm font-semibold">No configured business profiles</p>
                <p className="text-xs text-foreground/30 mt-1">Configure your business to run the WhatsApp chatbot.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {clients.map((c) => {
                  const doc = documents.find(d => d.id === c.document_id)
                  return (
                    <Card key={c.id} className="border-brand/10 bg-surface/[0.01] hover:border-brand/35 transition-all">
                      <CardHeader className="pb-3 border-b border-surface-border/50">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base font-bold flex items-center gap-2">
                            <Building className="w-4.5 h-4.5 text-brand-light" />
                            {c.business_name}
                          </CardTitle>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            c.is_active ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-foreground/30 border-surface-border"
                          }`}>
                            {c.is_active ? "active" : "inactive"}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-5 space-y-4 text-sm">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-foreground/40 font-semibold uppercase">WhatsApp Number</span>
                          <span className="font-bold text-foreground/80 font-mono">{c.whatsapp_number}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-foreground/40 font-semibold uppercase">Business Niche</span>
                          <span className="font-bold text-brand-light bg-brand/5 border border-brand/10 px-2 py-0.5 rounded capitalize">
                            {c.niche}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-foreground/40 font-semibold uppercase">Associated FAQ PDF</span>
                          <span className="font-bold text-foreground/70">{doc ? doc.document_name : "Groq Fallback Only"}</span>
                        </div>
                        <div className="flex justify-between items-start text-xs border-t border-surface-border/20 pt-3 flex-col gap-1.5">
                          <span className="text-foreground/40 font-semibold uppercase">Custom Greeting Message</span>
                          <p className="text-xs text-foreground/60 leading-relaxed italic bg-surface/5 p-3 border border-surface-border/50 rounded-xl w-full">
                            {c.greeting_message || `Welcome to ${c.business_name}! 👋\nHow can we help you today?`}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 3: Leads CRM & Live Chat
            ======================================================== */}
        {activeTab === "leads" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start animate-fade-in">
            
            {/* LEADS LIST: Takes 5 cols */}
            <Card className="xl:col-span-5 h-[620px] flex flex-col bg-surface/[0.01]">
              <CardHeader className="pb-3 border-b border-surface-border/50">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Users className="w-4.5 h-4.5 text-brand-light" />
                  Captured Leads ({leads.length})
                </CardTitle>
              </CardHeader>
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 scrollbar-thin">
                {leads.length === 0 ? (
                  <p className="text-center text-xs text-foreground/35 py-20">No leads captured yet for this business.</p>
                ) : (
                  leads.map((l) => (
                    <div
                      key={l.id}
                      onClick={() => handleSelectLead(l)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer relative flex items-center gap-3 ${
                        selectedLead?.id === l.id
                          ? "border-brand-light/50 bg-brand/10"
                          : "border-surface-border hover:border-brand/35 hover:bg-surface/[0.04]"
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        selectedLead?.id === l.id ? "bg-brand/20" : "bg-surface border border-surface-border"
                      }`}>
                        <User className={`w-4 h-4 ${selectedLead?.id === l.id ? "text-brand-light" : "text-foreground/50"}`} />
                      </div>
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-sm font-bold truncate">{l.name || l.phone}</p>
                        <p className="text-[11px] text-foreground/45 mt-0.5 font-mono">{l.phone}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.25 rounded border ${
                            l.status === "new" ? "text-blue-400 bg-blue-500/10 border-blue-500/20" :
                            l.status === "contacted" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                            l.status === "qualified" ? "text-purple-400 bg-purple-500/10 border-purple-500/20" :
                            l.status === "converted" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                            "text-red-400 bg-red-500/10 border-red-500/20"
                          }`}>{l.status}</span>
                          
                          {l.interest && (
                            <span className="text-[10px] text-brand-light font-semibold capitalize truncate max-w-[80px]">
                              {l.interest}
                            </span>
                          )}
                        </div>
                      </div>
                      {selectedLead?.id === l.id && (
                        <ChevronRight className="w-4 h-4 text-brand-light shrink-0" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* CHAT TRANSCRIPT & ACTION: Takes 7 cols */}
            <div className="xl:col-span-7 h-[620px] flex flex-col">
              {!selectedLead ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-surface-border rounded-3xl p-12 bg-surface/[0.01]">
                  <MessageCircle className="w-14 h-14 text-foreground/15 mb-3" />
                  <h3 className="text-sm font-bold text-foreground/40">Select a CRM lead</h3>
                  <p className="text-xs text-foreground/30 mt-1 max-w-xs">
                    Choose a lead from the panel on the left to inspect customer profile metrics and open the live conversation transcript.
                  </p>
                </div>
              ) : (
                <Card className="flex-1 flex flex-col border-brand/10 overflow-hidden bg-surface/[0.01]">
                  {/* Lead Profile Header */}
                  <CardHeader className="pb-3 border-b border-surface-border/50 bg-[#06060A]/50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                          <User className="w-4.5 h-4.5 text-brand-light" />
                          Lead Profile: {selectedLead.name || selectedLead.phone}
                        </CardTitle>
                        <p className="text-[10px] text-foreground/45 mt-0.5">
                          Phone: <span className="font-mono">{selectedLead.phone}</span> · Captured: {new Date(selectedLead.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      
                      {/* Status selectors */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-foreground/35 uppercase">Status:</span>
                        <select
                          value={selectedLead.status}
                          disabled={updatingLeadStatus}
                          onChange={(e) => handleUpdateLeadStatus(e.target.value)}
                          className="h-8 text-xs bg-[#0F0F16] border border-surface-border rounded-lg px-2 text-foreground font-bold"
                        >
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="qualified">Qualified</option>
                          <option value="converted">Converted</option>
                          <option value="lost">Lost</option>
                        </select>
                      </div>
                    </div>
                  </CardHeader>

                  {/* Message Stream */}
                  <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin bg-surface/[0.01]">
                    {loadingMessages ? (
                      <div className="py-20 flex flex-col items-center justify-center text-foreground/40 gap-2">
                        <Loader2 className="w-6 h-6 text-brand-light animate-spin" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Syncing chat log…</span>
                      </div>
                    ) : messages.length === 0 ? (
                      <p className="text-center text-xs text-foreground/30 py-20">Conversation logs empty.</p>
                    ) : (
                      messages.map((m) => {
                        const isInbound = m.direction === "inbound"
                        return (
                          <div key={m.id} className={`flex items-start gap-2.5 max-w-[85%] ${isInbound ? "" : "ml-auto flex-row-reverse"}`}>
                            {/* Avatar */}
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center border shrink-0 mt-0.5 ${
                              isInbound ? "bg-surface border-surface-border text-foreground/40" : "bg-brand/10 border-brand/20 text-brand"
                            }`}>
                              {isInbound ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                            </div>
                            
                            {/* Bubble */}
                            <div className={`p-3 rounded-2xl text-xs leading-relaxed ${
                              isInbound 
                                ? "bg-[#09090E] border border-surface-border/50 text-foreground/80 rounded-tl-none" 
                                : "bg-brand/10 border border-brand/20 text-foreground/90 rounded-tr-none"
                            }`}>
                              <p className="whitespace-pre-wrap">{m.message_text}</p>
                              <span className="text-[8px] text-foreground/30 block mt-1.5 text-right">
                                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* Outbound sending testing bar */}
                  <div className="p-3 border-t border-surface-border/50 bg-[#06060A]/50">
                    <form onSubmit={handleSendCrmReply} className="flex gap-2">
                      <Input
                        value={crmReplyText}
                        onChange={(e) => setCrmReplyText(e.target.value)}
                        placeholder="Type a manual reply message via Cloud API..."
                        className="h-10 text-xs rounded-xl border-surface-border bg-surface/[0.02] focus:bg-surface/[0.05] focus:border-brand-light/35"
                        disabled={sendingCrmReply || loadingMessages}
                      />
                      <Button
                        type="submit"
                        variant="brand"
                        className="h-10 px-4 rounded-xl font-bold shadow-glow"
                        disabled={!crmReplyText.trim() || sendingCrmReply || loadingMessages}
                      >
                        {sendingCrmReply ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </form>
                  </div>
                </Card>
              )}
            </div>

          </div>
        )}

      </div>

      {/* CONFIGURE CLIENT MODAL */}
      <AnimatePresence>
        {showAddClientModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md glass-panel"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-surface-border/50">
                <h3 className="text-lg font-display font-bold">Configure WhatsApp Business</h3>
                <button 
                  onClick={() => setShowAddClientModal(false)}
                  className="p-1 rounded-lg text-foreground/40 hover:bg-surface-hover hover:text-foreground transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleCreateClient} className="p-6 space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Business name</label>
                  <Input
                    value={clientForm.business_name}
                    onChange={(e) => setClientForm({ ...clientForm, business_name: e.target.value })}
                    placeholder="e.g. Max Fitness Studio"
                    className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Niche Category</label>
                    <select
                      value={clientForm.niche}
                      onChange={(e) => setClientForm({ ...clientForm, niche: e.target.value })}
                      className="w-full h-11 text-sm bg-[#0F0F16] border border-surface-border rounded-xl px-3 mt-1.5 text-foreground"
                    >
                      <option value="gym">Gym & Fitness</option>
                      <option value="clinic">Clinic & Health</option>
                      <option value="coaching">Classes & Coaching</option>
                      <option value="realestate">Real Estate</option>
                      <option value="d2c">D2C Shopping</option>
                      <option value="other">Other Business</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">WhatsApp Number</label>
                    <Input
                      value={clientForm.whatsapp_number}
                      onChange={(e) => setClientForm({ ...clientForm, whatsapp_number: e.target.value })}
                      placeholder="e.g. 15556447104"
                      className="h-11 mt-1.5 rounded-xl bg-[#0F0F16]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Bind FAQ Knowledge PDF</label>
                  <select
                    value={clientForm.document_id}
                    onChange={(e) => setClientForm({ ...clientForm, document_id: e.target.value })}
                    className="w-full h-11 text-sm bg-[#0F0F16] border border-surface-border rounded-xl px-3 mt-1.5 text-foreground"
                  >
                    <option value="">No Document Bind (Use Groq fallbacks)</option>
                    {documents.map(d => (
                      <option key={d.id} value={d.id}>{d.document_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Custom welcome greeting (Optional)</label>
                  <textarea
                    value={clientForm.greeting_message}
                    onChange={(e) => setClientForm({ ...clientForm, greeting_message: e.target.value })}
                    placeholder="Welcome to our business! How can we assist you today?"
                    rows={2}
                    className="w-full text-sm bg-[#0F0F16] border border-surface-border rounded-xl p-3 mt-1.5 text-foreground focus:outline-none focus:border-brand-light/30 transition-colors placeholder:text-foreground/20"
                  />
                </div>

                {addClientError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                    {addClientError}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={creatingClient}
                  className="w-full h-12 rounded-xl bg-brand hover:bg-brand/85 text-[#06060A] font-bold shadow-glow"
                >
                  {creatingClient ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Creating configuration…
                    </>
                  ) : (
                    <>
                      <Smartphone className="w-5 h-5 mr-2" />
                      Save Integration Profile
                    </>
                  )}
                </Button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  )
}
