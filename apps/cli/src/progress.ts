/**
 * Prints the engine's progress on stderr. A step that repeats with new counts,
 * like reading a big repo's PRs, prints at most every few seconds.
 */
export function progressPrinter(
  write: (line: string) => void = (line) => console.error(line),
  now: () => number = Date.now,
  everyMs = 3000,
): (step: string) => void {
  let lastShape = "";
  let lastAt = Number.NEGATIVE_INFINITY;
  return (step) => {
    const shape = step.replace(/\d+/g, "#");
    const at = now();
    if (shape === lastShape && at - lastAt < everyMs) return;
    lastShape = shape;
    lastAt = at;
    write(`… ${step}`);
  };
}
