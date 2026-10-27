/**
 * Slow requests as jobs. The first read of a big repo takes minutes, too long
 * for a request to hang with nothing to show. The first call with a key starts
 * the work; every call with that key waits a moment for it, then answers with
 * its latest progress (and the client asks again) or with its result.
 */
export type JobState<T> = { done: true; value: T } | { done: false; progress: string | null };

interface Job<T> {
  promise: Promise<T>;
  progress: string | null;
}

export class Jobs {
  private readonly jobs = new Map<string, Job<unknown>>();

  constructor(
    /** How long a call waits for the work before answering with progress. */
    private readonly waitMs = 1500,
    /** How long a finished job waits for its caller to come back. */
    private readonly keepMs = 5 * 60_000,
  ) {}

  /**
   * `signal` is the caller's request: a result it can no longer take is kept
   * for the next caller rather than collected.
   */
  async run<T>(
    key: string,
    work: (onProgress: (step: string) => void) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<JobState<T>> {
    const job = (this.jobs.get(key) as Job<T> | undefined) ?? this.start(key, work);
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<"waiting">((resolve) => {
      timer = setTimeout(() => resolve("waiting"), this.waitMs);
    });
    const settled = job.promise.then(
      () => "settled" as const,
      () => "settled" as const,
    );
    const first = await Promise.race([settled, waited]);
    clearTimeout(timer);
    if (first === "waiting") return { done: false, progress: job.progress };
    if (!signal?.aborted) this.forget(key, job);
    // Throws when the work failed, so the route reports it.
    return { done: true, value: await job.promise };
  }

  private start<T>(key: string, work: (onProgress: (step: string) => void) => Promise<T>): Job<T> {
    const job: Job<T> = { promise: Promise.resolve() as Promise<T>, progress: null };
    job.promise = work((step) => {
      job.progress = step;
    });
    this.jobs.set(key, job);
    // A finished job nobody comes back for is dropped, failures included.
    const expire = () => setTimeout(() => this.forget(key, job), this.keepMs).unref();
    job.promise.then(expire, expire);
    return job;
  }

  private forget(key: string, job: Job<unknown>) {
    if (this.jobs.get(key) === job) this.jobs.delete(key);
  }
}
