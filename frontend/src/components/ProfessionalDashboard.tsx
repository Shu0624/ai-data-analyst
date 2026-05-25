import React, { useId } from "react"
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from "recharts"
import { TrendingUp, Activity, Lightbulb, BarChart3, PieChart as PieChartIcon, LayoutGrid, Zap } from "lucide-react"
import { GlowCard } from "@/components/ui/GlowCard"

const CHART_COLORS = ["#D4A853", "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#ec4899", "#F0C97B", "#8b5cf6"]

// ── Chart Styles Constants (Fix for infinite render loop) ────
const CHART_TICK_STYLE = { fill: "#ffffff60", fontSize: 11 }
const CHART_MARGINS = { top: 10, right: 10, left: -20, bottom: 0 }
const CHART_MARGINS_HORIZONTAL = { top: 0, right: 10, left: 0, bottom: 0 }
const CHART_YAXIS_TICK_RANK = { fill: "#ffffff90", fontSize: 11, fontWeight: 500 }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatYAxisTick = (val: any) => {
  if (typeof val !== 'number') return val;
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'k';
  return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
};

const formatTextNumbers = (text: string) => {
  if (!text) return "";
  return text.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{4,}(?:\.\d+)?\b/g, (match) => {
    const num = Number(match.replace(/,/g, ''));
    if (isNaN(num)) return match;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  });
};

const formatCellValue = (val: unknown) => {
  if (val == null) return "—";
  if (typeof val === "number") return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof val === "string" && !isNaN(Number(val)) && val.trim() !== "" && val.includes('.')) {
    return Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(val);
};

// ── Types ─────────────────────────────────────────────────────

interface AnalysisData {
  result_preview?: Record<string, unknown>[] | null
  chart_config?: { type: string; data: Record<string, unknown> | Record<string, unknown>[] | null; options?: Record<string, unknown> } | null
  insights?: { text?: string; insight_text?: string; score?: number; importance_score?: number | null }[]
  recommendations?: { text?: string; recommendation_text?: string; score?: number; confidence_score?: number | null }[]
  row_count?: number
  execution_time_ms?: number | null
  confidence_score?: number | null
  generated_sql?: string | null
  user_query?: string
}

interface DerivedStat {
  label: string
  value: string
  detail: string
  icon: React.ElementType
  color: string
  bg: string
}

// ── Helpers ───────────────────────────────────────────────────

function deriveStats(data: Record<string, unknown>[]): DerivedStat[] {
  if (!data.length) return []

  const keys = Object.keys(data[0])
  const numericKeys = keys.filter(k => typeof data[0][k] === "number")
  const stats: DerivedStat[] = []

  stats.push({
    label: "Total Rows",
    value: data.length.toLocaleString(),
    detail: `${keys.length} columns`,
    icon: BarChart3,
    color: "text-brand-light",
    bg: "bg-brand/10",
  })

  for (const k of numericKeys.slice(0, 3)) {
    const values = data.map(r => Number(r[k]) || 0)
    const sum = values.reduce((a, b) => a + b, 0)
    const avg = sum / values.length
    const max = Math.max(...values)
    const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(1)

    stats.push({
      label: `Avg ${k.replace(/_/g, " ")}`,
      value: fmt(avg),
      detail: `max ${fmt(max)} · total ${fmt(sum)}`,
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    })
  }

  return stats.slice(0, 4)
}

function normalizeChartData(config: { data?: unknown; labels?: string[]; datasets?: { label?: string; data: number[] }[] }): { data: Record<string, unknown>[]; xKey: string; yKeys: string[] } {
  if (Array.isArray(config?.data)) {
    const d = config.data as Record<string, unknown>[]
    if (!d.length) return { data: [], xKey: "name", yKeys: [] }
    const keys = Object.keys(d[0])
    const xKey = keys[0]
    const yKeys = keys.filter(k => k !== xKey && typeof d[0][k] === "number")
    return { data: d, xKey, yKeys }
  }

  const raw = config?.data as Record<string, unknown> | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (raw && typeof raw === "object" && Array.isArray((raw as any).labels)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = (raw as any).labels as string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasets = ((raw as any).datasets || []) as { label?: string; data: number[] }[]
    if (!labels.length || !datasets.length) return { data: [], xKey: "name", yKeys: [] }

    const yKeys = datasets.map((ds, i) => ds.label || `value_${i}`)
    const data = labels.map((label, i) => {
      const row: Record<string, unknown> = { name: label }
      datasets.forEach((ds, di) => { row[yKeys[di]] = ds.data?.[i] ?? 0 })
      return row
    })
    return { data, xKey: "name", yKeys }
  }

  return { data: [], xKey: "name", yKeys: [] }
}

