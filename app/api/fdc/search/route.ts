import { NextResponse } from "next/server";

const FDC_BASE = "https://api.nal.usda.gov/fdc";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") || "").trim();
  const pageSizeRaw = searchParams.get("pageSize") || "12";
  const pageSize = Number(pageSizeRaw);

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter." }, { status: 400 });
  }

  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing USDA_FDC_API_KEY." },
      { status: 500 }
    );
  }

  const url = new URL(`${FDC_BASE}/v1/foods/search`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", query);
  url.searchParams.set(
    "pageSize",
    String(Number.isFinite(pageSize) ? Math.min(50, Math.max(1, pageSize)) : 12)
  );

  try {
    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    const contentType = res.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await res.json()
      : await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { error: `Food search failed (${res.status}).`, details: body },
        { status: res.status }
      );
    }

    return NextResponse.json(body, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Unable to reach USDA FoodData Central." },
      { status: 502 }
    );
  }
}
