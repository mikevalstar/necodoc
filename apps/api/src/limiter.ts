/**
 * Runs at most `max()` tasks at once; the rest wait their turn rather than fail. A finishing task
 * hands its slot straight to the next waiter.
 */
export function limiter(max: () => number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= max()) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
