import { getAllotmentProvider } from "@/lib/providers/allotment-provider";
import type { AllotmentResult, BatchCheckResponse, Ipo } from "@/lib/types";

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
) {
  const results: T[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await tasks[current]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  );

  return results;
}

export async function checkAllotments(
  pans: string[],
  ipos: Ipo[]
): Promise<BatchCheckResponse> {
  const checkedAt = new Date().toISOString();
  const tasks = ipos.flatMap((ipo) =>
    pans.map(() => {
      const provider = getAllotmentProvider(ipo.registrar);
      return { ipo, provider };
    })
  );
  const panByTask = ipos.flatMap(() => pans);

  const results = await runWithConcurrency<AllotmentResult>(
    tasks.map(({ ipo, provider }, index) => async () => {
      try {
        return await provider.check(ipo, panByTask[index]);
      } catch {
        return {
          ipoId: ipo.id,
          ipoName: ipo.name,
          pan: panByTask[index],
          status: "error",
          registrar: ipo.registrar,
          checkedAt,
          liveStatus: "Official check failed",
          error:
            "The registrar could not complete this check. Please retry shortly or use the official status link."
        };
      }
    }),
    4
  );

  const failedChecks = results.filter((result) => result.status === "error").length;
  const successfulChecks = results.filter(
    (result) =>
      result.status === "allotted" ||
      result.status === "not_allotted" ||
      result.status === "not_applied"
  ).length;
  const unavailableChecks = results.filter(
    (result) =>
      result.status === "unavailable" ||
      result.status === "allotment_out" ||
      result.status === "pending" ||
      result.status === "captcha_required"
  ).length;

  return {
    results,
    totalChecks: results.length,
    successfulChecks,
    failedChecks,
    unavailableChecks,
    checkedAt
  };
}
