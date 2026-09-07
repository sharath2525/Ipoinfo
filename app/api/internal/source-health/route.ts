import { timingSafeEqual } from "crypto";
import { getPublicSourceHealthSnapshot } from "@/lib/providers/source-health";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer"
};

function tokenMatches(received: string, expected: string) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export async function GET(request: Request) {
  const expectedToken = process.env.SOURCE_HEALTH_TOKEN;
  if (!expectedToken) {
    return Response.json({ error: "Not found." }, { status: 404, headers: noStoreHeaders });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const receivedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!tokenMatches(receivedToken, expectedToken)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: noStoreHeaders });
  }

  const sources = getPublicSourceHealthSnapshot();
  return Response.json(
    {
      checkedAt: new Date().toISOString(),
      healthy: sources.length > 0 && sources.every((source) => source.state === "healthy"),
      sources
    },
    { headers: noStoreHeaders }
  );
}
