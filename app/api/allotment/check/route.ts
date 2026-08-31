import { checkAllotments } from "@/lib/batch-check";
import { isValidPan, normalizePan } from "@/lib/pan";
import {
  resolveIpoReferences,
  type IpoReference
} from "@/lib/providers/ipo-reference";
import { getPublicIpoFeed } from "@/lib/providers/public-feed";

type RequestBody = {
  pans?: string[];
  ipoIds?: string[];
  ipoRefs?: IpoReference[];
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
  const validReferences = (body.ipoRefs ?? []).filter(
    (reference): reference is IpoReference =>
      Boolean(reference && typeof reference.id === "string" && reference.id)
  );
  const ipoIds = Array.from(
    new Set([...(body.ipoIds ?? []), ...validReferences.map((reference) => reference.id)])
  ).filter(Boolean);
  const references = ipoIds.map(
    (id) => validReferences.find((reference) => reference.id === id) ?? { id }
  );

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
    const feed = await getPublicIpoFeed();
    ipos = resolveIpoReferences(feed.ipos, references);
  } catch {
    return Response.json(
      {
        error: "Could not load the recent IPO list. Please retry shortly."
      },
      { status: 502 }
    );
  }

  if (!ipos.length) {
    return Response.json(
      {
        error: "The IPO list was refreshed. Please select the IPO again and retry.",
        code: "IPO_REFERENCE_STALE"
      },
      { status: 409 }
    );
  }

  if (ipos.length !== references.length) {
    return Response.json(
      {
        error: "One selected IPO could not be verified after the latest refresh.",
        code: "IPO_REFERENCE_AMBIGUOUS"
      },
      { status: 409 }
    );
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
