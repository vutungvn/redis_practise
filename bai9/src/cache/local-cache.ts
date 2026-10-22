// Cache L1 trong bo nho tien trinh, gioi han so phan tu (bo phan tu cu nhat khi day)
export class LocalCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly maxEntries = 1000) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}
