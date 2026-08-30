import { checkAllotments } from "@/lib/batch-check";
import { isValidPan, normalizePan } from "@/lib/pan";
import { getIpoDataProvider } from "@/lib/providers/ipo-provider";

type RequestBody = {
  pans?: string[];
  ipoIds?: string[];
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  const pans = Array.from(new Set((body.pans ?? []).map(normalizePan))).filter(
    Boolean
  );
  const ipoIds = Array.from(new Set(body.ipoIds ?? [])).filter(Boolean);

  if (!pans.length) {
    return Response.json({ error: "Add at least one PAN." }, { status: 400 });
  }

  if (pans.some((pan) => !isValidPan(pan))) {
    return Response.json(
      { error: "One or more PAN numbers do not match the required format." },
      { status: 400 }
    );
  }

  if (!ipoIds.length) {
    return Response.json({ error: "Select at least one IPO." }, { status: 400 });
  }

  if (pans.length * ipoIds.length > 200) {
    return Response.json(
      { error: "Please keep one batch to 200 checks or fewer." },
      { status: 429 }
    );
  }

  let ipos;

  try {
    const requested = new Set(ipoIds);
    ipos = (await getIpoDataProvider().listRecentIpos()).filter((ipo) =>
      requested.has(ipo.id)
    );
  } catch {
    return Response.json(
      {
        error: "Could not load the recent IPO list. Please retry shortly."
      },
      { status: 502 }
    );
  }

  if (!ipos.length) {
    return Response.json({ error: "No matching IPOs found." }, { status: 404 });
  }

  try {
    const response = await checkAllotments(pans, ipos);
    return Response.json(response);
  } catch {
    return Response.json(
      {
        error: "The official allotment check could not be completed. Please retry shortly."
      },
      { status: 502 }
    );
  }
}
