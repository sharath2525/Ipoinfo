import { fetchWithTimeout } from "@/lib/fetch-timeout";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const registrar = searchParams.get("registrar")?.toLowerCase() ?? "";

    if (!registrar.includes("bigshare")) {
      return Response.json(
        { error: "CAPTCHA flow is available for Bigshare only." },
        { status: 400 }
      );
    }

    const response = await fetchWithTimeout("https://ipo.bigshareonline.com/Captcha.ashx", {
      cache: "no-store"
    });

    if (!response.ok) {
      return Response.json(
        { error: "Bigshare could not provide a CAPTCHA. Please retry shortly." },
        { status: 502 }
      );
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid CAPTCHA response");
    }

    const { token, image } = payload as { token?: unknown; image?: unknown };
    if (typeof token !== "string" || !token || typeof image !== "string" || !image) {
      throw new Error("Incomplete CAPTCHA response");
    }

    return Response.json({ token, image });
  } catch {
    return Response.json(
      {
        error: "Could not load the Bigshare CAPTCHA. Please retry shortly."
      },
      { status: 502 }
    );
  }
}
