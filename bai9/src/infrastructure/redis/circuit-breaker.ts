export type CircuitState = 'closed' | 'open' | 'half-open';

// Sau `failureThreshold` loi lien tiep -> mo mach `cooldownMs`, moi lenh bo qua Redis ngay lap tuc
// (khong ton thoi gian cho timeout). Het cooldown -> cho 1 lenh tham do (half-open).
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private probeInFlight = false;
  opens = 0;

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 2000,
  ) {}

  get current(): CircuitState {
    return this.state;
  }

  allowRequest(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
    if (this.state === 'half-open' && !this.probeInFlight) {
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  onSuccess(): void {
    this.failures = 0;
    this.probeInFlight = false;
    this.state = 'closed';
  }

  onFailure(): void {
    this.failures++;
    this.probeInFlight = false;
    if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
      if (this.state !== 'open') this.opens++;
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}
