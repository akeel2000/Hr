import { ai, getAiModel, hasAiConfig } from "./ai";
import type { SheetRow } from "./dashboard";

type InsightMode = "answer" | "report";

function buildPrompt(rows: SheetRow[], monthLabel: string, question: string, mode: InsightMode): string {
  const task =
    mode === "report"
      ? "Write a concise manager-ready monthly report in markdown with sections for performance summary, anomalies, duplicate-name risks, duplicate-client risks, and recommended follow-up actions."
      : "Answer the user's question using only the provided data. If the data is insufficient, say so explicitly.";

  return `
You are analyzing HR performance dashboard data.

Rules:
- Do not change, recompute, or override source totals.
- Treat the provided rows as the source of truth.
- Do not invent agents, clients, or months.
- If names look similar, mark them as possible duplicates rather than certain duplicates unless the evidence is strong.
- Keep the response concise and practical.

Selected month: ${monthLabel}
Task: ${task}
User question: ${question}

Rows:
${JSON.stringify(rows)}
`.trim();
}

export async function generateInsights(rows: SheetRow[], question: string, monthLabel: string, mode: InsightMode): Promise<string> {
  if (!hasAiConfig || !ai) {
    throw new Error("AI is not configured. Add OPENROUTER_API_KEY to .env.local.");
  }

  const response = await ai.chat.completions.create({
    model: getAiModel(),
    messages: [
      {
        role: "user",
        content: buildPrompt(rows, monthLabel, question, mode)
      }
    ]
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("AI returned an empty response.");
  }

  return content;
}
