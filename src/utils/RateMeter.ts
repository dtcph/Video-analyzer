/** Events per second over a sliding time window (e.g. effective inference FPS). Clock in ms, injectable. */
export class RateMeter {
    private times: number[] = [];

    constructor(
        private readonly windowMs = 2000,
        private readonly now: () => number = () => performance.now()
    ) {}

    record(): void {
        this.times.push(this.now());
        this.prune();
    }

    rate(): number {
        this.prune();
        if (this.times.length < 2) return 0;
        const span = this.times[this.times.length - 1] - this.times[0];
        return span > 0 ? ((this.times.length - 1) * 1000) / span : 0;
    }

    reset(): void {
        this.times = [];
    }

    private prune(): void {
        const cutoff = this.now() - this.windowMs;
        while (this.times.length > 0 && this.times[0] < cutoff) this.times.shift();
    }
}