// ── Smart column classification helpers ──────────────────────
const ID_PATTERNS = /^(id|_id|prn|roll|reg|enroll|sno|sr|serial|index|uuid|code|key|ref|num|number|no\.|s\.no)$/i
const ID_SUFFIX = /(id|_id|code|number|num|key|ref|prn|roll)$/i

function isLikelyIdColumn(key: string, values: unknown[]): boolean {
  // Check name patterns
  if (ID_PATTERNS.test(key.trim())) return true
  if (ID_SUFFIX.test(key.trim())) return true

  // Check if all values are unique (high cardinality = likely ID)
  const strVals = values.map(v => String(v ?? ""))
  const uniqueRatio = new Set(strVals).size / Math.max(strVals.length, 1)
  if (uniqueRatio > 0.9 && strVals.length > 5) return true

  // Check if values look like long numeric IDs
  if (strVals.every(v => /^\d{6,}$/.test(v))) return true

  return false
}

function pickBestXKey(preview: Record<string, unknown>[]): string | null {
  const keys = Object.keys(preview[0])
  const strKeys = keys.filter(k => typeof preview[0][k] === "string")
  
  // Priority 1: categorical columns with reasonable cardinality (2-30 unique values)
  for (const k of strKeys) {
    if (isLikelyIdColumn(k, preview.map(r => r[k]))) continue
    const uniqueCount = new Set(preview.map(r => String(r[k] ?? ""))).size
    if (uniqueCount >= 2 && uniqueCount <= 30) return k
  }
  
  // Priority 2: any non-ID string column
  for (const k of strKeys) {
    if (!isLikelyIdColumn(k, preview.map(r => r[k]))) return k
  }

  // Priority 3: numeric column with few unique values (like Year, Semester)
  const numKeys = keys.filter(k => typeof preview[0][k] === "number")
  for (const k of numKeys) {
    const uniqueCount = new Set(preview.map(r => r[k])).size
    if (uniqueCount >= 2 && uniqueCount <= 15) return k
  }

  return null
}

function pickBestYKeys(preview: Record<string, unknown>[], xKey: string): string[] {
  const keys = Object.keys(preview[0])
  const numKeys = keys.filter(k => k !== xKey && typeof preview[0][k] === "number")
  
  // Skip columns that look like IDs
  const meaningful = numKeys.filter(k => !isLikelyIdColumn(k, preview.map(r => r[k])))
  
  // Prefer columns with variance (not all same value)
  const withVariance = meaningful.filter(k => {
    const vals = preview.map(r => Number(r[k]) || 0)
    return new Set(vals).size > 1
  })

  return (withVariance.length > 0 ? withVariance : meaningful).slice(0, 2)
}

function autoChartFromPreview(preview: Record<string, unknown>[]): { data: Record<string, unknown>[]; xKey: string; yKeys: string[]; type: string } | null {
  if (!preview.length) return null

  const xKey = pickBestXKey(preview)
  if (!xKey) return null
  
  const yKeys = pickBestYKeys(preview, xKey)
  if (!yKeys.length) return null

  // Determine chart type based on data shape
  const uniqueX = new Set(preview.map(r => String(r[xKey]))).size
  let type: string
  if (uniqueX <= 8 && uniqueX >= 2) type = "pie"
  else if (uniqueX <= 30) type = "bar"
  else type = "area"

  // Aggregate data if X has duplicates (e.g., group by SubjectName → avg Total)
  const grouped = new Map<string, { count: number; sums: Record<string, number> }>()
  for (const row of preview) {
    const key = String(row[xKey] ?? "")
    if (!grouped.has(key)) grouped.set(key, { count: 0, sums: {} })
    const g = grouped.get(key)!
    g.count++
    for (const yk of yKeys) {
      g.sums[yk] = (g.sums[yk] || 0) + (Number(row[yk]) || 0)
    }
  }

  // If we have many duplicate X values, show averages
  const hasDuplicates = grouped.size < preview.length * 0.8
  const chartData = Array.from(grouped.entries()).slice(0, 50).map(([key, g]) => {
    const row: Record<string, unknown> = { [xKey]: key }
    for (const yk of yKeys) {
      row[yk] = hasDuplicates ? Math.round((g.sums[yk] / g.count) * 100) / 100 : g.sums[yk]
    }
    return row
  })

  return { data: chartData, xKey, yKeys, type }
}


