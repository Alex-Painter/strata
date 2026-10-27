/**
 * The theme: the system's by default, or the one the viewer picked, kept in
 * this browser only. The choice is a data-theme on <html>, which styles.css reads.
 */
export type Theme = "light" | "dark";

const KEY = "strata-theme";

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  const picked = document.documentElement.dataset.theme;
  if (picked === "light" || picked === "dark") return picked;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** Switches to the other theme and remembers it. */
export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private windows can refuse storage; the theme still applies for this page.
  }
}
