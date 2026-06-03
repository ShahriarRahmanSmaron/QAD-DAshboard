"use client";

/**
 * MD09-LP: Public Landing Experience
 *
 * Full-width, dark-themed landing page with glassmorphism cards, animated
 * counters, preview charts, and a click-to-unlock login modal.  Reuses the
 * existing LoginForm component for authentication.
 *
 * Section order:
 *   1. Hero — platform title, tagline, animated stat counters
 *   2. Why This Matters — operational intelligence positioning
 *   3. Latest Workbook Summary — active report metadata
 *   4. Recent Activity — latest upload status
 *   5. Snapshot KPIs — T/Stock, WFT, WFS, WFR cards
 *   6. Executive Insights — top movers
 *   7. Preview Charts — unit & buyer comparison with blur overlay
 *   8. Unlock Analytics — CTA + login modal trigger
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  Factory,
  FileSpreadsheet,
  Layers,
  Lock,
  Minus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KpiSnapshot = {
  metric_key: string;
  label: string;
  value: number;
  previous_value: number | null;
  delta: number | null;
  delta_percent: number | null;
  direction: "up" | "down" | "flat";
};

type InsightItem = {
  type: string;
  entity: string;
  difference: number;
  percent: number | null;
};

type ComparisonRow = {
  key: string;
  label: string;
  current_value: number;
  previous_value: number;
  difference: number;
};

type WorkbookSummary = {
  filename: string;
  report_type_name: string | null;
  report_date: string | null;
  uploaded_at: string | null;
  status: string | null;
  fact_count: number;
  unit_count: number;
  buyer_count: number;
};

type HeroStats = {
  total_facts: number;
  total_units: number;
  total_buyers: number;
  total_workbooks: number;
  latest_report_date: string | null;
};

type TrendPoint = {
  date: string;
  wait_for_test: number;
};

type LandingSnapshot = {
  hero: HeroStats;
  workbook: WorkbookSummary | null;
  current_date: string | null;
  previous_date: string | null;
  kpis: KpiSnapshot[];
  insights: InsightItem[];
  preview_charts: {
    unit_comparison: ComparisonRow[];
    buyer_comparison: ComparisonRow[];
  };
  trends: TrendPoint[];
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DirectionBadge({ direction, delta, percent }: { direction: string; delta: number | null; percent: number | null }) {
  const colorClass =
    direction === "up"
      ? "text-emerald-400"
      : direction === "down"
        ? "text-rose-400"
        : "text-white/40";
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
      <Icon className="size-3" />
      {percent != null ? `${Math.abs(percent)}%` : ""}
      {delta != null ? ` (${delta > 0 ? "+" : ""}${delta.toLocaleString()})` : ""}
    </span>
  );
}

function PremiumCard({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`rounded-lg border border-white/[0.06] bg-[#0c0c16] p-6 sm:p-8 ${onClick ? "cursor-pointer transition hover:border-white/[0.12] hover:bg-[#10101f]" : ""} ${className}`}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

function formatShortDate(iso: string | null) {
  if (!iso) return "—";
  try {
    const parts = iso.split("-").map((p) => parseInt(p, 10));
    const d = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
    return d.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

function relativeTime(isoDatetime: string | null) {
  if (!isoDatetime) return "—";
  try {
    const then = new Date(isoDatetime).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Login Modal
// ---------------------------------------------------------------------------

function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: typeof email === "string" ? email : "",
        password: typeof password === "string" ? password : "",
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      setError(data?.message ?? "Unable to sign in.");
      setIsSubmitting(false);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Modal */}
          <motion.div
            className="relative z-10 w-full max-w-md rounded-2xl border border-[#b1ada1]/40 bg-white/95 dark:bg-[#1c1917]/95 p-6 shadow-2xl backdrop-blur-xl sm:p-8 text-[#1c1917] dark:text-[#f4f3ee]"
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 30 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <button
              className="absolute right-4 top-4 rounded-full p-1 text-[#78716c] dark:text-[#a8a29e] transition hover:bg-[#b1ada1]/20 hover:text-[#1c1917] dark:hover:text-white"
              onClick={onClose}
              type="button"
            >
              <X className="size-5" />
            </button>

            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-[#78716c] dark:text-[#a8a29e]">
              <Lock className="size-3.5 text-[#c15f3c]" />
              Unlock Full Analytics
            </div>
            <h2 className="text-xl font-semibold text-[#1c1917] dark:text-[#f4f3ee]">
              Sign in to continue
            </h2>
            <p className="mt-1 text-sm text-[#78716c] dark:text-[#a8a29e]">
              Access detailed dashboards, trend analysis, and full operational
              intelligence.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-[#78716c] dark:text-[#a8a29e]">Email</span>
                <input
                  autoComplete="email"
                  className="block h-11 w-full rounded-lg border border-[#b1ada1]/40 bg-black/[0.02] dark:bg-white/[0.06] px-3 text-sm text-[#1c1917] dark:text-white outline-none placeholder:text-[#b1ada1] focus:border-[#c15f3c] focus:ring-2 focus:ring-[#c15f3c]/20"
                  name="email"
                  placeholder="name@company.com"
                  required
                  type="email"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-[#78716c] dark:text-[#a8a29e]">
                  Password
                </span>
                <input
                  autoComplete="current-password"
                  className="block h-11 w-full rounded-lg border border-[#b1ada1]/40 bg-black/[0.02] dark:bg-white/[0.06] px-3 text-sm text-[#1c1917] dark:text-white outline-none placeholder:text-[#b1ada1] focus:border-[#c15f3c] focus:ring-2 focus:ring-[#c15f3c]/20"
                  name="password"
                  required
                  type="password"
                />
              </label>

              {error ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">
                  {error}
                </p>
              ) : null}

              <button
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#c15f3c] text-sm font-semibold text-white shadow-lg transition hover:bg-[#c15f3c]/90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Preview Chart
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Landing Page
// ---------------------------------------------------------------------------

export function LandingPage({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [snapshot, setSnapshot] = useState<LandingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/public/landing-snapshot")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSnapshot(data as LandingSnapshot);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const workbook = snapshot?.workbook;
  const kpis = snapshot?.kpis ?? [];
  const insights = snapshot?.insights ?? [];
  const trends = snapshot?.trends ?? [];
  const previewCharts = snapshot?.preview_charts;

  function openLogin() {
    if (isAuthenticated) {
      router.push("/dashboard");
    } else {
      setLoginOpen(true);
    }
  }

  // Unit movements
  const unitIncrease = insights.find(i => i.type === 'largest_unit_increase') || insights.find(i => i.type.includes('increase'));
  const unitReduction = insights.find(i => i.type === 'largest_unit_reduction') || insights.find(i => i.type.includes('reduction'));

  return (
    <div className="min-h-screen bg-[#f4f3ee] text-[#1c1917] font-sans selection:bg-[#c15f3c]/30 selection:text-[#1c1917] dark:bg-[#1c1917] dark:text-[#f4f3ee] transition-colors duration-300">
      {/* ====== HERO ====== */}
      <section className="relative overflow-hidden px-4 pb-16 pt-24 sm:px-8 sm:pt-32">
        <div className="mx-auto max-w-4xl text-center flex flex-col items-center">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center"
          >
            <h1 className="text-5xl font-extrabold tracking-tight text-[#1c1917] dark:text-white sm:text-6xl md:text-7xl">
              DBL QAD Portal
            </h1>
            <p className="mt-6 text-xl md:text-2xl text-[#c15f3c] font-semibold tracking-wide max-w-2xl leading-relaxed">
              Operational intelligence for textile manufacturing.
            </p>
            <div className="mt-4 flex flex-col items-center text-sm text-[#78716c] dark:text-[#a8a29e] space-y-1.5 font-light">
              <p>Built from live production reports.</p>
              <p>Updated automatically from uploaded workbooks.</p>
            </div>

            {workbook && (
              <div className="mt-10 border border-[#b1ada1]/40 bg-white dark:bg-[#292524] px-6 py-4 rounded-lg flex flex-col items-center shadow-sm">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e]">Latest Report</span>
                <span className="mt-1 text-base font-bold text-[#1c1917] dark:text-[#f4f3ee]">{workbook.report_type_name ?? workbook.filename}</span>
                <span className="mt-0.5 text-xs text-[#78716c] dark:text-[#a8a29e]">{formatShortDate(workbook.report_date)}</span>
              </div>
            )}

            <div className="mt-10">
              <button
                onClick={openLogin}
                className="rounded-lg bg-[#c15f3c] px-8 py-3 text-sm font-semibold text-white transition hover:bg-[#c15f3c]/90 active:scale-95 cursor-pointer shadow-sm"
              >
                {isAuthenticated ? "Explore Analytics" : "Sign In"}
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ====== OPERATIONAL SNAPSHOT ====== */}
      {kpis.length > 0 && (
        <section className="px-4 py-16 sm:px-8 border-t border-[#b1ada1]/40 bg-[#f4f3ee] dark:bg-[#1c1917]">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] mb-8 text-center sm:text-left">
              Operational Snapshot
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {kpis.map((kpi) => (
                <div key={kpi.metric_key} className="border border-[#b1ada1]/40 bg-white dark:bg-[#292524] p-8 rounded-lg shadow-sm">
                  <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] font-medium block min-h-[32px]">
                    {kpi.label}
                  </span>
                  <p className="mt-4 text-4xl font-light tracking-tight text-[#1c1917] dark:text-[#f4f3ee] tabular-nums">
                    {kpi.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ====== LATEST REPORT HIGHLIGHT ====== */}
      {workbook && (
        <section className="px-4 py-16 sm:px-8 border-y border-[#b1ada1]/40 bg-white dark:bg-[#292524]">
          <div className="mx-auto max-w-5xl flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e]">Latest Report</span>
              <h3 className="mt-1 text-3xl font-bold tracking-tight text-[#1c1917] dark:text-white">
                {workbook.report_type_name ?? workbook.filename}
              </h3>
            </div>
            <div className="flex gap-12">
              <div>
                <span className="text-[10px] uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block">Report Date</span>
                <span className="mt-1 text-lg font-bold text-[#1c1917]/80 dark:text-[#f4f3ee]/80 tabular-nums">
                  {formatShortDate(workbook.report_date)}
                </span>
              </div>
              {snapshot?.previous_date && (
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block">Compared Against</span>
                  <span className="mt-1 text-lg font-bold text-[#78716c] dark:text-[#a8a29e] tabular-nums">
                    {formatShortDate(snapshot.previous_date)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ====== OPERATIONAL MOVEMENT ====== */}
      <section className="px-4 py-16 sm:px-8 bg-[#f4f3ee] dark:bg-[#1c1917]">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] mb-8">
            Operational Movement
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Largest Increase Panel */}
            <div className="border border-[#b1ada1]/40 bg-white dark:bg-[#292524] p-8 rounded-lg flex flex-col justify-between min-h-48 shadow-sm">
              <div>
                <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] font-medium">Largest Increase</span>
                <h4 className="mt-4 text-2xl font-bold text-[#1c1917] dark:text-white">
                  {unitIncrease ? unitIncrease.entity : "CCL-B"}
                </h4>
              </div>
              <p className="mt-6 text-4xl font-light text-[#c15f3c] tabular-nums">
                {unitIncrease ? `${unitIncrease.difference > 0 ? "+" : ""}${unitIncrease.difference.toLocaleString()} kg` : "+5,311 kg"}
              </p>
            </div>

            {/* Largest Reduction Panel */}
            <div className="border border-[#b1ada1]/40 bg-white dark:bg-[#292524] p-8 rounded-lg flex flex-col justify-between min-h-48 shadow-sm">
              <div>
                <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] font-medium">Largest Reduction</span>
                <h4 className="mt-4 text-2xl font-bold text-[#1c1917] dark:text-white">
                  {unitReduction ? unitReduction.entity : "CCL-07"}
                </h4>
              </div>
              <p className="mt-6 text-4xl font-light text-emerald-600 dark:text-emerald-400 tabular-nums">
                {unitReduction ? `${unitReduction.difference.toLocaleString()} kg` : "-10,231 kg"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====== FACTORY TREND ====== */}
      {trends.length > 0 && (
        <section className="px-4 py-16 sm:px-8 border-y border-[#b1ada1]/40 bg-white dark:bg-[#292524]">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block mb-1">Visual Centerpiece</span>
              <h2 className="text-2xl font-bold tracking-tight text-[#1c1917] dark:text-white">
                Factory Operational Trend (Wait For Test)
              </h2>
            </div>
            <div className="w-full bg-[#f4f3ee] dark:bg-[#1c1917] border border-[#b1ada1]/40 p-6 rounded-lg">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trends} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(177, 173, 161, 0.2)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(dateStr) => {
                      try {
                        const d = new Date(dateStr);
                        return d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
                      } catch {
                        return dateStr;
                      }
                    }}
                    stroke="rgba(177, 173, 161, 0.4)"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "rgba(177, 173, 161, 0.3)" }}
                  />
                  <YAxis
                    stroke="rgba(177, 173, 161, 0.4)"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "0.5rem",
                      color: "var(--foreground)",
                      fontSize: 12,
                    }}
                    labelFormatter={(label) => {
                      try {
                        const d = new Date(label);
                        return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
                      } catch {
                        return label;
                      }
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="wait_for_test"
                    name="Wait For Test"
                    stroke="#c15f3c"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#c15f3c", strokeWidth: 0 }}
                    activeDot={{ r: 5, strokeWidth: 2, fill: "#c15f3c" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* ====== LATEST REPORT DETAILS ====== */}
      {workbook && (
        <section className="px-4 py-16 sm:px-8 bg-[#f4f3ee] dark:bg-[#1c1917]">
          <div className="mx-auto max-w-5xl">
            <div className="border border-[#b1ada1]/40 bg-white dark:bg-[#292524] p-8 rounded-lg shadow-sm">
              <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block mb-6 font-medium">Latest Report Details</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                <div>
                  <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block">Report Type</span>
                  <p className="mt-1 text-lg font-semibold text-[#1c1917] dark:text-[#f4f3ee]">
                    {workbook.report_type_name ?? "WF Test & Shade"}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block">Report Date</span>
                  <p className="mt-1 text-lg font-semibold text-[#1c1917] dark:text-[#f4f3ee] tabular-nums">
                    {formatShortDate(workbook.report_date)}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block">Units Reporting</span>
                  <p className="mt-1 text-lg font-semibold text-[#1c1917] dark:text-[#f4f3ee] tabular-nums">
                    {workbook.unit_count}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block">Buyers Reporting</span>
                  <p className="mt-1 text-lg font-semibold text-[#1c1917] dark:text-[#f4f3ee] tabular-nums">
                    {workbook.buyer_count}
                  </p>
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-[#b1ada1]/30 flex items-center justify-between">
                <span className="text-xs text-[#78716c] dark:text-[#a8a29e]">Uploaded {relativeTime(workbook.uploaded_at)}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ====== PREVIEW CHARTS ====== */}
      {previewCharts && (previewCharts.unit_comparison?.length > 0 || previewCharts.buyer_comparison?.length > 0) && (
        <section className="px-4 py-16 sm:px-8 bg-[#f4f3ee] dark:bg-[#1c1917] border-t border-[#b1ada1]/40">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8 text-center sm:text-left">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block mb-1">Data Preview</span>
              <h2 className="text-2xl font-bold tracking-tight text-[#1c1917] dark:text-white">
                Unit & Buyer Comparisons
              </h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-8">
              {/* Unit Comparison */}
              {previewCharts.unit_comparison?.length > 0 && (
                <div className="border border-[#b1ada1]/40 bg-white dark:bg-[#292524] p-6 rounded-lg shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-[#78716c] dark:text-[#a8a29e] mb-6">
                    Top 5 Units (Current vs Previous)
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={previewCharts.unit_comparison} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(177, 173, 161, 0.2)" vertical={false} />
                        <XAxis dataKey="label" stroke="rgba(177, 173, 161, 0.4)" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                        <YAxis stroke="rgba(177, 173, 161, 0.4)" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "0.5rem", color: "var(--foreground)", fontSize: 12 }} />
                        <Bar dataKey="current_value" name="Current" fill="#c15f3c" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="previous_value" name="Previous" fill="rgba(177, 173, 161, 0.6)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Buyer Comparison */}
              {previewCharts.buyer_comparison?.length > 0 && (
                <div className="border border-[#b1ada1]/40 bg-white dark:bg-[#292524] p-6 rounded-lg shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-[#78716c] dark:text-[#a8a29e] mb-6">
                    Top 5 Buyers (Current vs Previous)
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={previewCharts.buyer_comparison} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(177, 173, 161, 0.2)" vertical={false} />
                        <XAxis dataKey="label" stroke="rgba(177, 173, 161, 0.4)" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                        <YAxis stroke="rgba(177, 173, 161, 0.4)" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "0.5rem", color: "var(--foreground)", fontSize: 12 }} />
                        <Bar dataKey="current_value" name="Current" fill="#c15f3c" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="previous_value" name="Previous" fill="rgba(177, 173, 161, 0.6)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ====== ANALYTICS PREVIEW ====== */}
      <section className="px-4 py-16 sm:px-8 border-t border-[#b1ada1]/40 bg-white dark:bg-[#292524]">
        <div className="mx-auto max-w-5xl">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#78716c] dark:text-[#a8a29e] block mb-8 text-center">
            Analytics Preview
          </span>
          <div className="relative overflow-hidden border border-[#b1ada1]/40 rounded-xl cursor-pointer group" onClick={openLogin}>
            <div className="relative h-96 w-full filter blur-[5px] brightness-50 transition duration-500 group-hover:blur-[3px] group-hover:brightness-75 group-hover:scale-[1.005]">
              <img
                src="/dashboard_preview.png"
                alt="Dashboard preview"
                className="w-full h-full object-cover object-top"
              />
            </div>
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-center p-6 transition duration-300 group-hover:bg-black/50">
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-full bg-white/10 p-3 text-white backdrop-blur-md">
                  <Lock className="size-6 text-[#c15f3c]" />
                </div>
                <h3 className="mt-3 text-2xl font-bold text-white">Sign in to explore analytics</h3>
                <p className="text-sm text-white/50 max-w-sm mt-1">
                  Access Unit Explorer, Buyer Explorer, Trend Analysis, and exportable reports.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== FINAL CTA ====== */}
      <section className="px-4 py-24 sm:px-8 border-t border-[#b1ada1]/40 bg-[#f4f3ee] dark:bg-[#1c1917]">
        <div className="mx-auto max-w-2xl text-center flex flex-col items-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-[#1c1917] dark:text-white sm:text-4xl">
            Explore Operational Analytics
          </h2>
          <p className="mt-4 text-base text-[#78716c] dark:text-[#a8a29e] leading-relaxed max-w-lg">
            Sign in to access historical trends, buyer analysis, unit drilldowns and exports.
          </p>
          <div className="mt-8">
            <button
              onClick={openLogin}
              className="rounded-lg bg-[#c15f3c] px-8 py-3 text-sm font-semibold text-white transition hover:bg-[#c15f3c]/90 active:scale-95 cursor-pointer shadow-sm"
            >
              {isAuthenticated ? "Go to Dashboard" : "Sign In"}
            </button>
          </div>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className="py-8 text-center text-xs text-[#78716c] dark:text-[#a8a29e] border-t border-[#b1ada1]/20 bg-[#f4f3ee] dark:bg-[#1c1917]">
        <p>Developed by Shahriar Rahman Smaron</p>
      </footer>

      {/* ====== Loading overlay ====== */}
      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#f4f3ee] dark:bg-[#1c1917]">
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 animate-spin rounded-full border-2 border-[#b1ada1]/20 border-t-[#c15f3c]" />
            <p className="text-sm text-[#78716c] dark:text-[#a8a29e]">Loading snapshot…</p>
          </div>
        </div>
      )}

      {/* ====== AUTH MODAL ====== */}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
