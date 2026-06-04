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
  Download,
  Eye,
  Factory,
  FileSpreadsheet,
  Layers,
  Lock,
  MessageCircle,
  Minus,
  Sparkles,
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

type ReportTypeSummary = {
  report_type_id: string;
  report_type_name: string;
  report_type_code: string;
  latest_report_date: string | null;
  kpis: Array<Pick<KpiSnapshot, "metric_key" | "label" | "value">>;
  preview_metric_key: string | null;
  preview_metric_label: string | null;
  preview_chart: Array<{ unit: string; value: number }>;
};

type WfTestPreviewPoint = {
  unit: string;
  value: number;
  date: string;
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
  report_types?: ReportTypeSummary[];
  wf_test_preview_chart?: WfTestPreviewPoint[];
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

  function openLogin() {
    if (isAuthenticated) {
      router.push("/dashboard");
    } else {
      setLoginOpen(true);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 selection:text-foreground transition-colors duration-300">
      {/* ====== SECTION 1 — HERO ====== */}
      <section className="relative flex flex-col justify-center min-h-[70vh] px-6 py-16 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center flex flex-col items-center justify-center space-y-8"
        >
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl md:text-7xl">
            DBL QAD Portal
          </h1>
          <p className="text-xl md:text-2xl text-primary font-semibold tracking-wide max-w-2xl leading-relaxed">
            Operational intelligence for textile manufacturing.
          </p>
          <div className="flex flex-col items-center text-base text-foreground dark:text-neutral-200 space-y-1 font-semibold">
            <p>Built from live production reports.</p>
            <p>Updated automatically from uploaded workbooks.</p>
          </div>

          <div className="pt-4">
            <button
              onClick={openLogin}
              className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white transition hover:bg-primary/90 active:scale-95 cursor-pointer shadow-sm"
            >
              {isAuthenticated ? "Explore Analytics" : "Sign In"}
            </button>
          </div>
        </motion.div>
      </section>

      {/* ====== SECTION 2 — REPORT SUMMARIES ====== */}
      <section className="py-20 px-6 max-w-5xl mx-auto border-t border-border">
        <div className="mb-10">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
            Latest Report Summaries
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            Current operational snapshot by report type
          </h2>
        </div>
        <div className="space-y-10">
          {snapshot?.report_types?.map((reportType) => (
            <div key={reportType.report_type_id} className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-stretch">
              <div className="flex flex-col justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-6">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-5" />
                  <span className="text-xs font-bold uppercase tracking-widest">Latest report</span>
                </div>
                <h3 className="mt-4 text-xl font-bold text-foreground">{reportType.report_type_name}</h3>
                <p className="mt-2 text-sm font-medium tabular-nums text-muted-foreground">
                  {formatShortDate(reportType.latest_report_date)}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {reportType.kpis.map((kpi) => (
                  <div key={kpi.metric_key} className="rounded-lg border border-border bg-card p-6 shadow-sm">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                      {kpi.label}
                    </span>
                    <p className="mt-4 text-3xl font-normal tracking-tight text-foreground tabular-nums">
                      {kpi.value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ====== SECTION 3 — KEY OPERATIONAL MOVEMENTS ====== */}
      <section className="py-20 px-6 max-w-5xl mx-auto border-t border-border">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Key Operational Movements
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            Latest report previews
          </h2>
        </div>
        <div className="space-y-8">
          {snapshot?.report_types?.map((reportType) => (
            <button
              key={reportType.report_type_id}
              type="button"
              onClick={openLogin}
              className="group grid w-full gap-6 rounded-xl border border-border bg-card p-6 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md lg:grid-cols-[220px_1fr] lg:p-8"
            >
              <div className="flex flex-col justify-center">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Report Type
                </span>
                <h3 className="mt-3 text-2xl font-bold text-foreground">
                  {reportType.report_type_name}
                </h3>
                <p className="mt-3 text-sm font-medium tabular-nums text-muted-foreground">
                  {formatShortDate(reportType.latest_report_date)}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                  Open full analytics
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
              <div className="min-h-[280px] rounded-lg border border-border/70 bg-background/40 p-4">
                <div className="mb-3">
                  <h4 className="text-sm font-semibold text-foreground">
                    {reportType.preview_metric_label ?? "Metric"} by Unit
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Latest report date: {formatShortDate(reportType.latest_report_date)}
                  </p>
                </div>
                {reportType.preview_chart.length > 0 ? (
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={reportType.preview_chart}
                        layout="vertical"
                        margin={{ top: 0, right: 24, left: 4, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis
                          type="number"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value: number) => value.toLocaleString()}
                        />
                        <YAxis
                          dataKey="unit"
                          type="category"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          width={70}
                        />
                        <Bar
                          dataKey="value"
                          name={reportType.preview_metric_label ?? "Value"}
                          fill="#c15f3c"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                    No unit chart data available
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ====== SECTION 5 — ANALYTICS PREVIEW ====== */}
      <section className="py-20 px-6 max-w-5xl mx-auto border-t border-border">
        <div className="mb-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            From report to action
          </p>
          <h3 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            One workspace for operational reporting
          </h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Upload production data, turn it into clear decisions, and share the results without slowing down.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: FileSpreadsheet, title: "Refresh with Excel", description: "Upload the latest workbook and keep every dashboard current." },
            { icon: Sparkles, title: "Ask QAD AI", description: "Turn report data into quick analysis and useful visuals." },
            { icon: Download, title: "Presentation-ready", description: "Export clear charts for meetings, reviews, and updates." },
            { icon: MessageCircle, title: "Instant alerts", description: "Notify the team on Telegram when a new report goes live." },
          ].map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="flex size-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <h4 className="mt-5 text-base font-bold text-foreground">{feature.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={openLogin}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-7 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90 active:scale-95"
          >
            {isAuthenticated ? "Open QAD Portal" : "Sign in to QAD Portal"}
            <ArrowRight className="size-4" />
          </button>
          <p className="mt-3 text-xs text-muted-foreground">Secure access for your operational team.</p>
        </div>
        {false && <div
          onClick={openLogin}
          className="relative overflow-hidden border border-border rounded-xl cursor-pointer group shadow-lg bg-card"
        >
          {/* Live Preview Chart (Blurred) */}
          <div className="relative p-8 h-[400px] w-full flex flex-col justify-between filter blur-[4px] brightness-[0.5] transition duration-500 group-hover:blur-[2px] group-hover:brightness-[0.6] group-hover:scale-[1.005]">
            {(snapshot?.wf_test_preview_chart?.length ?? 0) > 0 ? (
              <div className="w-full h-full flex flex-col justify-between">
                <div className="mb-2 text-left">
                  <h4 className="text-lg font-bold text-foreground">T/Stock — by Unit</h4>
                  <p className="text-xs text-muted-foreground">
                    Report Date: {formatShortDate(snapshot?.wf_test_preview_chart?.[0]?.date ?? null)}
                  </p>
                </div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={snapshot?.wf_test_preview_chart}
                      layout="vertical"
                      margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.08)" />
                      <XAxis
                        type="number"
                        stroke="rgba(255,255,255,0.4)"
                        tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => v.toLocaleString()}
                      />
                      <YAxis
                        dataKey="unit"
                        type="category"
                        stroke="rgba(255,255,255,0.4)"
                        tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={85}
                      />
                      <Bar dataKey="value" name="T/Stock" fill="#c15f3c" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center w-full h-full text-muted-foreground text-sm">
                No preview data available
              </div>
            )}
          </div>

          {/* Centered Glassmorphism Overlay */}
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/50 transition duration-300 group-hover:bg-black/40">
            <div className="max-w-md w-full bg-[#1c1917]/85 dark:bg-[#1c1917]/90 backdrop-blur-md border border-white/[0.08] p-8 rounded-2xl text-center shadow-2xl flex flex-col items-center">
              <div className="rounded-full bg-primary/10 border border-primary/20 p-3 text-primary mb-4">
                <Lock className="size-6" />
              </div>
              <h4 className="text-2xl font-bold text-white tracking-tight">
                Full operational analysis available
              </h4>
              <p className="mt-2 text-xs text-muted-foreground">
                Showing live T/Stock by Unit for WF Test & Shade report type.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[#a8a29e] text-center font-medium w-full">
                <li className="flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Unit performance matrix
                </li>
                <li className="flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Buyer trends & historical load
                </li>
                <li className="flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Detailed metric timelines
                </li>
                <li className="flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Exportable workbook dashboards
                </li>
              </ul>
              <span className="mt-8 text-xs font-semibold uppercase tracking-widest text-primary group-hover:underline">
                Click graph to unlock portal
              </span>
            </div>
          </div>
        </div>}
      </section>

      {/* ====== FOOTER ====== */}
      <footer className="py-8 text-center text-xs text-muted-foreground border-t border-border/20 bg-background">
        <p>Developed by Shahriar Rahman Smaron</p>
      </footer>

      {/* ====== Loading overlay ====== */}
      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
            <p className="text-sm text-muted-foreground">Loading snapshot…</p>
          </div>
        </div>
      )}

      {/* ====== AUTH MODAL ====== */}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
