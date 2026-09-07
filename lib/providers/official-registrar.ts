import type { AllotmentResult, Ipo } from "@/lib/types";

const OFFICIAL_HOSTS = [
  "ipo.bigshareonline.com",
  "ipostatus.kfintech.com",
  "in.mpms.mufg.com",
  "linkintime.co.in",
  "www.linkintime.co.in",
  "www.skylinerta.com",
  "skylinerta.com",
  "maashitla.com",
  "www.maashitla.com",
  "purvashare.com",
  "www.purvashare.com",
  "cameoindia.com",
  "www.cameoindia.com",
  "ipostatus2.cameoindia.com",
  "integratedregistry.in",
  "www.integratedregistry.in",
  "ipostatus.integratedregistry.in",
  "abhipra.com",
  "www.abhipra.com",
  "ipo.alankit.com",
  "mudrarta.com",
  "www.mudrarta.com",
  "bseindia.com",
  "www.bseindia.com"
] as const;

const BSE_ALLOTMENT_URL = "https://www.bseindia.com/investors/appli_check.aspx";

function trustedUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OFFICIAL_HOSTS.includes(url.hostname as never)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function officialAllotmentUrl(ipo: Pick<Ipo, "registrar" | "allotmentUrl">) {
  const supplied = trustedUrl(ipo.allotmentUrl);
  if (supplied) return supplied;

  const registrar = ipo.registrar.toLowerCase();
  if (registrar.includes("bigshare")) {
    return "https://ipo.bigshareonline.com/ipo_status.html";
  }
  if (registrar.includes("kfin")) return "https://ipostatus.kfintech.com/";
  if (registrar.includes("mufg") || registrar.includes("intime")) {
    return "https://in.mpms.mufg.com/Initial_Offer/public-issues.html";
  }
  if (registrar.includes("skyline")) return "https://www.skylinerta.com/ipo.php";
  if (registrar.includes("maashitla")) return "https://maashitla.com/allotment-status/public-issues";
  if (registrar.includes("purva")) return "https://www.purvashare.com/investor-service/ipo-query";

  return BSE_ALLOTMENT_URL;
}

export function withOfficialFallback(result: AllotmentResult, ipo: Ipo): AllotmentResult {
  if (result.status === "allotted" || result.status === "not_allotted") return result;

  return {
    ...result,
    actionUrl: officialAllotmentUrl(ipo),
    actionLabel: "Check on official registrar"
  };
}
