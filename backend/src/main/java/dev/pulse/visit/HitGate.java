package dev.pulse.visit;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most one hit of a page a minute from one address. A reload or a second tab should not count
 * as another visitor, and a script should not be able to inflate the funnel. Addresses live here,
 * in memory, for a minute; they are never written anywhere.
 */
final class HitGate {

    static final long WINDOW_MS = 60_000;
    static final int MAX_ENTRIES = 50_000;

    private final Map<String, Long> lastHit = new ConcurrentHashMap<>();

    /** @return true if this hit counts */
    boolean admit(String address, FunnelStep step, long now) {
        if (lastHit.size() >= MAX_ENTRIES) {
            lastHit.values().removeIf(at -> now - at >= WINDOW_MS);
        }
        boolean[] admitted = {false};
        lastHit.compute(address + '|' + step.key(), (key, at) -> {
            if (at != null && now - at < WINDOW_MS) {
                return at;
            }
            admitted[0] = true;
            return now;
        });
        return admitted[0];
    }
}
