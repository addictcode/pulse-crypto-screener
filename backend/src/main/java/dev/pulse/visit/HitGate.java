package dev.pulse.visit;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most {@link #PER_WINDOW} hits of a page a minute from one address. Telling a reload from a
 * new visitor is the page's job (it counts each page once a visit, web/src/visit.ts); this only
 * keeps a script from inflating the funnel. Not one hit a minute: a mobile operator puts hundreds
 * of phones behind one IPv4 address (CGNAT), and a TikTok audience is mostly phones. Addresses
 * live here, in memory, for a minute; they are never written anywhere.
 *
 * <p>The memory is bounded: if more than {@link #MAX_ENTRIES} addresses arrive within a minute
 * (a flood from rotating IPv6 addresses, not visitors), new ones are not counted until the old
 * ones expire. The funnel loses a minute of counts; the server does not lose its heap.
 */
final class HitGate {

    static final long WINDOW_MS = 60_000;
    static final int PER_WINDOW = 20;
    static final int MAX_ENTRIES = 50_000;

    static final long SWEEP_MS = 1_000;

    private record Window(long start, int hits) {
    }

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private volatile long sweptAt = -SWEEP_MS;

    /** @return true if this hit counts */
    boolean admit(String address, FunnelStep step, long now) {
        String key = address + '|' + step.key();
        if (windows.size() >= MAX_ENTRIES && !windows.containsKey(key)) {
            // a full sweep is O(entries): at most once a second, not on every hit of a flood
            if (now - sweptAt >= SWEEP_MS) {
                sweptAt = now;
                windows.values().removeIf(w -> now - w.start() >= WINDOW_MS);
            }
            if (windows.size() >= MAX_ENTRIES) {
                return false;
            }
        }
        boolean[] admitted = {false};
        windows.compute(key, (k, w) -> {
            if (w == null || now - w.start() >= WINDOW_MS) {
                admitted[0] = true;
                return new Window(now, 1);
            }
            if (w.hits() < PER_WINDOW) {
                admitted[0] = true;
                return new Window(w.start(), w.hits() + 1);
            }
            return w;
        });
        return admitted[0];
    }

    /** How many address and page pairs are remembered right now. */
    int size() {
        return windows.size();
    }
}
