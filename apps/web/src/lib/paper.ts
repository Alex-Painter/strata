/**
 * The paper texture: a printed-paper look over the whole app, after Linear's
 * Orbit page. Off by default, and kept in this browser only. The choice is a
 * data-paper on <html>, which styles.css reads.
 */
const KEY = "strata-paper";

export function storedPaper(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function applyPaper(on: boolean) {
  if (on) document.documentElement.dataset.paper = "on";
  else delete document.documentElement.dataset.paper;
}

/** Turns the texture on or off and remembers it. */
export function setPaper(on: boolean) {
  applyPaper(on);
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private windows can refuse storage; the choice still applies for this page.
  }
}
