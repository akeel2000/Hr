"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { isTrackedAgent, normalizeAgentName } from "../lib/agent-normalizer";
import { firebaseAuth, hasFirebaseConfig } from "../lib/firebase";
import {
  buildDashboardSummary,
  dedupeSheetRows,
  formatCurrency,
  formatMonth,
  getAvailableMonths,
  getUsableRowCount,
  looksLikeSummaryOnlyPayload,
  parseReviewMonth,
  type AgentSummary,
  type SheetRow
} from "../lib/dashboard";

type LoadState = "idle" | "loading" | "ready" | "error";
type ClientCommissionRow = {
  key: string;
  month: string;
  agent: string;
  client: string;
  ftd: number;
  commission: number;
};
type ApiPayload =
  | SheetRow[]
  | {
      success?: boolean;
      total?: number;
      data?: SheetRow[];
    };

const COMMISSION_KEYS = [
  "client commission",
  "client comission",
  "client_commission",
  "client_comission"
];

function normalizeApiRowKeys(row: SheetRow): SheetRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/\s+/g, " "), value])
  ) as SheetRow;
}

function extractRows(payload: ApiPayload): SheetRow[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizeApiRowKeys);
  }

  if (Array.isArray(payload.data)) {
    return payload.data.map(normalizeApiRowKeys);
  }

  return [];
}

