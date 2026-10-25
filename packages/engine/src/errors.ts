/** Thrown by the parts of the engine that milestone 1 has not built yet. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (milestone 1).`);
    this.name = "NotImplementedError";
  }
}
