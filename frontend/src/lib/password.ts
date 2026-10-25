/** Store password rules (backend validators + D16 variety rule). Returns translation keys of the broken rules. */
export const MIN_PASSWORD_LENGTH = 12;
export const MIN_DISTINCT_CHARACTERS = 5;

export function passwordProblems(password: string): string[] {
  const value = String(password ?? "");
  const problems: string[] = [];
  if (value.length < MIN_PASSWORD_LENGTH) problems.push("password.tooShort");
  if (new Set(value).size < MIN_DISTINCT_CHARACTERS) problems.push("password.lowVariety");
  if (value && /^\d+$/.test(value)) problems.push("password.allDigits");
  return problems;
}
