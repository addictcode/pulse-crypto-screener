package dev.pulse.push;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * At most a few subscriptions a day from one address: a browser subscribes once and updates now
 * and then, a script filling the table with endpoints does not get far. Kept in memory only; a
 * phone carrier puts many people behind one address, hence a generous number.
 */
final class SubscribeGate {

    static final long DAY_MS = 86_400_000;
    static final int PER_DAY = 20;
    private static final int MAX_ADDRESSES = 50_000;

    private final Map<String, Deque<Long>> seen = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Deque<Long>> eldest) {
            return size() > MAX_ADDRESSES;
        }
    };

    synchronized boolean admit(String address, long now) {
        Deque<Long> times = seen.computeIfAbsent(address, k -> new ArrayDeque<>());
        while (!times.isEmpty() && now - times.peekFirst() >= DAY_MS) {
            times.pollFirst();
        }
        if (times.size() >= PER_DAY) {
            return false;
        }
        times.addLast(now);
        return true;
    }
}
