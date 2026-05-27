import { NextResponse } from "next/server";
import type { SheetRow } from "../../../lib/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type ApiPayload =
  | SheetRow[]
  | {
      success?: boolean;
      total?: number;
      data?: SheetRow[];
    };

function getSourceUrl(): string | null {
  return process.env.SHEETS_API_URL || process.env.NEXT_PUBLIC_SHEETS_API_URL || null;
}

export async function GET() {
  const sourceUrl = getSourceUrl();

  if (!sourceUrl) {
    return NextResponse.json(
      { success: false, error: "Sheets API URL is not configured." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }

  try {
    const requestUrl = new URL(sourceUrl);
    requestUrl.searchParams.set("_ts", String(Date.now()));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache"
      }
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Upstream request failed with ${response.status}.` },
        {
          status: 502,
          headers: {
            "Cache-Control": "no-store, max-age=0"
          }
        }
      );
    }

    const payload = (await response.json()) as ApiPayload;

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown data proxy error.";

    return NextResponse.json(
      { success: false, error: message },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}
