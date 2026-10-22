// Gop cac lan tai cung khoa dang chay dong thoi trong 1 tien trinh thanh 1 lan goi DB.
// Quan trong nhat khi Redis sap: 200 request cung luc cho top-sellers chi tao 1 truy van nang.
export class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const job = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }
}
