import { isTrackedAgent, normalizeAgentName } from "./agent-normalizer";

export type SheetRow = {
  date?: string | number | Date;
  agent?: string;
  client?: string;
  ftd?: number | string;
  country?: string;
  sourceFile?: string;
  [key: string]: unknown;
};

type NormalizedSheetRow = {
  date: string;
  monthKey: string;
  agent: string;
  client: string;
  ftd: number;
  country: string;
  sourceFile: string;
};

export type AgentSummary = {
  rank: number;
  agent: string;
  clients: number;
  totalFtd: number;
  averageFtd: number;
  countries: number;
};

export type DashboardSummary = {
  monthKey: string;
  totalClients: number;
  totalFtd: number;
  topAgent: AgentSummary | null;
  averageFtdPerClient: number;
  agentSummaries: AgentSummary[];
  countryTotals: Array<{ country: string; totalFtd: number }>;
  monthlyTrend: Array<{ month: string; totalFtd: number; clients: number }>;
  monthlyChampions: Array<{ month: string; agent: string; clients: number; totalFtd: number }>;
};

function buildRowIdentity(row: SheetRow): string {
  return [
    getDateValue(row),
    getStringValue(row, ["agent", "agent name", "agent_name"]).toLowerCase(),
    getStringValue(row, ["client", "client name", "client_name"]).toLowerCase(),
    String(getNumberValue(row, ["ftd"])),
    getStringValue(row, ["country", "location"]).toLowerCase(),
    getStringValue(row, ["sourceFile", "source_file"]).toLowerCase()
  ].join("|");
}

function getStringValue(row: SheetRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function getNumberValue(row: SheetRow, keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    const parsed = Number(value);
    if (value !== undefined && value !== null && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function excelSerialToIsoDate(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;
  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds -= seconds;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;

  dateInfo.setUTCHours(hours, minutes, seconds, 0);
  return dateInfo.toISOString();
}

function getDatePartsFromSourceFile(sourceFile: string): { month: number } | null {
  const text = sourceFile.toLowerCase();
  const monthMap: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
  };

  const monthName = Object.keys(monthMap).find((month) => text.includes(month));

  if (!monthName) {
    return null;
  }

  return {
    month: monthMap[monthName]
  };
}

function getMonthKeyFromLabel(value: string): string {
  const trimmed = value.trim();
  const monthYearMatch = trimmed.match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})$/i
  );

  if (monthYearMatch) {
    const [, monthName, yearText] = monthYearMatch;
    const parts = getDatePartsFromSourceFile(monthName);

    if (!parts) {
      return "";
    }

    return `${yearText}-${String(parts.month).padStart(2, "0")}`;
  }

  const isoMonthMatch = trimmed.match(/^(20\d{2})-(\d{2})$/);

  if (isoMonthMatch) {
    return `${isoMonthMatch[1]}-${isoMonthMatch[2]}`;
  }

  return "";
}

function parseDateString(value: string): Date | null {
  const trimmed = value.trim();
  const dayFirst = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);

  if (dayFirst) {
    const [, dayText, monthText, yearText] = dayFirst;
    const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateFromSourceFile(sourceFile: string): string {
  const parts = getDatePartsFromSourceFile(sourceFile);

  if (!parts) {
    return "";
  }

  const month = String(parts.month).padStart(2, "0");
  return `2026-${month}-01`;
}

function getMonthValue(row: SheetRow): string {
  return getStringValue(row, ["month", "review month", "review_month"]);
}

function getRawDateValue(row: SheetRow): string | number | Date | undefined {
  const value = row.date ?? row["date of ftd"] ?? row["date_of_ftd"] ?? row["ftd date"] ?? row["ftd_date"];

  if (value instanceof Date || typeof value === "string" || typeof value === "number" || value === undefined) {
    return value;
  }

  return undefined;
}

export function parseReviewMonth(row: SheetRow): string {
  const explicitMonth = getMonthKeyFromLabel(getMonthValue(row));

  if (explicitMonth) {
    return explicitMonth;
  }

  const sourceFileDate = getDateFromSourceFile(getStringValue(row, ["sourceFile", "source_file"]));

  if (sourceFileDate) {
    return getMonthKey(sourceFileDate);
  }

  const rawDate = getRawDateValue(row);

  if (rawDate instanceof Date) {
    return `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, "0")}`;
  }

  if (typeof rawDate === "number" && Number.isFinite(rawDate)) {
    return getMonthKey(excelSerialToIsoDate(rawDate));
  }

  if (typeof rawDate === "string" && rawDate.trim()) {
    const parsed = parseDateString(rawDate);
    if (parsed) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    }
  }

  return getMonthKey(getDateFromSourceFile(getStringValue(row, ["sourceFile", "source_file"])));
}

