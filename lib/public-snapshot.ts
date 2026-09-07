export type PublicSnapshotLike = {
  ipos: unknown[];
  gmp: unknown[];
};

export function isUsablePublicSnapshot(
  value: PublicSnapshotLike | null | undefined
): value is PublicSnapshotLike {
  return Boolean(
    value &&
      Array.isArray(value.ipos) &&
      Array.isArray(value.gmp) &&
      value.ipos.length > 0 &&
      value.gmp.length > 0
  );
}

export function selectPublicSnapshot<T extends PublicSnapshotLike>(
  live: T | null | undefined,
  cached: T | null | undefined
) {
  if (isUsablePublicSnapshot(live)) return { snapshot: live, source: "live" as const };
  if (isUsablePublicSnapshot(cached)) return { snapshot: cached, source: "cached" as const };
  return { snapshot: null, source: "unavailable" as const };
}