const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: unknown; color: string }[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#06060c]/95 backdrop-blur-xl border border-brand/25 p-4 rounded-2xl shadow-glass select-none min-w-[200px] transition-all duration-150">
        <p className="text-brand-light font-display font-semibold text-xs uppercase tracking-wider mb-2.5">{label}</p>
        {payload.map((entry, index) => {
          const displayName = entry.name.length > 12 && /\d/.test(entry.name)
            ? `${entry.name.slice(0, 5)}...${entry.name.slice(-4)}`
            : entry.name
          return (
            <div key={index} className="flex items-center justify-between gap-6 text-xs font-semibold py-1.5 border-t border-white/[0.04] first:border-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: entry.color }} />
                <span className="text-foreground/70 text-xs font-medium truncate max-w-[130px]" title={entry.name}>{displayName}</span>
              </div>
              <span className="text-foreground font-mono font-bold">
                {typeof entry.value === "number" ? entry.value.toLocaleString() : String(entry.value ?? "")}
              </span>
            </div>
          )
        })}
      </div>
    );
  }
  return null;
};

// ── Main Component ────────────────────────────────────────────

export function ProfessionalDashboard({ 
  analysis, 
  isCompact = false 
}: { 
  analysis: AnalysisData,
  isCompact?: boolean 
}) {
  const instanceId = useId().replace(/:/g, "-")
  const preview = analysis.result_preview || []
  const stats = deriveStats(preview as Record<string, unknown>[])
  const insights = (analysis.insights || []).map(i => formatTextNumbers(i.text || i.insight_text || ""))
  const recommendations = (analysis.recommendations || []).map(r => formatTextNumbers(r.text || r.recommendation_text || ""))

  // 1️⃣ Determine primary chart (Area/Wave)
  let chartType = analysis.chart_config?.type || "area"
  if (chartType === "bar" && analysis.chart_config?.data) chartType = "area"
  let chartInfo = analysis.chart_config ? normalizeChartData(analysis.chart_config) : null

  if ((!chartInfo || !chartInfo.data.length) && preview.length) {
    const auto = autoChartFromPreview(preview as Record<string, unknown>[])
    if (auto) {
      chartInfo = { data: auto.data, xKey: auto.xKey, yKeys: auto.yKeys }
      chartType = auto.type
    }
  }

  // Guard: Don't render charts for single-row summary data (e.g. "Summarize dataset")
  const hasEnoughDataForChart = chartInfo && chartInfo.data.length >= 2

  // 2️⃣ Build secondary chart (Donut) — only if primary is NOT already pie AND enough distinct data points
  let donutChart: { data: Record<string, unknown>[]; xKey: string; yKeys: string[]; type: string } | null = null
  if (hasEnoughDataForChart && chartType !== "pie" && chartInfo!.data.length >= 3) {
    const topSlice = chartInfo!.data.slice(0, 6)
    if (topSlice.length >= 3 && chartInfo!.yKeys.length > 0) {
      donutChart = { data: topSlice, xKey: chartInfo!.xKey, yKeys: [chartInfo!.yKeys[0]], type: "pie" }
    }
  }

  // 3️⃣ Build tertiary chart (Horizontal Bar Ranking) — ONLY if we have a SECOND y-key to avoid duplicating the donut
  let barRankChart: { data: Record<string, unknown>[]; xKey: string; yKeys: string[] } | null = null
  if (hasEnoughDataForChart && chartInfo!.yKeys.length >= 2) {
    const targetYKey = chartInfo!.yKeys[1] // Always use the second metric to differentiate from primary/donut
    let validData = chartInfo!.data.filter(d => Boolean(d[chartInfo!.xKey]) && typeof d[targetYKey] === 'number')
    validData = validData.sort((a, b) => Number(a[targetYKey] || 0) - Number(b[targetYKey] || 0)).slice(-5)
    if (validData.length >= 3) {
      barRankChart = { data: validData, xKey: chartInfo!.xKey, yKeys: [targetYKey] }
    }
  }

  // 4️⃣ Build quaternary chart (Radar Comparison) — ONLY if we have 2+ y-keys (multi-metric comparison is the point)
  let radarChart: { data: Record<string, unknown>[]; xKey: string; yKeys: string[] } | null = null
  if (hasEnoughDataForChart && chartInfo!.data.length >= 3 && chartInfo!.yKeys.length >= 2) {
    const radarData = chartInfo!.data.slice(0, 5)
    const activeYKeys = chartInfo!.yKeys.slice(0, 3)
    radarChart = { data: radarData, xKey: chartInfo!.xKey, yKeys: activeYKeys }
  }

  // ── Generate smart descriptions for each chart ──────────────
  const describeMainChart = (): string => {
    if (!chartInfo || !chartInfo.yKeys.length) return "Primary trends and analytics"
    const metrics = chartInfo.yKeys.map(k => k.replace(/_/g, " ")).join(" & ")
    const dimension = chartInfo.xKey.replace(/_/g, " ")
    if (chartType === "pie") return `Proportional breakdown of ${metrics} by ${dimension}`
    if (chartType === "area" || chartType === "line") return `Trend of ${metrics} across ${dimension} (${chartInfo.data.length} data points)`
    return `${metrics} compared across ${dimension}`
  }

  const describeDonutChart = (): string => {
    if (!donutChart || !donutChart.yKeys.length) return "Distribution breakdown"
    const metric = donutChart.yKeys[0].replace(/_/g, " ")
    const dimension = donutChart.xKey.replace(/_/g, " ")
    const count = donutChart.data.length
    return `Share of ${metric} across top ${count} ${dimension} segments`
  }

  const describeBarRank = (): string => {
    if (!barRankChart || !barRankChart.yKeys.length) return "Ranking by value"
    const metric = barRankChart.yKeys[0].replace(/_/g, " ")
    const dimension = barRankChart.xKey.replace(/_/g, " ")
    return `Top ${barRankChart.data.length} ${dimension} ranked by ${metric}`
  }

  const describeRadar = (): string => {
    if (!radarChart || !radarChart.yKeys.length) return "Multi-dimensional comparison"
    const metrics = radarChart.yKeys.map(k => k.replace(/_/g, " ")).join(", ")
    const dimension = radarChart.xKey.replace(/_/g, " ")
    return `Comparing ${metrics} across ${radarChart.data.length} ${dimension} entities`
  }

  return (
    <div className={`flex flex-col animate-fade-in ${isCompact ? "gap-2 pb-2" : "gap-6 pb-10"}`}>

      {/* 🟢 Top Banner Stats */}
      {stats.length > 0 && !isCompact && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, i) => (
            <GlowCard
              key={i}
              glowColor="rgba(212, 168, 83, 0.04)"
              className="p-5 flex items-center justify-between group cursor-default"
            >
              <div>
                <p className="text-foreground/50 text-xs font-semibold uppercase tracking-wider mb-1">{stat.label}</p>
                <h4 className="text-2xl font-bold tracking-tight">{stat.value}</h4>
                <p className="text-xs mt-1 font-medium text-foreground/40">{stat.detail}</p>
              </div>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${stat.bg} group-hover:scale-110 transition-transform duration-300`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </GlowCard>
          ))}
        </div>
      )}

      {/* 🟢 ROW 1: Main Analytics (Wave + Donut) */}
      <div className={isCompact ? "flex flex-col gap-2" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>

        {/* Chart 1: Main Trend / Visualization (Span 2) */}
        {hasEnoughDataForChart && chartInfo && (
          <div className={`${isCompact ? "w-full" : "lg:col-span-2"} ${isCompact ? "p-3" : "p-6"} rounded-2xl bg-surface/[0.02] border border-surface-border flex flex-col`}>
            <div className={`flex justify-between items-center ${isCompact ? "mb-2" : "mb-6"}`}>
              <div>
                <h3 className={`${isCompact ? "text-xs" : "text-lg"} font-display font-bold`}>Data Visualization</h3>
                {!isCompact && <p className="text-xs text-foreground/50">{describeMainChart()}</p>}
              </div>
              <div className="flex items-center gap-2">
                {chartType === "pie" ? <PieChartIcon className={`${isCompact ? "w-3 h-3" : "w-4 h-4"} text-brand-light`} /> : <BarChart3 className={`${isCompact ? "w-3 h-3" : "w-4 h-4"} text-brand-light`} />}
              </div>
            </div>
            <div className={isCompact ? "h-[200px]" : "h-[300px]"}>
              {chartType === "pie" ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartInfo.data} dataKey={chartInfo.yKeys[0]} nameKey={chartInfo.xKey} cx="50%" cy="50%" innerRadius="55%" outerRadius="85%" paddingAngle={4} stroke="none" isAnimationActive={false}>
                      {chartInfo.data.map((_, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : chartType === "area" || chartType === "line" ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartInfo.data} margin={CHART_MARGINS}>
                    <defs>
                      {chartInfo.yKeys.map((yk, i) => (
                        <linearGradient key={yk} id={`${instanceId}-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0}/>
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,168,83,0.08)" vertical={false} />
                    <XAxis dataKey={chartInfo.xKey} stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(val: string) => typeof val === 'string' && val.length > 12 ? val.slice(0, 10) + '…' : val} label={{ value: chartInfo.xKey.replace(/_/g, ' '), position: 'insideBottom', offset: -5, fill: '#ffffff30', fontSize: 10, fontWeight: 600 }} />
                    <YAxis stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} label={{ value: chartInfo.yKeys[0]?.replace(/_/g, ' ') || '', angle: -90, position: 'insideLeft', offset: 15, fill: '#ffffff30', fontSize: 10, fontWeight: 600 }} />
                    <Tooltip content={<CustomTooltip />} />
                    {chartInfo.yKeys.map((yk, i) => (
                      <Area key={yk} type="monotone" dataKey={yk} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={3} fillOpacity={1} fill={`url(#${instanceId}-grad-${i})`} name={yk.replace(/_/g, " ")} isAnimationActive={false} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartInfo.data} margin={CHART_MARGINS}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,168,83,0.08)" vertical={false} />
                    <XAxis dataKey={chartInfo.xKey} stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(val: string) => typeof val === 'string' && val.length > 12 ? val.slice(0, 10) + '…' : val} label={{ value: chartInfo.xKey.replace(/_/g, ' '), position: 'insideBottom', offset: -5, fill: '#ffffff30', fontSize: 10, fontWeight: 600 }} />
                    <YAxis stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} label={{ value: chartInfo.yKeys[0]?.replace(/_/g, ' ') || '', angle: -90, position: 'insideLeft', offset: 15, fill: '#ffffff30', fontSize: 10, fontWeight: 600 }} />
                    <Tooltip content={<CustomTooltip />} cursor={{fill: 'rgba(212,168,83,0.05)'}} />
                    {chartInfo.yKeys.map((yk, i) => (
                      <Bar key={yk} dataKey={yk} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[6, 6, 0, 0]} name={yk.replace(/_/g, " ")} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* Compact fallback: data table when no chart (e.g. text/list queries) */}
        {isCompact && (!chartInfo || chartInfo.data.length === 0) && preview.length > 0 && (
          <div className="w-full p-3 rounded-2xl bg-surface/[0.02] border border-surface-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 mb-2">Results</p>
            <div className="overflow-x-auto max-h-[200px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#06060A]">
                  <tr className="border-b border-surface-border">
                    {Object.keys(preview[0]).slice(0, 6).map(k => (
                      <th key={k} className="text-left py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-foreground/40 whitespace-nowrap">{k.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(preview as Record<string, unknown>[]).slice(0, 15).map((row, i) => (
                    <tr key={i} className="border-b border-surface-border/30 hover:bg-brand/5 transition-colors">
                      {Object.keys(preview[0]).slice(0, 6).map(k => (
                        <td key={k} className="py-1.5 px-2 text-foreground/70 whitespace-nowrap">
                          {formatCellValue(row[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 15 && (
                <p className="text-center text-[10px] text-foreground/30 py-1">+{preview.length - 15} more rows</p>
              )}
            </div>
          </div>
        )}

        {/* Chart 2: Distribution Donut (Span 1) */}
        {donutChart && donutChart.data.length > 0 && !isCompact && (
          <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-display font-bold">Distribution</h3>
                <p className="text-xs text-foreground/50">{describeDonutChart()}</p>
              </div>
            </div>
            <div className="h-[200px] relative">
              {donutChart.type === "pie" ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutChart.data} dataKey={donutChart.yKeys[0]} nameKey={donutChart.xKey} cx="50%" cy="50%" innerRadius="60%" outerRadius="82%" paddingAngle={5} stroke="none" isAnimationActive={false}>
                        {donutChart.data.map((_, index) => <Cell key={`cell-s-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center mt-2 max-h-[48px] overflow-hidden">
                    {donutChart.data.slice(0, 6).map((entry, i) => {
                      const label = String(entry[donutChart!.xKey])
                      const displayLabel = label.length > 10 && /\d/.test(label)
                        ? `${label.slice(0, 4)}...${label.slice(-4)}`
                        : label
                      return (
                        <div key={i} className="flex items-center gap-1.5 text-[10px] font-medium text-foreground/60">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="truncate max-w-[100px]" title={label}>{displayLabel}</span>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={donutChart.data} margin={CHART_MARGINS}>
                    <defs>
                      {donutChart.yKeys.map((yk, i) => (
                        <linearGradient key={yk} id={`${instanceId}-grad-sec-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0}/>
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,168,83,0.08)" vertical={false} />
                    <XAxis dataKey={donutChart.xKey} stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
                    <YAxis stroke="#ffffff40" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    {donutChart.yKeys.map((yk, i) => (
                      <Area key={yk} type="monotone" dataKey={yk} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={3} fillOpacity={1} fill={`url(#${instanceId}-grad-sec-${i})`} name={yk.replace(/_/g, " ")} isAnimationActive={false} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 🟢 ROW 2: Deep Dive (Bar + Radar + Live Feed) */}
      {!isCompact && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Chart 3: Horizontal Ranking */}
          {barRankChart && barRankChart.data.length > 0 && (
            <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-base font-display font-bold flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-brand-light" /> Segment Ranking
                  </h3>
                  <p className="text-[11px] text-foreground/50 mt-1">{describeBarRank()}</p>
                </div>
              </div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barRankChart.data} layout="vertical" margin={CHART_MARGINS_HORIZONTAL}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,168,83,0.04)" horizontal={true} vertical={false} />
                    <XAxis type="number" stroke="#ffffff20" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} hide />
                    <YAxis dataKey={barRankChart.xKey} type="category" stroke="#ffffff40" tick={CHART_YAXIS_TICK_RANK} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<CustomTooltip />} cursor={{fill: 'rgba(212,168,83,0.05)'}} />
                    <Bar dataKey={barRankChart.yKeys[0]} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
                      {barRankChart.data.map((_, i) => <Cell key={`h-bar-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Chart 4: Radar / Spider Comparison */}
          {radarChart && (
            <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-base font-display font-bold flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" /> Multi-metric Analysis
                  </h3>
                  <p className="text-[11px] text-foreground/50 mt-1">{describeRadar()}</p>
                </div>
              </div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarChart.data}>
                    <PolarGrid stroke="#ffffff20" />
                    <PolarAngleAxis dataKey={radarChart.xKey} tick={{ fill: "#ffffff70", fontSize: 10, fontWeight: 500 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    {radarChart.yKeys.map((yk, i) => (
                      <Radar key={yk} name={yk.replace(/_/g, " ")} dataKey={yk} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.3} strokeWidth={2} isAnimationActive={false} />
                    ))}
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* AI Insights */}
          {insights.length > 0 ? (
            <div className={`p-6 rounded-2xl bg-surface/[0.02] border border-surface-border flex flex-col border-t-2 border-t-brand/50 overflow-hidden min-h-0 ${(!barRankChart || !radarChart) ? "lg:col-span-3" : ""}`}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-base font-display font-bold flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-brand-light" /> Insights
                </h3>
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                  <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Live</span>
                </div>
              </div>
              <div className="flex flex-col gap-4 overflow-y-auto pr-2 max-h-[220px] scrollbar-thin">
                {insights.filter(Boolean).map((text, i) => (
                  <div key={i} className="flex items-start gap-4 group p-3 rounded-2xl hover:bg-white/[0.01] border border-transparent hover:border-surface-border transition-all duration-300">
                    <div className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_10px_rgba(212,168,83,0.35)] ${
                      i === 0 ? 'bg-brand-light' : i === 1 ? 'bg-emerald-400' : 'bg-blue-400'
                    }`} />
                    <p className="text-sm text-foreground/70 leading-relaxed group-hover:text-foreground/90 transition-colors">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* 🟢 ROW 3: Recommendations + Data Table */}
      {!isCompact && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
            {/* Recommendations */}
            {recommendations.length > 0 && (
              <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border lg:col-span-2">
                <h3 className="text-base font-display font-bold flex items-center gap-2 mb-5">
                  <Activity className="w-4 h-4 text-emerald-400" /> Strategic Recommendations
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin">
                  {recommendations.filter(Boolean).map((text, i) => (
                    <div key={i} className="flex items-start gap-4 p-5 rounded-2xl bg-gradient-to-br from-white/[0.02] to-white/[0.00] border border-surface-border hover:border-brand/35 hover:shadow-glow transition-all duration-300 min-w-[300px] max-w-[360px] shrink-0 group">
                      <span className="mt-0.5 text-xs font-bold text-[#06060A] bg-primary-gradient rounded-xl min-w-[28px] h-7 flex items-center justify-center shadow-[0_0_15px_rgba(212,168,83,0.25)] shrink-0 group-hover:scale-105 transition-transform duration-300">
                        {i + 1}
                      </span>
                      <p className="text-sm text-foreground/80 leading-relaxed font-medium">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 🟢 Data Table Preview */}
          {preview.length > 0 && (
            <div className="p-6 rounded-2xl bg-surface/[0.02] border border-surface-border overflow-hidden mt-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-base font-display font-bold">Data Preview</h3>
                  <p className="text-xs text-foreground/40 mt-0.5">{Object.keys(preview[0]).length} columns · {preview.length} rows returned</p>
                </div>
                <span className="text-xs text-foreground/30 font-medium px-3 py-1 rounded-full border border-surface-border">{preview.length <= 500 ? "All rows" : `Top 500 of ${preview.length}`}</span>
              </div>

              {/* Single-row aggregate result: show as prominent metric cards */}
              {preview.length === 1 && Object.keys(preview[0]).length <= 4 ? (
                <div className={`grid gap-4 ${Object.keys(preview[0]).length === 1 ? "grid-cols-1" : Object.keys(preview[0]).length === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
                  {Object.entries(preview[0]).map(([key, val]) => (
                    <div key={key} className="p-6 rounded-xl bg-surface/10 border border-brand/20 text-center group hover:border-brand/40 transition-all">
                      <p className="text-[10px] uppercase tracking-widest text-foreground/40 font-bold mb-2">{key.replace(/_/g, " ")}</p>
                      <p className={`font-bold tracking-tight ${String(val).length > 10 ? "text-2xl" : "text-4xl"} text-transparent bg-clip-text bg-gradient-to-r from-brand-light to-brand`}>
                        {typeof val === "number" ? val.toLocaleString() : String(val ?? "—")}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[#06060A] z-10 box-shadow-bottom relative">
                      <tr className="border-b border-surface-border">
                        {Object.keys(preview[0]).map(key => (
                          <th key={key} className="text-left py-4 px-4 text-xs font-bold uppercase tracking-wider text-foreground/50 whitespace-nowrap bg-[#06060A]">
                            {key.replace(/_/g, " ")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(preview as Record<string, unknown>[]).slice(0, 500).map((row, i) => (
                        <tr key={i} className="border-b border-surface-border/50 hover:bg-brand/5 transition-colors">
                          {Object.keys(preview[0]).map(key => (
                            <td key={key} className="py-3 px-4 text-foreground/70 whitespace-nowrap font-medium">
                              {typeof row[key] === "number" ? Number(row[key]).toLocaleString() : String(row[key] ?? "—")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.length > 500 && (
                    <div className="py-2 text-center text-xs text-foreground/30 border-t border-surface-border/30">
                      +{preview.length - 500} more rows not shown
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
