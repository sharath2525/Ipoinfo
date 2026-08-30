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

    const response = await fetch("https://ipo.bigshareonline.com/Captcha.ashx", {
      cache: "no-store"
    });

    if (!response.ok) {
      return Response.json(
        { error: "Bigshare could not provide a CAPTCHA. Please retry shortly." },
        { status: 502 }
      );
    }

    return Response.json(await response.json());
  } catch {
    return Response.json(
      {
        error: "Could not load the Bigshare CAPTCHA. Please retry shortly."
      },
      { status: 502 }
    );
  }
}
