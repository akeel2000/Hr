import { NextResponse } from "next/server";
import { generateInsights } from "../../../lib/ai-insights";
import type { SheetRow } from "../../../lib/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type RequestBody = {
  rows?: SheetRow[];
  question?: string;
  monthLabel?: string;
  mode?: "answer" | "report";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const question = body.question?.trim() || "Give a concise summary of this month's performance.";
    const monthLabel = body.monthLabel?.trim() || "All Months";
    const mode = body.mode === "report" ? "report" : "answer";

    if (!rows.length) {
      return NextResponse.json({ success: false, error: "No rows were provided for AI analysis." }, { status: 400 });
    }

    const insights = await generateInsights(rows, question, monthLabel, mode);
    return NextResponse.json({ success: true, insights });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI analysis failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
