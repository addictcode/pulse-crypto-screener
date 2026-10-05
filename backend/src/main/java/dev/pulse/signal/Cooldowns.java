package dev.pulse.signal;

import java.util.HashMap;
import java.util.Map;

/**
 * Anti-spam: one signal per symbol and type per cooldown, unless the new one is clearly stronger
 * ("WIF +2.1%" then, three minutes later, "WIF +4.5%" is news; "+2.3%" is not).
 * Not thread safe: only the detector thread uses it.
 */
final class Cooldowns {

    private record Last(long time, double value) {
    }

    private final double escalation;
    private final Map<String, Last> last = new HashMap<>();

    Cooldowns(double escalation) {
        this.escalation = escalation;
    }

    /** Records the signal and returns true if it should fire. */
    boolean admit(Signal signal) {
        String key = signal.symbol() + ":" + signal.type();
        Last previous = last.get(key);
        boolean fire = previous == null
                || signal.time() - previous.time() >= signal.type().cooldown().toMillis()
                || signal.type().escalates(signal.value(), previous.value(), escalation);
        if (fire) {
            last.put(key, new Last(signal.time(), signal.value()));
        }
        return fire;
    }
}