function getRowText(row: SheetRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function getRowNumber(row: SheetRow, keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    const normalized = typeof value === "string" ? value.replace(/[^\d.-]/g, "") : value;
    const parsed = Number(normalized);
    if (value !== undefined && value !== null && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function formatLkr(value: number): string {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 0
  }).format(value);
}

function StatCard({
  label,
  value,
  accentClass,
  note
}: {
  label: string;
  value: string;
  accentClass?: string;
  note: string;
}) {
  return (
    <article className={`card stat-card ${accentClass ?? ""}`}>
      <p className="eyebrow">{label}</p>
      <h3>{value}</h3>
      <p className="muted">{note}</p>
    </article>
  );
}

function VerticalChart({
  title,
  items,
  valueFormatter,
  colorClass
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  valueFormatter: (value: number) => string;
  colorClass: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <article className="card panel chart-panel">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
        </div>
      </div>

      <div className="column-chart">
        {items.length ? items.map((item) => (
          <div className="column-item" key={item.label}>
            <div className="column-value">{valueFormatter(item.value)}</div>
            <div className="column-track">
              <div
                className={`column-bar ${colorClass}`}
                style={{ height: `${(item.value / max) * 100}%` }}
              />
            </div>
            <div className="column-label">{item.label}</div>
          </div>
        )) : <p className="muted chart-empty">No chart data for this selection.</p>}
      </div>
    </article>
  );
}

function MonthlyTotalsChart({
  items
}: {
  items: Array<{ month: string; totalFtd: number; clients: number }>;
}) {
  const width = 1000;
  const height = 320;
  const left = 62;
  const right = 34;
  const top = 28;
  const bottom = 46;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxFtd = Math.max(...items.map((item) => item.totalFtd), 1);
  const maxSales = Math.max(...items.map((item) => item.clients), 1);
  const barSlot = items.length ? plotWidth / items.length : plotWidth;
  const barWidth = Math.min(54, Math.max(18, barSlot * 0.48));

  function pointX(index: number) {
    return left + barSlot * index + barSlot / 2;
  }

  function ftdY(value: number) {
    return top + plotHeight - (value / maxFtd) * plotHeight;
  }

  function salesY(value: number) {
    return top + plotHeight - (value / maxSales) * plotHeight;
  }

  const salesPath = items
    .map((item, index) => `${index === 0 ? "M" : "L"} ${pointX(index)} ${salesY(item.clients)}`)
    .join(" ");

  return (
    <article className="card panel chart-panel trend-panel" id="monthly-totals">
      <div className="panel-heading">
        <div>
          <h3>Overall Monthly Totals</h3>
        </div>
        <p className="muted">FTD amount with sales count trend.</p>
      </div>

      <div className="trend-legend">
        <div className="trend-legend-item">
          <span className="trend-swatch bar-swatch" />
          <span>FTD amount</span>
        </div>
        <div className="trend-legend-item">
          <span className="trend-swatch sales-swatch" />
          <span>Sales count</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg" role="img" aria-label="Overall monthly FTD and sales count trend">
        {[0, 1, 2, 3, 4, 5].map((step) => {
          const value = (maxFtd / 5) * step;
          const y = ftdY(value);

          return (
            <g key={step}>
              <line x1={left} y1={y} x2={width - right} y2={y} className="trend-grid" />
              <text x={8} y={y + 4} className="trend-axis-label">
                {formatCurrency(value)}
              </text>
            </g>
          );
        })}

        {items.map((item, index) => {
          const x = pointX(index);
          const y = ftdY(item.totalFtd);
          const barHeight = top + plotHeight - y;

          return (
            <g key={item.month}>
              <rect x={x - barWidth / 2} y={y} width={barWidth} height={barHeight} rx="7" className="monthly-ftd-bar" />
              <text x={x} y={height - 16} textAnchor="middle" className="trend-axis-label">
                {formatMonth(item.month).split(" ")[0]}
              </text>
            </g>
          );
        })}

        {items.length ? <path d={salesPath} fill="none" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {items.map((item, index) => (
          <g key={`${item.month}-sales`}>
            <circle cx={pointX(index)} cy={salesY(item.clients)} r="5" fill="#2dd4bf" />
            <text x={pointX(index)} y={salesY(item.clients) - 10} textAnchor="middle" className="trend-axis-label sales-count-label">
              {item.clients}
            </text>
          </g>
        ))}
      </svg>
    </article>
  );
}

function TrendChart({
  months,
  series,
  valueFormatter
}: {
  months: string[];
  series: Array<{ label: string; values: number[]; color: string }>;
  valueFormatter: (value: number) => string;
}) {
  const width = 1000;
  const height = 280;
  const left = 54;
  const right = 20;
  const top = 20;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(...series.flatMap((item) => item.values), 1);

  function pointX(index: number) {
    return left + (months.length <= 1 ? plotWidth / 2 : (plotWidth / (months.length - 1)) * index);
  }

  function pointY(value: number) {
    return top + plotHeight - (value / max) * plotHeight;
  }

  return (
    <article className="card panel chart-panel trend-panel">
      <div className="panel-heading">
        <div>
          <h3>Monthly Trend — FTD Amount</h3>
        </div>
      </div>

      <div className="trend-legend">
        {series.map((item) => (
          <div className="trend-legend-item" key={item.label}>
            <span className="trend-swatch" style={{ background: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg" role="img" aria-label="Monthly FTD trend by agent">
        {[0, 1, 2, 3, 4, 5].map((step) => {
          const value = (max / 5) * step;
          const y = pointY(value);

          return (
            <g key={step}>
              <line x1={left} y1={y} x2={width - right} y2={y} className="trend-grid" />
              <text x={8} y={y + 4} className="trend-axis-label">
                {valueFormatter(value)}
              </text>
            </g>
          );
        })}

        {months.map((month, index) => (
          <g key={month}>
            <line x1={pointX(index)} y1={top} x2={pointX(index)} y2={height - bottom} className="trend-grid trend-grid-vertical" />
            <text x={pointX(index)} y={height - 8} textAnchor="middle" className="trend-axis-label">
              {formatMonth(month).split(" ")[0]}
            </text>
          </g>
        ))}

        {series.map((item) => {
          const path = item.values
            .map((value, index) => `${index === 0 ? "M" : "L"} ${pointX(index)} ${pointY(value)}`)
            .join(" ");

          return (
            <g key={item.label}>
              <path d={path} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {item.values.map((value, index) => (
                <circle key={`${item.label}-${months[index]}`} cx={pointX(index)} cy={pointY(value)} r="4" fill={item.color} />
              ))}
            </g>
          );
        })}
      </svg>
    </article>
  );
}

function LeaderboardList({ rows }: { rows: AgentSummary[] }) {
  return (
    <div className="leaderboard-list">
      {rows.map((row) => {
        const rankClass = row.rank <= 3 ? `rank-${row.rank}` : "rank-other";

        return (
          <article className={`lb-row ${rankClass}`} key={row.agent}>
            <div className="rank-badge">#{row.rank}</div>
            <div className="lb-agent">
              <div className="lb-name">{row.agent}</div>
              <div className="lb-detail">
                {row.clients} clients handled • {row.countries} countries
              </div>
            </div>
            <div className="lb-stats">
              <div className="lb-stat">
                <div className="val">{row.clients}</div>
                <div className="key">Clients</div>
              </div>
              <div className="lb-stat">
                <div className="val">{formatCurrency(row.totalFtd)}</div>
                <div className="key">FTD</div>
              </div>
              <div className="lb-score">{formatCurrency(row.averageFtd)}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Bars({
  items,
  colorClass,
  labelKey,
  valueKey,
  valueFormatter
}: {
  items: Array<Record<string, string | number>>;
  colorClass: string;
  labelKey: string;
  valueKey: string;
  valueFormatter: (value: number) => string;
}) {
  const max = Math.max(...items.map((item) => Number(item[valueKey])), 1);

  return (
    <div className="bars">
      {items.map((item) => {
        const value = Number(item[valueKey]);
        const width = `${(value / max) * 100}%`;

        return (
          <div className="bar-row" key={`${item[labelKey]}`}>
            <div className="bar-labels">
              <span>{String(item[labelKey])}</span>
              <strong>{valueFormatter(value)}</strong>
            </div>
            <div className="bar-track">
              <div className={`bar-fill ${colorClass}`} style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClientCommissionTable({ rows }: { rows: ClientCommissionRow[] }) {
  return (
    <article className="card panel table-panel" id="client-commission">
      <div className="panel-heading">
        <div>
          <h3>Monthly Client Commission</h3>
        </div>
        <p className="muted">Client-level sales with FTD and commission.</p>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Agent</th>
              <th>Client</th>
              <th>FTD</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.key}>
                <td>{formatMonth(row.month)}</td>
                <td>{row.agent}</td>
                <td>{row.client}</td>
                <td>{formatCurrency(row.ftd)}</td>
                <td>{formatLkr(row.commission)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5}>No client commission rows for this selection.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function Page() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [aiQuestion, setAiQuestion] = useState("Summarize this month's performance and flag any anomalies.");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  async function loadRows(silent = false, signal?: AbortSignal) {
    const requestUrl = new URL("/api/data", window.location.origin);
    requestUrl.searchParams.set("_ts", String(Date.now()));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const abortFromParent = () => controller.abort();

    signal?.addEventListener("abort", abortFromParent, { once: true });

    if (!silent) {
      setLoadState("loading");
      setErrorMessage("");
    }

    try {
      const response = await fetch(requestUrl.toString(), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const payload = (await response.json()) as ApiPayload;
      const liveRows = dedupeSheetRows(extractRows(payload));
      const usableRowCount = getUsableRowCount(liveRows);

      if (!liveRows.length) {
        throw new Error("API returned no usable rows. Check the Apps Script folder, sheet tab, and column headers.");
      }

      if (!usableRowCount) {
        if (looksLikeSummaryOnlyPayload(liveRows)) {
          throw new Error("API returned summary rows instead of client-level rows. Apps Script must return Agent Name, Client Name, Date of FTD, and FTD for each record.");
        }

        throw new Error("API returned rows, but they are missing required values. Each row must include Agent Name, Client Name, Date of FTD, and FTD.");
      }

      const months = getAvailableMonths(liveRows);
      setRows(liveRows);
      setSelectedMonth((current) => {
        if (current && months.includes(current)) {
          return current;
        }

        return months[0] ?? "";
      });
      setLoadState("ready");
      setErrorMessage("");
    } catch (error) {
      if (signal?.aborted || controller.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      setLoadState("error");
      setErrorMessage(`Live data failed to load. ${message}`);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (hasFirebaseConfig() && !user) {
      router.replace("/login");
      return;
    }

    const controller = new AbortController();
    let refreshInFlight = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const refresh = (silent = false) => {
      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      void loadRows(silent, controller.signal).finally(() => {
        refreshInFlight = false;
      });
    };

    refresh(false);

    intervalId = setInterval(() => {
      refresh(true);
    }, 120000);

    return () => {
      controller.abort();
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [authReady, router, user]);

  const availableMonths = useMemo(() => getAvailableMonths(rows), [rows]);
  const availableAgents = useMemo(() => {
    return [...new Set(
      rows
        .map((row) => normalizeAgentName(getRowText(row, ["agent", "agent name", "agent_name"])))
        .filter((agent) => agent && isTrackedAgent(agent))
    )].sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const personRows = useMemo(() => {
    if (selectedAgent === "all") {
      return rows;
    }

    return rows.filter((row) => normalizeAgentName(getRowText(row, ["agent", "agent name", "agent_name"])) === selectedAgent);
  }, [rows, selectedAgent]);
  const summary = useMemo(() => buildDashboardSummary(personRows, selectedMonth), [personRows, selectedMonth]);
  const topFive = summary.agentSummaries.slice(0, 5);
  const analysisRows = useMemo(
    () => (selectedMonth ? personRows.filter((row) => parseReviewMonth(row) === selectedMonth) : personRows),
    [personRows, selectedMonth]
  );
  const chartRows = useMemo(
    () => personRows.filter((row) => !selectedMonth || parseReviewMonth(row) === selectedMonth),
    [personRows, selectedMonth]
  );
  const ftdChartData = useMemo(
    () => summary.agentSummaries.map((item) => ({ label: item.agent, value: item.totalFtd })),
    [summary.agentSummaries]
  );
  const salesChartData = useMemo(
    () => summary.agentSummaries.map((item) => ({ label: item.agent, value: item.clients })),
    [summary.agentSummaries]
  );
  const commissionChartData = useMemo(() => {
    const totals = new Map<string, number>();

    for (const row of chartRows) {
      const agent = normalizeAgentName(getRowText(row, ["agent", "agent name", "agent_name"]));
      const commission = getRowNumber(row, COMMISSION_KEYS);

      if (!agent || !isTrackedAgent(agent) || !Number.isFinite(commission)) {
        continue;
      }

      totals.set(agent, (totals.get(agent) ?? 0) + commission);
    }

    return [...totals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [chartRows]);
  const clientCommissionRows = useMemo(() => {
    const grouped = new Map<string, ClientCommissionRow>();

    for (const row of chartRows) {
      const month = parseReviewMonth(row);
      const agent = normalizeAgentName(getRowText(row, ["agent", "agent name", "agent_name"]));
      const client = getRowText(row, ["client", "client name", "client_name"]);
      const ftd = getRowNumber(row, ["ftd"]);
      const commission = getRowNumber(row, COMMISSION_KEYS);

      if (!month || !agent || !client || !isTrackedAgent(agent)) {
        continue;
      }

      const key = `${month}|${agent}|${client}`.toLowerCase();
      const current = grouped.get(key) ?? { key, month, agent, client, ftd: 0, commission: 0 };
      current.ftd += ftd;
      current.commission += commission;
      grouped.set(key, current);
    }

    return [...grouped.values()].sort((a, b) => {
      if (a.month !== b.month) {
        return b.month.localeCompare(a.month);
      }
      if (b.commission !== a.commission) {
        return b.commission - a.commission;
      }
      return a.client.localeCompare(b.client);
    });
  }, [chartRows]);
  const trendSeries = useMemo(() => {
    const months = availableMonths.slice().sort();
    const palette = ["#60a5fa", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316"];
    const series = summary.agentSummaries.slice(0, 5).map((agentSummary, index) => {
      const values = months.map((month) =>
        personRows
          .filter((row) => parseReviewMonth(row) === month)
          .filter((row) => normalizeAgentName(getRowText(row, ["agent", "agent name", "agent_name"])) === agentSummary.agent)
          .reduce((sum, row) => sum + getRowNumber(row, ["ftd"]), 0)
      );

      return {
        label: agentSummary.agent,
        values,
        color: palette[index % palette.length]
      };
    });

    return { months, series };
  }, [availableMonths, personRows, summary.agentSummaries]);

  async function runAi(mode: "answer" | "report") {
    if (!analysisRows.length) {
      setAiError("No dashboard rows are available for AI analysis.");
      setAiAnswer("");
      return;
    }

    setAiLoading(true);
    setAiError("");

    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          rows: analysisRows,
          question: aiQuestion,
          monthLabel: formatMonth(selectedMonth),
          mode
        })
      });

      const result = (await response.json()) as { success?: boolean; insights?: string; error?: string };

      if (!response.ok || !result.success || !result.insights) {
        throw new Error(result.error || "AI analysis failed.");
      }

      setAiAnswer(result.insights);

      if (mode === "report") {
        const blob = new Blob([result.insights], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${selectedMonth || "all-months"}-performance-report.md`;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI analysis failed.";
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  }

  if (!authReady) {
    return (
      <main className="auth-shell">
        <article className="auth-card card">
          <p className="eyebrow">Checking session</p>
          <h1>Preparing access control.</h1>
          <p className="hero-copy">Firebase is verifying whether this browser already has an active session.</p>
        </article>
      </main>
    );
  }

  if (hasFirebaseConfig() && !user) {
    return (
      <main className="auth-shell">
        <article className="auth-card card">
          <p className="eyebrow">Redirecting</p>
          <h1>Sending you to the login page.</h1>
          <p className="hero-copy">This dashboard requires authentication before any live data is shown.</p>
        </article>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <aside className={`sidebar card ${sidebarOpen ? "open" : ""}`}>
        <div>
          <p className="eyebrow">Navigation</p>
          <h2 className="sidebar-title">HR Dashboard</h2>
        </div>

        <div className="sidebar-stack">
          <nav className="sidebar-nav">
            <a href="#overview" className="nav-item active" onClick={() => setSidebarOpen(false)}>
              Dashboard
            </a>
            <a href="#leaderboard" className="nav-item" onClick={() => setSidebarOpen(false)}>
              Sales List
            </a>
            <a href="#charts" className="nav-item" onClick={() => setSidebarOpen(false)}>
              Summary Graphs
            </a>
            <a href="#monthly-totals" className="nav-item" onClick={() => setSidebarOpen(false)}>
              Monthly Trend
            </a>
            <a href="#client-commission" className="nav-item" onClick={() => setSidebarOpen(false)}>
              Commission
            </a>
          </nav>

          <div className="account-card">
            <span className="sidebar-label">Login Account</span>
            <strong>{user?.email ?? "Not signed in"}</strong>
            <p>Role: HR Reviewer</p>
          </div>
        </div>

        {user ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (firebaseAuth) {
                void signOut(firebaseAuth);
              }
            }}
          >
            Logout
          </button>
        ) : <button type="button" className="secondary-button" disabled>Logout</button>}
      </aside>

      {sidebarOpen ? <button type="button" className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" /> : null}

      <section className="main-panel">
        <section className="topbar card" id="overview">
          <div>
            <button type="button" className="menu-toggle" onClick={() => setSidebarOpen((value) => !value)}>
              Menu
            </button>
            <h1>Sales Agent Performance Review</h1>
            <p className="subtitle">
              {formatMonth(summary.monthKey)} | {selectedAgent === "all" ? `${summary.agentSummaries.length} Agents` : selectedAgent} | Folder-Based Live Review
            </p>
          </div>
          <span className={`badge-live ${loadState === "error" ? "badge-error" : ""}`}>
            {loadState === "error" ? "LIVE ERROR" : "LIVE DATA"}
          </span>
        </section>

        <section className="controls card">
          <label className="control-group">
            <span>Month</span>
            <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              <option value="">All Months</option>
              {availableMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonth(month)}
                </option>
              ))}
            </select>
          </label>
          <label className="control-group">
            <span>Person</span>
            <select value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value)}>
              <option value="all">All Persons</option>
              {availableAgents.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
          </label>
          <div className={`data-status ${loadState}`}>
            {loadState === "loading" ? "Loading live data..." : loadState === "error" ? errorMessage : `Loaded ${rows.length} rows`}
          </div>
        </section>

        <section className="stats-grid">
        <StatCard
          label="Selected Month"
          value={formatMonth(summary.monthKey)}
          accentClass="accent-blue"
          note="Filter is based on the row date column."
        />
        <StatCard
          label="Sales Count"
          value={String(summary.totalClients)}
          accentClass="accent-teal"
          note="Unique client sales in the current view."
        />
        <StatCard
          label="Total FTD"
          value={formatCurrency(summary.totalFtd)}
          accentClass="accent-gold"
          note="Sum of all FTD values in the month."
        />
        <StatCard
          label="Top Performer"
          value={summary.topAgent?.agent ?? "No data"}
          note={
            summary.topAgent
              ? `${summary.topAgent.clients} clients, ${formatCurrency(summary.topAgent.totalFtd)} FTD`
              : "Add data to calculate the winner."
          }
        />
        </section>

        {!rows.length ? (
          <section className="content-grid">
            <article className="card panel empty-panel">
              <div className="panel-heading">
                <div>
                  <h3>Live Data Required</h3>
                </div>
              </div>
              <p className="muted">
                No original spreadsheet rows are available right now. This dashboard no longer shows dummy data.
              </p>
              <p className="muted">
                Fix the Apps Script output so it returns valid `Agent Name`, `Client Name`, `Date of FTD`, and `FTD` rows from your monthly files.
              </p>
            </article>
          </section>
        ) : (
        <section className="content-grid" id="leaderboard">
          <div>
            <div className="section-title">Overall Sales Name List</div>
            <article className="card panel">
              <div className="panel-heading">
                <div>
                  <h3>{selectedAgent === "all" ? "Monthly Ranking" : `${selectedAgent} Dashboard`}</h3>
                </div>
                <p className="muted">Client count decides the winner. FTD breaks ties.</p>
              </div>
              <LeaderboardList rows={summary.agentSummaries} />
            </article>
          </div>

          <div className="right-stack">
            <article className="card panel">
              <div className="panel-heading">
                <div>
                  <h3>Top 5 FTD</h3>
                </div>
              </div>
              <Bars
                items={topFive}
                colorClass="blue"
                labelKey="agent"
                valueKey="totalFtd"
                valueFormatter={formatCurrency}
              />
            </article>

            <article className="card panel">
              <div className="panel-heading">
                <div>
                  <h3>Month Totals</h3>
                </div>
              </div>
              <Bars
                items={summary.monthlyTrend}
                colorClass="teal"
                labelKey="month"
                valueKey="totalFtd"
                valueFormatter={formatCurrency}
              />
            </article>

            <article className="card panel logic-panel">
              <div className="panel-heading">
                <div>
                  <h3>Performance Rule</h3>
                </div>
              </div>
              <ol>
                <li>Count each agent&apos;s unique clients for the month.</li>
                <li>Higher client count ranks higher.</li>
                <li>If client count is the same, compare total FTD.</li>
                <li>If both are equal, sort by agent name for stable order.</li>
              </ol>
              <div className="logic-highlight">
                <span>Average FTD per client</span>
                <strong>{formatCurrency(summary.averageFtdPerClient)}</strong>
              </div>
            </article>
          </div>
        </section>
        )}

        {rows.length ? (
          <section className="charts-grid" id="charts">
            <VerticalChart
              title="FTD Amount by Agent"
              items={ftdChartData}
              valueFormatter={formatCurrency}
              colorClass="column-blue"
            />
            <VerticalChart
              title="Sales Count by Agent"
              items={salesChartData}
              valueFormatter={(value) => String(value)}
              colorClass="column-teal"
            />
            <VerticalChart
              title="Commission Earned by Agent"
              items={commissionChartData}
              valueFormatter={formatLkr}
              colorClass="column-gold"
            />
            <MonthlyTotalsChart items={summary.monthlyTrend} />
            <TrendChart months={trendSeries.months} series={trendSeries.series} valueFormatter={formatCurrency} />
            <ClientCommissionTable rows={clientCommissionRows} />
          </section>
        ) : null}

        <footer className="footer">
          Sales Performance Dashboard · Google Sheets Folder Data · Auto-ranked by client count and FTD
        </footer>
      </section>

      <button
        type="button"
        className="chat-launcher"
        onClick={() => setChatOpen((value) => !value)}
        aria-label={chatOpen ? "Close AI assistant" : "Open AI assistant"}
      >
        AI
      </button>

      {chatOpen ? (
        <aside className="chat-drawer card">
          <div className="chat-header">
            <div>
              <p className="eyebrow">Assistant</p>
              <h3>HR AI Chat</h3>
            </div>
            <button type="button" className="chat-close" onClick={() => setChatOpen(false)}>
              Close
            </button>
          </div>

          <p className="muted chat-copy">Read-only analysis for summaries, anomaly flags, duplicate-name checks, and report generation.</p>

          <label className="ai-form">
            <span>Ask a question</span>
            <textarea
              value={aiQuestion}
              onChange={(event) => setAiQuestion(event.target.value)}
              placeholder="Ask about anomalies, top performers, duplicates, or trends."
              rows={5}
            />
          </label>

          <div className="ai-actions">
            <button type="button" onClick={() => void runAi("answer")} disabled={aiLoading || !analysisRows.length}>
              {aiLoading ? "Running..." : "Ask AI"}
            </button>
            <button type="button" className="secondary-button" onClick={() => void runAi("report")} disabled={aiLoading || !analysisRows.length}>
              Download Report
            </button>
          </div>

          {aiError ? <p className="auth-error">{aiError}</p> : null}

          <div className="ai-output">
            {aiAnswer ? <pre>{aiAnswer}</pre> : <p className="muted">AI output will appear here for {formatMonth(selectedMonth).toLowerCase()}.</p>}
          </div>
        </aside>
      ) : null}
    </main>
  );
}
