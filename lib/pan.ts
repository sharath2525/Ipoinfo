const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function normalizePan(value: string) {
  return value.trim().toUpperCase();
}

export function isValidPan(value: string) {
  return PAN_REGEX.test(normalizePan(value));
}
