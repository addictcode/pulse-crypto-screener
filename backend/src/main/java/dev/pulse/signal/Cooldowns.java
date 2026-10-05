package dev.pulse.signal;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Anti-spam, in two layers:
 * <ul>
 *   <li>one signal per symbol and type per cooldown, unless the new one is clearly stronger
 *       ("WIF +2.1%" then, three minutes later, "WIF +4.5%" is news; "+2.3%" is not);</li>
 *   <li>a budget per symbol across all types, so one wild small cap that pumps and dumps all
 *       hour cannot fill the feed by itself.</li>
 * </ul>
 * State is rebuilt from stored signals on startup, otherwise every restart (every deploy)
 * would fire the same funding and wall signals again. Not thread safe: only the detector uses it.
 */
final class Cooldowns {

    static final int PER_SYMBOL_PER_HOUR = 4;
    static final Duration BUDGET_WINDOW = Duration.ofHours(1);

    private record Last(long time, double value) {
    }

    private final double escalation;
    private final Map<String, Last> last = new HashMap<>();
    private final Map<String, Deque<Long>> firedBySymbol = new HashMap<>();

    Cooldowns(double escalation) {
        this.escalation = escalation;
    }

    /** Replays already fired signals, oldest first. */
    void restore(List<Signal> history) {
        history.forEach(this::record);
    }

    /**
     * Starts the cooldown without firing and without using the symbol's budget: for conditions
     * that were already true when the detector started.
     */
    void remember(Signal signal) {
        last.putIfAbsent(key(signal), new Last(signal.time(), signal.value()));
    }

    /** Records the signal and returns true if it should fire. */
    boolean admit(Signal signal) {
        Last previous = last.get(key(signal));
        boolean fresh = previous == null
                || signal.time() - previous.time() >= signal.type().cooldown().toMillis()
                || signal.type().escalates(signal.value(), previous.value(), escalation);
        if (!fresh || overBudget(signal)) {
            return false;
        }
        record(signal);
        return true;
    }

    private boolean overBudget(Signal signal) {
        Deque<Long> times = firedBySymbol.get(signal.symbol());
        if (times == null) {
            return false;
        }
        long windowStart = signal.time() - BUDGET_WINDOW.toMillis();
        while (!times.isEmpty() && times.peekFirst() <= windowStart) {
            times.pollFirst();
        }
        return times.size() >= PER_SYMBOL_PER_HOUR;
    }

    private void record(Signal signal) {
        last.put(key(signal), new Last(signal.time(), signal.value()));
        firedBySymbol.computeIfAbsent(signal.symbol(), s -> new ArrayDeque<>()).addLast(signal.time());
    }

    private static String key(Signal signal) {
        return signal.symbol() + ":" + signal.type();
    }
}
