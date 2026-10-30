/** Generic object pool — avoids GC spikes for enemies, logs, coins, projectiles, particles. */
export class Pool<T> {
  private free: T[] = [];
  readonly active = new Set<T>();

  constructor(private create: () => T, private onGet?: (t: T) => void, private onRelease?: (t: T) => void) {}

  prewarm(n: number): this {
    for (let i = 0; i < n; i++) this.free.push(this.create());
    return this;
  }

  get(): T {
    const t = this.free.pop() ?? this.create();
    this.active.add(t);
    this.onGet?.(t);
    return t;
  }

  release(t: T): void {
    if (!this.active.delete(t)) return;
    this.onRelease?.(t);
    this.free.push(t);
  }

  releaseAll(): void {
    for (const t of [...this.active]) this.release(t);
  }
}