function getDateValue(row: SheetRow): string {
  const rawDate = getRawDateValue(row);

  if (rawDate instanceof Date) {
    return rawDate.toISOString();
  }

  if (typeof rawDate === "number" && Number.isFinite(rawDate)) {
    return excelSerialToIsoDate(rawDate);
  }

  if (typeof rawDate === "string" && rawDate.trim()) {
    const parsed = parseDateString(rawDate);
    if (parsed) {
      return parsed.toISOString();
    }
  }

  const sourceFileDate = getDateFromSourceFile(getStringValue(row, ["sourceFile", "source_file"]));

  if (sourceFileDate) {
    return sourceFileDate;
  }

  const explicitMonth = getMonthKeyFromLabel(getMonthValue(row));

  if (explicitMonth) {
    return `${explicitMonth}-01`;
  }

  return getDateFromSourceFile(getStringValue(row, ["sourceFile", "source_file"]));
}

function normalizeRows(rows: SheetRow[]): NormalizedSheetRow[] {
  return rows
    .map((row) => ({
      date: getDateValue(row),
      monthKey: parseReviewMonth(row),
      agent: normalizeAgentName(getStringValue(row, ["agent", "agent name", "agent_name"])),
      client: getStringValue(row, ["client", "client name", "client_name"]),
      ftd: getNumberValue(row, ["ftd"]),
      country: getStringValue(row, ["country", "location"]),
      sourceFile: getStringValue(row, ["sourceFile", "source_file"])
    }))
    .filter((row) => row.monthKey && row.agent && row.client && Number.isFinite(row.ftd))
    .filter((row) => isTrackedAgent(row.agent));
}

export function getUsableRowCount(rows: SheetRow[]): number {
  return normalizeRows(rows).length;
}

export function looksLikeSummaryOnlyPayload(rows: SheetRow[]): boolean {
  if (!rows.length) {
    return false;
  }

  const hasMonthField = rows.some((row) => Boolean(getStringValue(row, ["month"])));
  const hasClientData = rows.some((row) => Boolean(getStringValue(row, ["client", "client name", "client_name"])));
  const hasDateData = rows.some((row) => Boolean(getDateValue(row)));

  return hasMonthField && (!hasClientData || !hasDateData);
}

export function dedupeSheetRows(rows: SheetRow[]): SheetRow[] {
  const seen = new Set<string>();

  return rows.filter((row) => {
    const identity = buildRowIdentity(row);

    if (!identity.replace(/\|/g, "")) {
      return true;
    }

    if (seen.has(identity)) {
      return false;
    }

    seen.add(identity);
    return true;
  });
}

