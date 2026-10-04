package dev.pulse.exchange.binance;

import java.util.concurrent.locks.LockSupport;

/**
 * Spaces calls evenly at a fixed rate. Callers run on virtual threads, so parking is cheap.
 */
final class RateLimiter {

    private final long intervalNanos;
    private long nextSlot = System.nanoTime();

    RateLimiter(int permitsPerSecond) {
        this.intervalNanos = 1_000_000_000L / Math.max(1, permitsPerSecond);
    }

    void acquire() {
        long wait;
        synchronized (this) {
            long now = System.nanoTime();
            long slot = Math.max(now, nextSlot);
            nextSlot = slot + intervalNanos;
            wait = slot - now;
        }
        if (wait > 0) {
            LockSupport.parkNanos(wait);
        }
    }
}
