export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  score: StrengthLevel;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  /** One short hint for the next improvement, or null when strong. */
  hint: string | null;
  /** Meets the sign-up requirement (6+ chars, upper, lower, number, symbol). */
  acceptable: boolean;
}

const LABELS: PasswordStrength["label"][] = ["Too short", "Weak", "Fair", "Good", "Strong"];

export function passwordStrength(pw: string): PasswordStrength {
  const checks = {
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  const variety = Object.values(checks).filter(Boolean).length;
  const acceptable = pw.length >= 6 && variety === 4;

  let score: StrengthLevel;
  if (pw.length < 6) score = 0;
  else {
    let s = variety - 1; // 0..3
    if (pw.length >= 12) s += 1;
    if (/(.)\1{2,}/.test(pw)) s -= 1;
    score = Math.max(1, Math.min(4, s)) as StrengthLevel;
    if (!acceptable && score > 2) score = 2;
  }

  let hint: string | null = null;
  if (pw.length < 6) hint = "Use at least 6 characters";
  else if (!checks.upper) hint = "Add an uppercase letter";
  else if (!checks.lower) hint = "Add a lowercase letter";
  else if (!checks.number) hint = "Add a number";
  else if (!checks.symbol) hint = "Add a symbol like ! or #";
  else if (pw.length < 12) hint = "Longer is stronger";

  return { score, label: LABELS[score], hint, acceptable };
}