export function getMonthKey(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getAvailableMonths(rows: SheetRow[]): string[] {
  return [...new Set(rows.map((row) => parseReviewMonth(row)).filter(Boolean))].sort().reverse();
}

export function buildDashboardSummary(rows: SheetRow[], monthKey: string): DashboardSummary {
  const validRows = normalizeRows(rows);
  const filteredRows = monthKey ? validRows.filter((row) => row.monthKey === monthKey) : validRows;
  const agentMap = new Map<
    string,
    {
      clients: Set<string>;
      totalFtd: number;
      countries: Set<string>;
    }
  >();
  const countryMap = new Map<string, number>();
  const monthlyMap = new Map<string, { totalFtd: number; clients: Set<string> }>();
  const monthlyAgentMap = new Map<
    string,
    Map<
      string,
      {
        clients: Set<string>;
        totalFtd: number;
        countries: Set<string>;
      }
    >
  >();

  for (const row of validRows) {
    const bucket = monthlyMap.get(row.monthKey) ?? { totalFtd: 0, clients: new Set<string>() };
    bucket.totalFtd += row.ftd;
    bucket.clients.add(row.client);
    monthlyMap.set(row.monthKey, bucket);

    const monthAgents = monthlyAgentMap.get(row.monthKey) ?? new Map();
    const monthAgentBucket = monthAgents.get(row.agent) ?? {
      clients: new Set<string>(),
      totalFtd: 0,
      countries: new Set<string>()
    };

    monthAgentBucket.clients.add(row.client);
    monthAgentBucket.totalFtd += row.ftd;
    if (row.country) {
      monthAgentBucket.countries.add(row.country);
    }

    monthAgents.set(row.agent, monthAgentBucket);
    monthlyAgentMap.set(row.monthKey, monthAgents);
  }

  for (const row of filteredRows) {
    const bucket = agentMap.get(row.agent) ?? {
      clients: new Set<string>(),
      totalFtd: 0,
      countries: new Set<string>()
    };

    bucket.clients.add(row.client);
    bucket.totalFtd += row.ftd;
    if (row.country) {
      bucket.countries.add(row.country);
      countryMap.set(row.country, (countryMap.get(row.country) ?? 0) + row.ftd);
    }

    agentMap.set(row.agent, bucket);
  }

  const agentSummaries = [...agentMap.entries()]
    .map(([agent, value]) => ({
      rank: 0,
      agent,
      clients: value.clients.size,
      totalFtd: value.totalFtd,
      averageFtd: value.clients.size ? value.totalFtd / value.clients.size : 0,
      countries: value.countries.size
    }))
    .sort((a, b) => {
      if (b.clients !== a.clients) {
        return b.clients - a.clients;
      }
      if (b.totalFtd !== a.totalFtd) {
        return b.totalFtd - a.totalFtd;
      }
      return a.agent.localeCompare(b.agent);
    })
    .map((summary, index) => ({ ...summary, rank: index + 1 }));

  const monthlyChampions = [...monthlyAgentMap.entries()]
    .map(([month, monthAgents]) => {
      const champion = [...monthAgents.entries()]
        .map(([agent, value]) => ({
          agent,
          clients: value.clients.size,
          totalFtd: value.totalFtd
        }))
        .sort((a, b) => {
          if (b.clients !== a.clients) {
            return b.clients - a.clients;
          }
          if (b.totalFtd !== a.totalFtd) {
            return b.totalFtd - a.totalFtd;
          }
          return a.agent.localeCompare(b.agent);
        })[0];

      return champion
        ? {
            month,
            agent: champion.agent,
            clients: champion.clients,
            totalFtd: champion.totalFtd
          }
        : null;
    })
    .filter((value): value is { month: string; agent: string; clients: number; totalFtd: number } => Boolean(value))
    .sort((a, b) => a.month.localeCompare(b.month));

  const topAgent = agentSummaries[0] ?? null;

  const totalClients = new Set(filteredRows.map((row) => row.client)).size;
  const totalFtd = filteredRows.reduce((sum, row) => sum + row.ftd, 0);

  return {
    monthKey,
    totalClients,
    totalFtd,
    topAgent,
    averageFtdPerClient: totalClients ? totalFtd / totalClients : 0,
    agentSummaries,
    countryTotals: [...countryMap.entries()]
      .map(([country, total]) => ({ country, totalFtd: total }))
      .sort((a, b) => b.totalFtd - a.totalFtd),
    monthlyTrend: [...monthlyMap.entries()]
      .map(([month, totals]) => ({
        month,
        totalFtd: totals.totalFtd,
        clients: totals.clients.size
      }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    monthlyChampions
  };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatMonth(monthKey: string): string {
  if (!monthKey) {
    return "All Months";
  }

  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
