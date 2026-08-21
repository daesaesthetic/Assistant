type AsyncTask<T> = () => T | Promise<T>;

/**
 * Serializes work by key while allowing unrelated keys to run concurrently.
 *
 * A settled key is removed immediately, so the map only retains conversations
 * that currently have queued or running work.
 */
export class KeyedAsyncQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: AsyncTask<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.tails.set(key, current);

    try {
      await previous.catch(() => {});
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === current) {
        this.tails.delete(key);
      }
    }
  }

  get size(): number {
    return this.tails.size;
  }
}
