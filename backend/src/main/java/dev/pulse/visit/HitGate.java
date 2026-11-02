package dev.pulse.visit;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most one hit of a page a minute from one address. A reload or a second tab should not count
 * as another visitor, and a script should not be able to inflate the funnel. Addresses live here,
 * in memory, for a minute; they are never written anywhere.
 *
 * <p>The memory is bounded: if more than {@link #MAX_ENTRIES} addresses arrive within a minute
 * (a flood from rotating IPv6 addresses, not visitors), new ones are not counted until the old
 * ones expire. The funnel loses a minute of counts; the server does not lose its heap.
 */
final class HitGate {

    static final long WINDOW_MS = 60_000;
    static final int MAX_ENTRIES = 50_000;

    static final long SWEEP_MS = 1_000;

    private final Map<String, Long> lastHit = new ConcurrentHashMap<>();
    private volatile long sweptAt = -SWEEP_MS;

    /** @return true if this hit counts */
    boolean admit(String address, FunnelStep step, long now) {
        String key = address + '|' + step.key();
        if (lastHit.size() >= MAX_ENTRIES && !lastHit.containsKey(key)) {
            // a full sweep is O(entries): at most once a second, not on every hit of a flood
            if (now - sweptAt >= SWEEP_MS) {
                sweptAt = now;
                lastHit.values().removeIf(at -> now - at >= WINDOW_MS);
            }
            if (lastHit.size() >= MAX_ENTRIES) {
                return false;
            }
        }
        boolean[] admitted = {false};
        lastHit.compute(key, (k, at) -> {
            if (at != null && now - at < WINDOW_MS) {
                return at;
            }
            admitted[0] = true;
            return now;
        });
        return admitted[0];
    }

    /** How many address and page pairs are remembered right now. */
    int size() {
        return lastHit.size();
    }
}
