/**
 * Runs work on one repo's caches one at a time within this process. The
 * server resolves a Change in a request while runs analyse others, and two
 * fetches into one bare repo, or two writes of one PR index, would collide.
 */
const queues = new Map<string, Promise<unknown>>();

export function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.catch(() => {});
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}
